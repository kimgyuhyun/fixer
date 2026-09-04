import { Injectable } from '@nestjs/common';
import {
  POINT_ERRORS,
  ledgerEntrySchema,
  type LedgerEntry,
  type PointErrorCode,
  type PointTransactionType,
} from '@fixer/shared';

/** 원장 한 줄 */
export interface PointTransactionRecord {
  id: string;
  userId: string;
  type: PointTransactionType;
  amount: number;
  idempotencyKey: string;
  sourcePaymentId: string | null;
  referenceId: string | null;
  createdAt: Date;
}

export interface PointLedgerStore {
  /**
   * 원장 행 하나를 쓰고 캐시를 함께 갱신한다.
   *
   * **잔액 검증까지 한 문장으로 한다** (ADR-PAY-2) — 읽고 쓰는 사이의 틈으로
   * 동시 요청 두 개가 모두 통과하는 것을 막는다.
   *
   * 잔액이 모자라면 `'INSUFFICIENT'`, 이미 있는 키면 그 행을 돌려준다.
   */
  append(
    entry: LedgerEntry,
  ): Promise<PointTransactionRecord | 'INSUFFICIENT' | 'DUPLICATE'>;
  /** 이미 쓰인 키의 행을 찾는다 */
  findByIdempotencyKey(key: string): Promise<PointTransactionRecord | null>;
  /** 원장 합계. **금전 판정은 항상 이걸로 한다** (ADR-PAY-1) */
  sumBalance(userId: string): Promise<number>;
  /** 표시용 캐시 */
  readCachedBalance(userId: string): Promise<number>;
}

/** 포인트가 던지는 도메인 에러 */
export class PointError extends Error {
  constructor(readonly code: PointErrorCode) {
    super(code);
    this.name = 'PointError';
  }
}

/**
 * 포인트 원장. (이슈 #27, `spec-fixed.md` §6.1)
 *
 * **잔액 컬럼을 직접 UPDATE 하지 않는다.** 원장에 행을 쌓고 그 합이 잔액이다.
 * `cachedBalance`는 표시용이며 어긋나면 원장 쪽이 맞다 (ADR-PAY-1).
 */
@Injectable()
export class PointLedgerService {
  constructor(private readonly store: PointLedgerStore) {}

  /** 원장에 한 줄 쓴다. 잔액이 모자라면 거절한다 */
  async record(entry: LedgerEntry): Promise<PointTransactionRecord> {
    // 모양부터 본다. 0원이나 소수가 원장에 들어가면 합계의 의미가 흐려진다.
    const checked = ledgerEntrySchema.parse(entry);

    const result = await this.store.append(checked);

    if (result === 'INSUFFICIENT') {
      throw new PointError(POINT_ERRORS.INSUFFICIENT_BALANCE);
    }

    if (result === 'DUPLICATE') {
      // 이미 처리된 것이다. 오류가 아니라 성공으로 본다 — 웹훅에 200을
      // 주지 않으면 포트원이 계속 재전송한다 (ADR-PAY-3).
      const existing = await this.store.findByIdempotencyKey(
        checked.idempotencyKey,
      );
      if (!existing) {
        // 방금 중복이라 했는데 못 찾는다. 저장소가 어긋난 것이다.
        throw new Error(
          `멱등 키 ${checked.idempotencyKey}가 중복이라 했으나 행을 찾을 수 없습니다.`,
        );
      }
      return existing;
    }

    return result;
  }

  /** 잔액. 진실의 원천은 원장이다 */
  async balanceOf(userId: string): Promise<number> {
    // 캐시가 아니라 원장 합계다. 캐시는 표시용이고 어긋나면 원장이 맞다.
    return this.store.sumBalance(userId);
  }
}
