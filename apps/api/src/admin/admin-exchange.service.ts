import { Injectable } from '@nestjs/common';
import type {
  AccountVerificationStatus,
  AdminAction,
  AdminExchangeFilter,
  AdminExchangeList,
  ExchangeActionResult,
  ExchangeRequestStatus,
  RejectExchangeResult,
  RevealedAccount,
} from '@fixer/shared';
import type { NotificationPublisher } from '../notification/notification.service';
import type { ExchangeRequestRecord } from '../exchange/exchange-request.service';

/**
 * 목록 한 줄에 필요한 것들. 신청자 이름과 계좌를 조인해서 함께 온다.
 *
 * 계좌가 `null`일 수 있다 — 파기 배치(#39)가 계좌를 지운 뒤에도 환전 이력은
 * 남는다.
 */
export interface AdminExchangeRow {
  id: string;
  userId: string;
  amount: number;
  status: ExchangeRequestStatus;
  createdAt: Date;
  requesterName: string;
  account: {
    bankCode: string;
    accountNumberLast4: string;
    holderName: string;
    verificationStatus: AccountVerificationStatus;
  } | null;
}

/**
 * 관리자 환전 저장소. (이슈 #34)
 *
 * **상태 전이·원장·감사 로그가 저장소 한 메서드 안에서 한 트랜잭션이다**
 * (`ADR-PAY-4`). 서비스가 세 번 나눠 부르면 그 사이에 죽었을 때 "승인은 됐는데
 * 누가 했는지 없는" 건이 남는다.
 */
export interface AdminExchangeStore {
  listAll(
    filter: AdminExchangeFilter,
    pageSize: number,
  ): Promise<{ items: AdminExchangeRow[]; total: number }>;

  findById(id: string): Promise<ExchangeRequestRecord | null>;

  /**
   * 상태만 옮기고 감사 로그를 남긴다 (승인·이체 완료).
   *
   * `expectedStatus`가 아니면 `'STALE'`이다 — 우리가 읽은 뒤 다른 관리자가
   * 먼저 눌렀다는 뜻이라 덮어쓰지 않는다.
   */
  updateStatus(input: {
    requestId: string;
    expectedStatus: ExchangeRequestStatus;
    nextStatus: ExchangeRequestStatus;
    adminId: string;
    action: AdminAction;
  }): Promise<ExchangeRequestRecord | 'STALE'>;

  /** 반려 — 상태 전이 + `EXCHANGE_REVERT` 원장 + 감사 로그가 한 트랜잭션 */
  reject(input: {
    requestId: string;
    userId: string;
    amount: number;
    expectedStatus: ExchangeRequestStatus;
    adminId: string;
    reason: string;
  }): Promise<ExchangeRequestRecord | 'STALE'>;

  /** 감사 로그만 남긴다 (계좌 열람) */
  recordAudit(input: {
    adminId: string;
    action: AdminAction;
    targetId: string;
  }): Promise<void>;
}

/**
 * 평문 계좌번호를 꺼내는 포트.
 *
 * `ExchangeAccountService.revealForPayout`이 이미 그 모양이라 새 구현을
 * 만들지 않는다 (`ADR-PAY-6`).
 */
export interface AccountRevealer {
  revealForPayout(userId: string): Promise<string>;
}

/**
 * 관리자의 환전 관리. (이슈 #34, `spec-fixed.md` §6.4.1 §11.5)
 *
 * **승인은 원장을 건드리지 않는다.** 포인트는 #31의 요청 시점에 이미
 * `EXCHANGE_REQUEST`로 빠졌다 — 승인에서 또 빼면 두 번 빠진다.
 */
@Injectable()
export class AdminExchangeService {
  constructor(
    private readonly store: AdminExchangeStore,
    private readonly accounts: AccountRevealer,
    private readonly notifications: NotificationPublisher,
  ) {}

  list(filter: AdminExchangeFilter): Promise<AdminExchangeList> {
    throw new Error('not implemented');
  }

  approve(input: {
    adminId: string;
    requestId: string;
  }): Promise<ExchangeActionResult> {
    throw new Error('not implemented');
  }

  complete(input: {
    adminId: string;
    requestId: string;
  }): Promise<ExchangeActionResult> {
    throw new Error('not implemented');
  }

  reject(input: {
    adminId: string;
    requestId: string;
    reason: string;
  }): Promise<RejectExchangeResult> {
    throw new Error('not implemented');
  }

  revealAccount(input: {
    adminId: string;
    requestId: string;
  }): Promise<RevealedAccount> {
    throw new Error('not implemented');
  }
}
