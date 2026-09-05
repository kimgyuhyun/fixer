import { describe, expect, it } from 'vitest';
import {
  PointHistoryService,
  type PointHistoryStore,
} from './point-history.service';
import type { PointTransactionRecord } from './point-ledger.service';

const USER = 'usr_1';

function tx(
  overrides: Partial<PointTransactionRecord> = {},
): PointTransactionRecord {
  return {
    id: 'ptx_1',
    userId: USER,
    type: 'CHARGE',
    amount: 50_000,
    idempotencyKey: 'charge:pay_1',
    sourcePaymentId: 'pay_1',
    referenceId: null,
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    ...overrides,
  };
}

/**
 * 합계와 캐시를 **일부러 어긋뜨린다.** 서비스가 캐시를 보면 테스트가 잡는다 —
 * 캐시를 보여주면 어긋났을 때 사용자가 없는 돈을 쓰려 한다 (ADR-PAY-1).
 */
function storeWith(
  rows: PointTransactionRecord[],
  cached = 999_999,
): PointHistoryStore {
  return {
    listByUser: (userId, limit) =>
      Promise.resolve(rows.filter((r) => r.userId === userId).slice(0, limit)),
    sumBalance: (userId) =>
      Promise.resolve(
        rows
          .filter((r) => r.userId === userId)
          .reduce((total, r) => total + r.amount, 0),
      ),
    readCachedBalance: () => Promise.resolve(cached),
    append: () => {
      throw new Error('내역 조회는 원장에 쓰지 않는다');
    },
    findByIdempotencyKey: () => {
      throw new Error('내역 조회는 멱등 키를 보지 않는다');
    },
  };
}

describe('readHistory — 내역에서 보인다 (AC5)', () => {
  it('should list the charge with its amount and time', async () => {
    const service = new PointHistoryService(storeWith([tx()]));

    const history = await service.read(USER);

    expect(history.transactions).toEqual([
      {
        id: 'ptx_1',
        type: 'CHARGE',
        amount: 50_000,
        createdAt: '2026-09-01T10:00:00.000Z',
      },
    ]);
  });

  it('should report the balance as the ledger sum, not the cached value', async () => {
    const service = new PointHistoryService(
      storeWith([tx(), tx({ id: 'ptx_2', amount: -6_000, type: 'HOLD' })]),
    );

    const history = await service.read(USER);

    expect(history.balance).toBe(44_000);
  });

  it('should list nothing for a member who never charged', async () => {
    const service = new PointHistoryService(storeWith([tx()]));

    const history = await service.read('usr_stranger');

    expect(history.transactions).toHaveLength(0);
    expect(history.balance).toBe(0);
  });
});
