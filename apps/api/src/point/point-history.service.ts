import { Injectable } from '@nestjs/common';
import type { PointHistory } from '@fixer/shared';
import type {
  PointLedgerStore,
  PointTransactionRecord,
} from './point-ledger.service';

/** 내역 조회에 필요한 만큼만 여는 포트 */
export interface PointHistoryStore extends PointLedgerStore {
  /** 최근 것부터. 원장은 append-only라 정렬이 곧 시간순이다 */
  listByUser(userId: string, limit: number): Promise<PointTransactionRecord[]>;
}

/** 한 번에 보여줄 줄 수. 무한정 내려주면 첫 화면이 느려진다 */
export const POINT_HISTORY_LIMIT = 50;

/**
 * 포인트 잔액과 내역. (이슈 #28 AC5)
 *
 * 잔액은 **원장 합계**다 (ADR-PAY-1). 캐시를 보여주면 어긋났을 때 사용자가
 * 없는 돈을 쓰려 한다.
 */
@Injectable()
export class PointHistoryService {
  constructor(private readonly store: PointHistoryStore) {}

  async read(userId: string): Promise<PointHistory> {
    const [balance, rows] = await Promise.all([
      this.store.sumBalance(userId),
      this.store.listByUser(userId, POINT_HISTORY_LIMIT),
    ]);

    return {
      balance,
      transactions: rows.map((row) => ({
        id: row.id,
        type: row.type,
        amount: row.amount,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}
