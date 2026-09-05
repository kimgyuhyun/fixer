import { Injectable } from '@nestjs/common';
import {
  ACCOUNT_ERRORS,
  bankNameOf,
  checkAccountFormat,
  maskAccountNumber,
  registerAccountRequestSchema,
  type AccountErrorCode,
  type AccountVerificationStatus,
  type MaskedAccount,
  type RegisterAccountRequest,
} from '@fixer/shared';
import type { AccountCipher } from './account-cipher';
import type { NotificationPublisher } from '../notification/notification.service';

/** 계좌가 던지는 도메인 에러 */
export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    /** 거절 사유. 무엇을 고쳐야 하는지 알려준다 */
    readonly reason?: string,
  ) {
    super(code);
    this.name = 'AccountError';
  }
}

/** 저장된 계좌 한 건. **평문 계좌번호는 여기에도 없다** */
export interface AccountRecord {
  userId: string;
  bankCode: string;
  accountNumberEncrypted: string;
  accountNumberLast4: string;
  holderName: string;
  verificationStatus: AccountVerificationStatus;
  rejectedReason: string | null;
}

export interface ExchangeAccountStore {
  /** 회원당 하나. 다시 등록하면 덮어쓴다 */
  upsert(record: AccountRecord): Promise<AccountRecord>;
  findByUser(userId: string): Promise<AccountRecord | null>;
}

/**
 * 계좌 검증. (`spec-fixed.md` §6.4.2)
 *
 * `stub`은 형식만 보고 즉시 통과시키고, `portone`은 실명을 대조한다.
 * **도메인 로직·스키마·화면은 두 모드에서 완전히 같다** — 전환은 이
 * 구현체를 바꿔 끼우는 것으로 끝난다 (ADR-PAY-5).
 */
export interface AccountVerifier {
  verify(input: {
    bankCode: string;
    accountNumber: string;
    holderName: string;
  }): Promise<{ status: AccountVerificationStatus; reason?: string }>;
}

/**
 * 형식만 보는 검증기. (MVP)
 *
 * 관리자 대기 단계를 만들지 않는다 — 실서비스 흐름과 단계 수가 같아야
 * 전환할 때 화면을 안 고치고, E2E도 막히지 않는다 (§6.4.2).
 */
@Injectable()
export class StubAccountVerifier implements AccountVerifier {
  verify(input: {
    bankCode: string;
    accountNumber: string;
  }): Promise<{ status: AccountVerificationStatus; reason?: string }> {
    const checked = checkAccountFormat(input);
    return Promise.resolve(
      checked.ok
        ? { status: 'VERIFIED' }
        : { status: 'REJECTED', reason: checked.reason },
    );
  }
}

/**
 * 환전받을 계좌. (이슈 #30, `spec-fixed.md` §6.4.1)
 *
 * **계좌번호를 평문으로 내려보내는 경로가 하나도 없다.** 복호화는 환전
 * 송금 시점에만 하고, 화면은 뒤 4자리만 본다.
 */
@Injectable()
export class ExchangeAccountService {
  constructor(
    private readonly store: ExchangeAccountStore,
    private readonly cipher: AccountCipher,
    private readonly verifier: AccountVerifier,
    /**
     * 검증 완료를 알린다. (#30이 남긴 숙제 — `handoff-a-to-b.md` 3-2)
     *
     * 포트라서 이 서비스는 인앱인지 메일인지 모른다. #37이 메일을 더해도
     * 여기는 그대로다.
     */
    private readonly notifications: NotificationPublisher,
  ) {}

  async register(
    userId: string,
    input: RegisterAccountRequest,
  ): Promise<MaskedAccount> {
    const parsed = registerAccountRequestSchema.parse(input);
    // 화면에서 하이픈을 지워 보내지만 서버도 지운다. 믿지 않는 편이 싸다.
    const accountNumber = parsed.accountNumber.replace(/[\s-]/g, '');

    const verified = await this.verifier.verify({
      bankCode: parsed.bankCode,
      accountNumber,
      holderName: parsed.holderName,
    });

    if (verified.status === 'REJECTED') {
      // **아무것도 저장하지 않는다.** 형식이 틀린 계좌를 남겨 두면 나중에
      // 그 행으로 송금 목록이 만들어진다.
      throw new AccountError(ACCOUNT_ERRORS.INVALID_FORMAT, verified.reason);
    }

    const saved = await this.store.upsert({
      userId,
      bankCode: parsed.bankCode,
      accountNumberEncrypted: this.cipher.encrypt(accountNumber),
      // 뒤 4자리만 평문이다. 목록을 그릴 때마다 복호화하면 전 회원의
      // 계좌번호가 메모리에 올라온다.
      accountNumberLast4: accountNumber.slice(-4),
      holderName: parsed.holderName,
      verificationStatus: verified.status,
      rejectedReason: null,
    });

    // 저장된 뒤에 알린다. 먼저 알리면 저장이 실패했을 때 "됐다"는 알림만
    // 남는다. 발행은 던지지 않으므로 이 줄이 등록을 되돌리는 일은 없다.
    await this.notifications.publish({
      userId,
      type: 'ACCOUNT_VERIFIED',
      title: '계좌 검증이 끝났습니다',
      body: '등록한 계좌로 환전을 신청할 수 있습니다.',
      linkUrl: '/my/account',
    });

    return toMasked(saved);
  }

  /** 화면이 보는 내 계좌. 평문은 안 나간다 */
  async findMine(userId: string): Promise<MaskedAccount> {
    const found = await this.store.findByUser(userId);
    if (found === null) {
      throw new AccountError(ACCOUNT_ERRORS.NOT_REGISTERED);
    }
    return toMasked(found);
  }

  /**
   * 송금할 때만 쓰는 평문 계좌번호.
   *
   * **화면·목록·상세 어디에도 안 내려보낸다.** 관리자가 실제로 송금하는
   * 그 순간에만 꺼내고, 응답에도 담지 않는다.
   */
  async revealForPayout(userId: string): Promise<string> {
    const found = await this.store.findByUser(userId);
    if (found === null) {
      throw new AccountError(ACCOUNT_ERRORS.NOT_REGISTERED);
    }
    return this.cipher.decrypt(found.accountNumberEncrypted);
  }
}

function toMasked(record: AccountRecord): MaskedAccount {
  return {
    bankCode: record.bankCode,
    bankName: bankNameOf(record.bankCode),
    maskedAccountNumber: maskAccountNumber(record.accountNumberLast4),
    holderName: record.holderName,
    verificationStatus: record.verificationStatus,
    rejectedReason: record.rejectedReason,
  };
}
