import { Injectable } from '@nestjs/common';
import {
  ADMIN_ACTIONS,
  ADMIN_ERRORS,
  EXCHANGE_ERRORS,
  EXCHANGE_PAGE_SIZE,
  bankNameOf,
  canTransitionExchange,
  maskAccountNumber,
  type AccountVerificationStatus,
  type AdminAction,
  type AdminExchangeFilter,
  type AdminExchangeList,
  type AdminExchangeRequestSummary,
  type ExchangeActionResult,
  type ExchangeRequestStatus,
  type RejectExchangeResult,
  type RevealedAccount,
} from '@fixer/shared';
import type { NotificationPublisher } from '../notification/notification.service';
import {
  ExchangeError,
  type ExchangeRequestRecord,
} from '../exchange/exchange-request.service';
import { AdminError } from './admin-job-post.service';

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

  async list(filter: AdminExchangeFilter): Promise<AdminExchangeList> {
    const { items, total } = await this.store.listAll(
      filter,
      EXCHANGE_PAGE_SIZE,
    );
    return {
      items: items.map(toSummary),
      total,
      page: filter.page,
      pageSize: EXCHANGE_PAGE_SIZE,
    };
  }

  /** 승인. **원장을 건드리지 않는다** — 포인트는 요청 시점에 이미 빠졌다 */
  approve(input: {
    adminId: string;
    requestId: string;
  }): Promise<ExchangeActionResult> {
    return this.move(input, 'APPROVED', ADMIN_ACTIONS.EXCHANGE_APPROVE);
  }

  /**
   * 이체 완료. 관리자가 은행 앱에서 직접 이체한 뒤 손으로 찍는다 (§6.4.2).
   *
   * `EXCHANGE_MODE=portone`으로 전환되면 승인이 여기까지 자동으로 온다 —
   * 그래서 완료 처리가 승인과 같은 모양이어야 한다.
   */
  complete(input: {
    adminId: string;
    requestId: string;
  }): Promise<ExchangeActionResult> {
    return this.move(input, 'COMPLETED', ADMIN_ACTIONS.EXCHANGE_COMPLETE);
  }

  /**
   * 사유를 남기고 반려한다. 포인트는 `EXCHANGE_REVERT`로 되돌아간다 (§6.4.1).
   *
   * **알림은 저장소가 성공한 뒤에만 나간다.** 아무것도 안 바뀌었는데
   * "반려됐습니다"가 가면 사용자가 잔액을 다시 확인하러 온다.
   */
  async reject(input: {
    adminId: string;
    requestId: string;
    reason: string;
  }): Promise<RejectExchangeResult> {
    const reason = input.reason.trim();
    // 사유 검증이 가장 먼저다. 사유 없는 조치는 저장소도 원장도 안 건드린다.
    if (reason === '') {
      throw new AdminError(ADMIN_ERRORS.REASON_REQUIRED);
    }

    const current = await this.find(input.requestId);
    this.ensureCanMove(current.status, 'REJECTED');

    const rejected = await this.store.reject({
      requestId: current.id,
      userId: current.userId,
      amount: current.amount,
      expectedStatus: current.status,
      adminId: input.adminId,
      reason,
    });
    if (rejected === 'STALE') {
      throw new ExchangeError(EXCHANGE_ERRORS.INVALID_TRANSITION);
    }

    await this.notifications.publish({
      userId: current.userId,
      type: 'EXCHANGE_REJECTED',
      title: '환전 요청이 반려되었습니다',
      body: `사유: ${reason}`,
      linkUrl: '/my/account',
    });

    return {
      id: rejected.id,
      status: rejected.status,
      reverted: rejected.amount,
    };
  }

  /**
   * 이체할 때만 쓰는 평문 계좌번호. (AC4)
   *
   * **열람에 성공한 뒤에 로그를 남긴다.** 못 본 것을 봤다고 남기면 그 표가
   * 근거가 되지 못한다.
   */
  async revealAccount(input: {
    adminId: string;
    requestId: string;
  }): Promise<RevealedAccount> {
    const current = await this.find(input.requestId);
    const accountNumber = await this.accounts.revealForPayout(current.userId);

    await this.store.recordAudit({
      adminId: input.adminId,
      action: ADMIN_ACTIONS.EXCHANGE_ACCOUNT_REVEAL,
      targetId: current.id,
    });

    return { accountNumber };
  }

  /** 승인과 이체 완료가 공유하는 몸통. 다른 것은 목적지와 조치 이름뿐이다 */
  private async move(
    input: { adminId: string; requestId: string },
    nextStatus: ExchangeRequestStatus,
    action: AdminAction,
  ): Promise<ExchangeActionResult> {
    const current = await this.find(input.requestId);
    this.ensureCanMove(current.status, nextStatus);

    const moved = await this.store.updateStatus({
      requestId: current.id,
      expectedStatus: current.status,
      nextStatus,
      adminId: input.adminId,
      action,
    });
    if (moved === 'STALE') {
      // 우리가 읽은 뒤 다른 관리자가 먼저 눌렀다. 덮어쓰지 않는다.
      throw new ExchangeError(EXCHANGE_ERRORS.INVALID_TRANSITION);
    }

    return { id: moved.id, status: moved.status };
  }

  private async find(requestId: string): Promise<ExchangeRequestRecord> {
    const found = await this.store.findById(requestId);
    if (found === null) {
      throw new ExchangeError(EXCHANGE_ERRORS.REQUEST_NOT_FOUND);
    }
    return found;
  }

  private ensureCanMove(
    from: ExchangeRequestStatus,
    to: ExchangeRequestStatus,
  ): void {
    if (!canTransitionExchange(from, to)) {
      throw new ExchangeError(EXCHANGE_ERRORS.INVALID_TRANSITION);
    }
  }
}

function toSummary(row: AdminExchangeRow): AdminExchangeRequestSummary {
  return {
    id: row.id,
    requesterName: row.requesterName,
    amount: row.amount,
    status: row.status,
    requestedAt: row.createdAt.toISOString(),
    account:
      row.account === null
        ? null
        : {
            bankName: bankNameOf(row.account.bankCode),
            // 뒤 4자리만 나간다. 목록에 평문이 실릴 길이 없다 (`ADR-PAY-6`).
            maskedAccountNumber: maskAccountNumber(
              row.account.accountNumberLast4,
            ),
            holderName: row.account.holderName,
            verificationStatus: row.account.verificationStatus,
          },
  };
}
