import { Injectable } from '@nestjs/common';
import {
  EXCHANGE_ERRORS,
  POINT_ERRORS,
  checkExchangeAmount,
  maturityCutoff,
  requestExchangeSchema,
  type ExchangeErrorCode,
  type ExchangeRequestStatus,
  type ExchangeRequestSummary,
  type RequestExchange,
} from '@fixer/shared';
import { PointError } from '../point/point-ledger.service';
import type { ExchangeAccountStore } from './exchange-account.service';

/** 환전이 던지는 도메인 에러 */
export class ExchangeError extends Error {
  constructor(readonly code: ExchangeErrorCode) {
    super(code);
    this.name = 'ExchangeError';
  }
}

/** 저장된 환전 요청 한 건 */
export interface ExchangeRequestRecord {
  id: string;
  userId: string;
  amount: number;
  status: ExchangeRequestStatus;
  createdAt: Date;
}

/**
 * 성숙한 포인트를 읽는 포트.
 *
 * `maturedBefore` 이전에 `PAYOUT`된 합계에서 이미 환전에 쓴 만큼을 빼고
 * 반려로 되돌아온 만큼을 더한다. **캐시가 아니라 원장을 합산한다**
 * (`ADR-PAY-1`).
 */
export interface MaturedPointReader {
  maturedBalanceOf(userId: string, maturedBefore: Date): Promise<number>;
}

/**
 * 환전 요청 저장소.
 *
 * **게이트 재확인이 트랜잭션 안에 있다.** 서비스의 성숙액 검사는 1차 방어이고,
 * 우리가 읽은 뒤 다른 요청이 먼저 쓴 경우는 여기가 잡는다 —
 * `application.service`의 `'STALE'`과 같은 자리다.
 */
export interface ExchangeRequestStore {
  create(input: {
    userId: string;
    amount: number;
  }): Promise<ExchangeRequestRecord | 'INSUFFICIENT' | 'NOT_MATURED'>;
}

/**
 * 환전 요청. (이슈 #31, `spec-fixed.md` §6.4.1)
 *
 * 네 개의 게이트를 순서대로 지난다 — 최소금액 · 단위 · 계좌 검증 · 성숙도.
 * **하나라도 빠지면 돈이 새는 쪽으로 샌다.**
 */
@Injectable()
export class ExchangeRequestService {
  constructor(
    private readonly store: ExchangeRequestStore,
    private readonly accounts: ExchangeAccountStore,
    private readonly matured: MaturedPointReader,
  ) {}

  async request(input: RequestExchange): Promise<ExchangeRequestSummary> {
    const parsed = requestExchangeSchema.parse(input);

    // 입력값이 전제조건보다 먼저다. 잘못 친 숫자 때문에 DB를 읽지 않는다.
    const checked = checkExchangeAmount(parsed.amount);
    if (!checked.ok) {
      throw new ExchangeError(checked.code);
    }

    const account = await this.accounts.findByUser(parsed.userId);
    // 미등록도 같은 코드다. 요청하는 쪽에서 대응이 같다.
    if (account?.verificationStatus !== 'VERIFIED') {
      throw new ExchangeError(EXCHANGE_ERRORS.ACCOUNT_NOT_VERIFIED);
    }

    // **1차 방어다.** 우리가 읽은 뒤 다른 요청이 먼저 쓴 경우는 저장소가 잡는다.
    const matured = await this.matured.maturedBalanceOf(
      parsed.userId,
      maturityCutoff(),
    );
    if (matured < parsed.amount) {
      throw new ExchangeError(EXCHANGE_ERRORS.NOT_MATURED);
    }

    const created = await this.store.create({
      userId: parsed.userId,
      amount: parsed.amount,
    });

    if (created === 'INSUFFICIENT') {
      // 성숙한 포인트는 있지만 잔액이 잠겨 있다 — 자기 공고에 `HOLD`가 걸린
      // 경우다. 새 코드를 만들지 않고 #27의 것을 그대로 쓴다.
      throw new PointError(POINT_ERRORS.INSUFFICIENT_BALANCE);
    }
    if (created === 'NOT_MATURED') {
      // 우리가 센 뒤 같은 회원의 다른 요청이 먼저 커밋했다. **저장소가 최종
      // 판정자다** — 성숙액은 컬럼이 아니라 조건부 UPDATE의 보호를 못 받는다.
      throw new ExchangeError(EXCHANGE_ERRORS.NOT_MATURED);
    }

    return {
      id: created.id,
      amount: created.amount,
      status: created.status,
      requestedAt: created.createdAt.toISOString(),
    };
  }
}
