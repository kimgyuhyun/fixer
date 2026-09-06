import { Injectable } from '@nestjs/common';
import type {
  ExchangeErrorCode,
  ExchangeRequestStatus,
  ExchangeRequestSummary,
  RequestExchange,
} from '@fixer/shared';
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

  request(input: RequestExchange): Promise<ExchangeRequestSummary> {
    throw new Error('not implemented');
  }
}
