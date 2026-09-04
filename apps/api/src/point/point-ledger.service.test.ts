import { POINT_ERRORS, type LedgerEntry } from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import {
  PointLedgerService,
  type PointLedgerStore,
  type PointTransactionRecord,
} from './point-ledger.service';

const USER = 'usr_1';
const NOW = new Date('2026-09-04T00:00:00.000Z');

/**
 * 가짜 저장소지만 **진짜와 같은 규칙을 지킨다** — 잔액 검증과 멱등을
 * 저장소가 원자적으로 하는 구조라(ADR-PAY-2·3), 여기서도 그렇게 해야
 * 서비스가 저장소에 무엇을 맡겼는지가 드러난다.
 */
class FakeLedgerStore implements PointLedgerStore {
  readonly rows: PointTransactionRecord[] = [];

  append(
    entry: LedgerEntry,
  ): Promise<PointTransactionRecord | 'INSUFFICIENT' | 'DUPLICATE'> {
    if (this.rows.some((r) => r.idempotencyKey === entry.idempotencyKey)) {
      return Promise.resolve('DUPLICATE');
    }

    // 조건부 UPDATE 한 문장이 하는 일과 같다. 잔액이 모자라면 아무것도 안 쓴다.
    const balance = this.sum(entry.userId);
    if (entry.amount < 0 && balance + entry.amount < 0) {
      return Promise.resolve('INSUFFICIENT');
    }

    const row: PointTransactionRecord = {
      id: `ptx_${this.rows.length + 1}`,
      userId: entry.userId,
      type: entry.type,
      amount: entry.amount,
      idempotencyKey: entry.idempotencyKey,
      sourcePaymentId: entry.sourcePaymentId ?? null,
      referenceId: entry.referenceId ?? null,
      createdAt: NOW,
    };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  findByIdempotencyKey(key: string): Promise<PointTransactionRecord | null> {
    return Promise.resolve(
      this.rows.find((r) => r.idempotencyKey === key) ?? null,
    );
  }

  sumBalance(userId: string): Promise<number> {
    return Promise.resolve(this.sum(userId));
  }

  /** 캐시도 원장에서 만든다. 어긋날 자리를 두지 않는다 */
  readCachedBalance(userId: string): Promise<number> {
    return Promise.resolve(this.sum(userId));
  }

  private sum(userId: string): number {
    return this.rows
      .filter((r) => r.userId === userId)
      .reduce((acc, r) => acc + r.amount, 0);
  }
}

function setup() {
  const store = new FakeLedgerStore();
  return { service: new PointLedgerService(store), store };
}

let keyCounter = 0;
function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  keyCounter += 1;
  return {
    userId: USER,
    type: 'CHARGE',
    amount: 10_000,
    idempotencyKey: `key_${keyCounter}`,
    ...overrides,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

function codeOf(error: unknown): unknown {
  return (error as { code?: unknown }).code;
}

describe('record — 잔액 계산', () => {
  it('should make the balance 10000 after CHARGE 10000', async () => {
    const { service } = setup();

    await service.record(entry({ type: 'CHARGE', amount: 10_000 }));

    await expect(service.balanceOf(USER)).resolves.toBe(10_000);
  });

  it('should return zero for a member with no ledger rows', async () => {
    const { service } = setup();

    await expect(service.balanceOf('usr_nobody')).resolves.toBe(0);
  });

  it('should keep the cached balance equal to the ledger sum', async () => {
    // AC6. 어긋나면 캐시를 버린다 — 원장이 진실이다 (ADR-PAY-1).
    const { service, store } = setup();
    await service.record(entry({ type: 'CHARGE', amount: 10_000 }));
    await service.record(entry({ type: 'HOLD', amount: -3_000 }));

    await expect(store.readCachedBalance(USER)).resolves.toBe(
      await store.sumBalance(USER),
    );
  });

  it('should sum many rows of mixed types correctly', async () => {
    const { service } = setup();
    await service.record(entry({ type: 'CHARGE', amount: 50_000 }));
    await service.record(entry({ type: 'HOLD', amount: -30_000 }));
    await service.record(entry({ type: 'RELEASE', amount: 10_000 }));
    await service.record(entry({ type: 'REFUND', amount: -5_000 }));

    // 50000 − 30000 + 10000 − 5000
    await expect(service.balanceOf(USER)).resolves.toBe(25_000);
  });
});

describe('record — 잔액 부족', () => {
  it('should reject HOLD 12000 with POINT_INSUFFICIENT_BALANCE when the balance is 10000', async () => {
    const { service } = setup();
    await service.record(entry({ type: 'CHARGE', amount: 10_000 }));

    const error = await rejectionOf(
      service.record(entry({ type: 'HOLD', amount: -12_000 })),
    );

    expect(codeOf(error)).toBe(POINT_ERRORS.INSUFFICIENT_BALANCE);
  });

  it('should leave nothing in the ledger when it rejected', async () => {
    // AC2. 거절된 시도가 원장에 흔적을 남기면 합계가 틀어진다.
    const { service, store } = setup();
    await service.record(entry({ type: 'CHARGE', amount: 10_000 }));

    await rejectionOf(service.record(entry({ type: 'HOLD', amount: -12_000 })));

    expect(store.rows).toHaveLength(1);
    await expect(service.balanceOf(USER)).resolves.toBe(10_000);
  });

  it('should allow spending exactly the whole balance', async () => {
    // 경계는 열린 쪽이다. 잔액을 정확히 다 쓰는 것은 정상이다.
    const { service } = setup();
    await service.record(entry({ type: 'CHARGE', amount: 10_000 }));

    await service.record(entry({ type: 'HOLD', amount: -10_000 }));

    await expect(service.balanceOf(USER)).resolves.toBe(0);
  });

  it('should reject spending one point more than the balance', async () => {
    const { service } = setup();
    await service.record(entry({ type: 'CHARGE', amount: 10_000 }));

    const error = await rejectionOf(
      service.record(entry({ type: 'HOLD', amount: -10_001 })),
    );

    expect(codeOf(error)).toBe(POINT_ERRORS.INSUFFICIENT_BALANCE);
  });
});

describe('record — 잠금과 반환', () => {
  it('should bring the balance back after HOLD 6000 then RELEASE 6000', async () => {
    const { service } = setup();
    await service.record(entry({ type: 'CHARGE', amount: 10_000 }));

    await service.record(entry({ type: 'HOLD', amount: -6_000 }));
    await service.record(entry({ type: 'RELEASE', amount: 6_000 }));

    await expect(service.balanceOf(USER)).resolves.toBe(10_000);
  });

  it('should allow a second HOLD after the first was released', async () => {
    const { service } = setup();
    await service.record(entry({ type: 'CHARGE', amount: 10_000 }));
    await service.record(entry({ type: 'HOLD', amount: -10_000 }));
    await service.record(entry({ type: 'RELEASE', amount: 10_000 }));

    await service.record(entry({ type: 'HOLD', amount: -10_000 }));

    await expect(service.balanceOf(USER)).resolves.toBe(0);
  });
});

describe('record — 멱등', () => {
  it('should write only one row for the same idempotencyKey', async () => {
    // AC4. 웹훅은 재전송된다. 중복 충전은 곧바로 금전 사고다.
    const { service, store } = setup();
    const same = entry({ type: 'CHARGE', amount: 10_000 });

    await service.record(same);
    await service.record(same);

    expect(store.rows).toHaveLength(1);
  });

  it('should return the existing row when the key was already used', async () => {
    const { service } = setup();
    const same = entry({ type: 'CHARGE', amount: 10_000 });
    const first = await service.record(same);

    const second = await service.record(same);

    expect(second.id).toBe(first.id);
  });

  it('should not change the balance on the duplicate write', async () => {
    const { service } = setup();
    const same = entry({ type: 'CHARGE', amount: 10_000 });
    await service.record(same);

    await service.record(same);

    await expect(service.balanceOf(USER)).resolves.toBe(10_000);
  });
});

describe('record — 입력 검증', () => {
  it('should reject a zero amount', async () => {
    // 아무것도 바꾸지 않는 행은 원장을 읽기만 어렵게 한다
    const { service } = setup();

    await rejectionOf(service.record(entry({ amount: 0 })));
  });

  it('should reject a fractional amount', async () => {
    // 1포인트 = 1원이라 소수가 없다 (spec-fixed §0)
    const { service } = setup();

    await rejectionOf(service.record(entry({ amount: 1_000.5 })));
  });
});
