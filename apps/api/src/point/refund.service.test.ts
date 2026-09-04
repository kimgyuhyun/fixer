import { PAYMENT_ERRORS, refundIdempotencyKey } from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import { PaymentError } from './charge.service';
import {
  PointLedgerService,
  type PointLedgerStore,
  type PointTransactionRecord,
} from './point-ledger.service';
import {
  RefundService,
  type RefundStore,
  type RefundableLot,
} from './refund.service';

const USER = 'usr_1';
const OTHER = 'usr_2';
const NOW = new Date();

/** 결제 건 하나. 잔여는 저장하지 않고 원장에서 센다 (ADR-PAY-7) */
interface PaymentRow {
  id: string;
  userId: string;
  amount: number;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  createdAt: Date;
  refundableUntil: Date | null;
}

function payment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 'pay_1',
    userId: USER,
    amount: 50_000,
    status: 'PAID',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    refundableUntil: null,
    ...overrides,
  };
}

class FakeLedgerStore implements PointLedgerStore {
  readonly rows: PointTransactionRecord[] = [];
  private seq = 0;

  append(entry: {
    userId: string;
    type: PointTransactionRecord['type'];
    amount: number;
    idempotencyKey: string;
    sourcePaymentId?: string | null;
    referenceId?: string | null;
  }): Promise<PointTransactionRecord | 'INSUFFICIENT' | 'DUPLICATE'> {
    if (this.rows.some((r) => r.idempotencyKey === entry.idempotencyKey)) {
      return Promise.resolve('DUPLICATE');
    }
    if (entry.amount < 0 && this.sum(entry.userId) + entry.amount < 0) {
      return Promise.resolve('INSUFFICIENT');
    }
    const row: PointTransactionRecord = {
      id: `ptx_${++this.seq}`,
      userId: entry.userId,
      type: entry.type,
      amount: entry.amount,
      idempotencyKey: entry.idempotencyKey,
      sourcePaymentId: entry.sourcePaymentId ?? null,
      referenceId: entry.referenceId ?? null,
      createdAt: new Date(),
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

  readCachedBalance(userId: string): Promise<number> {
    return Promise.resolve(this.sum(userId));
  }

  /** lot 잔여. **컬럼이 아니라 원장 합이다** (ADR-PAY-7) */
  lotRemaining(paymentId: string): number {
    return this.rows
      .filter((r) => r.sourcePaymentId === paymentId)
      .reduce((total, r) => total + r.amount, 0);
  }

  private sum(userId: string): number {
    return this.rows
      .filter((r) => r.userId === userId)
      .reduce((total, r) => total + r.amount, 0);
  }
}

class FakeRefundStore implements RefundStore {
  constructor(
    readonly payments: PaymentRow[],
    private readonly ledger: FakeLedgerStore,
  ) {}

  listRefundableLots(userId: string): Promise<RefundableLot[]> {
    return Promise.resolve(
      this.payments
        .filter((p) => p.userId === userId && p.status === 'PAID')
        // 오래된 것부터. 카드 취소 기한이 그쪽부터 먼저 만료된다.
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((p) => this.toLot(p)),
    );
  }

  findLot(paymentId: string): Promise<
    | (RefundableLot & {
        userId: string;
        status: 'PENDING' | 'PAID' | 'CANCELLED';
      })
    | null
  > {
    const found = this.payments.find((p) => p.id === paymentId);
    if (!found) return Promise.resolve(null);
    return Promise.resolve({
      ...this.toLot(found),
      userId: found.userId,
      status: found.status,
    });
  }

  markCancelled(paymentId: string): Promise<void> {
    const found = this.payments.find((p) => p.id === paymentId);
    if (found) found.status = 'CANCELLED';
    return Promise.resolve();
  }

  private toLot(p: PaymentRow): RefundableLot {
    return {
      paymentId: p.id,
      remaining: this.ledger.lotRemaining(p.id),
      refundableUntil: p.refundableUntil,
    };
  }
}

/** 충전과 소비를 원장에 먼저 쌓아 상황을 만든다 */
async function setup(
  payments: PaymentRow[],
  spend = 0,
): Promise<{
  service: RefundService;
  ledgerStore: FakeLedgerStore;
  payments: PaymentRow[];
}> {
  const ledgerStore = new FakeLedgerStore();
  for (const p of payments) {
    if (p.status === 'PENDING') continue;
    await ledgerStore.append({
      userId: p.userId,
      type: 'CHARGE',
      amount: p.amount,
      idempotencyKey: `charge:${p.id}`,
      sourcePaymentId: p.id,
    });
  }
  if (spend > 0) {
    // 쓴 돈은 lot에 붙이지 않는다 — HOLD의 FIFO 소진은 #16 몫이다.
    await ledgerStore.append({
      userId: USER,
      type: 'HOLD',
      amount: -spend,
      idempotencyKey: `hold:${spend}`,
    });
  }

  const store = new FakeRefundStore(payments, ledgerStore);
  const service = new RefundService(store, new PointLedgerService(ledgerStore));
  return { service, ledgerStore, payments };
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
  expect(error).toBeInstanceOf(PaymentError);
  return (error as PaymentError).code;
}

describe('cancelPayment — 쓰지 않은 포인트를 환불한다 (AC1)', () => {
  it('should record a REFUND for the whole payment', async () => {
    const { service, ledgerStore } = await setup([payment()]);

    await service.cancelPayment({ userId: USER, paymentId: 'pay_1' });

    const refunds = ledgerStore.rows.filter((r) => r.type === 'REFUND');
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBe(-50_000);
  });

  it('should reduce the balance by the refunded amount', async () => {
    const { service } = await setup([payment()]);

    const result = await service.cancelPayment({
      userId: USER,
      paymentId: 'pay_1',
    });

    expect(result).toMatchObject({ refunded: 50_000, balance: 0 });
  });

  it('should mark the payment CANCELLED', async () => {
    const { service, payments } = await setup([payment()]);

    await service.cancelPayment({ userId: USER, paymentId: 'pay_1' });

    expect(payments[0].status).toBe('CANCELLED');
  });

  it('should point the REFUND row at the payment it came from', async () => {
    // 어느 카드에 얼마가 나갔는지가 원장에 남아야 한다 (ADR-PAY-7).
    const { service, ledgerStore } = await setup([payment()]);

    const result = await service.cancelPayment({
      userId: USER,
      paymentId: 'pay_1',
    });

    expect(result.lots).toEqual([{ paymentId: 'pay_1', amount: 50_000 }]);
    const refund = ledgerStore.rows.find((r) => r.type === 'REFUND');
    expect(refund?.sourcePaymentId).toBe('pay_1');
  });
});

describe('cancelPayment — 잔액이 모자라면 막힌다 (AC2)', () => {
  it('should reject with PAYMENT_INSUFFICIENT_BALANCE when the points were already spent', async () => {
    // 쓴 돈은 우리 손을 떠났으므로 카드로 돌려줄 수 없다.
    const { service } = await setup([payment()], 20_000);

    const error = await rejectionOf(
      service.cancelPayment({ userId: USER, paymentId: 'pay_1' }),
    );

    expect(codeOf(error)).toBe(PAYMENT_ERRORS.INSUFFICIENT_BALANCE);
  });

  it('should record nothing when the balance is short', async () => {
    const { service, ledgerStore, payments } = await setup([payment()], 20_000);

    await rejectionOf(
      service.cancelPayment({ userId: USER, paymentId: 'pay_1' }),
    );

    expect(ledgerStore.rows.filter((r) => r.type === 'REFUND')).toHaveLength(0);
    expect(payments[0].status).toBe('PAID');
  });

  it('should allow a refund that leaves the balance exactly zero', async () => {
    const { service } = await setup([payment()]);

    const result = await service.cancelPayment({
      userId: USER,
      paymentId: 'pay_1',
    });

    expect(result.balance).toBe(0);
  });

  it('should reject a payment that belongs to another member', async () => {
    const { service } = await setup([payment({ userId: OTHER })]);

    const error = await rejectionOf(
      service.cancelPayment({ userId: USER, paymentId: 'pay_1' }),
    );

    expect(codeOf(error)).toBe(PAYMENT_ERRORS.NOT_OWNED);
  });

  it('should reject a payment that was never paid', async () => {
    const { service } = await setup([payment({ status: 'PENDING' })]);

    const error = await rejectionOf(
      service.cancelPayment({ userId: USER, paymentId: 'pay_1' }),
    );

    expect(codeOf(error)).toBe(PAYMENT_ERRORS.NOT_PAID);
  });

  it('should reject a payment nobody has', async () => {
    const { service } = await setup([payment()]);

    const error = await rejectionOf(
      service.cancelPayment({ userId: USER, paymentId: 'pay_missing' }),
    );

    expect(codeOf(error)).toBe(PAYMENT_ERRORS.NOT_FOUND);
  });
});

describe('cancelPayment — 두 번 취소해도 한 번 (AC3)', () => {
  it('should record nothing more on the second cancel', async () => {
    const { service, ledgerStore } = await setup([payment()]);
    await service.cancelPayment({ userId: USER, paymentId: 'pay_1' });

    await service.cancelPayment({ userId: USER, paymentId: 'pay_1' });

    expect(ledgerStore.rows.filter((r) => r.type === 'REFUND')).toHaveLength(1);
  });

  it('should report the same balance on the second cancel', async () => {
    const { service } = await setup([payment()]);
    await service.cancelPayment({ userId: USER, paymentId: 'pay_1' });

    const second = await service.cancelPayment({
      userId: USER,
      paymentId: 'pay_1',
    });

    expect(second.balance).toBe(0);
  });

  it('should say it was not applied on the second cancel', async () => {
    const { service } = await setup([payment()]);
    await service.cancelPayment({ userId: USER, paymentId: 'pay_1' });

    const second = await service.cancelPayment({
      userId: USER,
      paymentId: 'pay_1',
    });

    expect(second.applied).toBe(false);
  });

  it('should build the same idempotency key both times', async () => {
    // 요청마다 새 키를 만들면 재시도가 두 번 빠져나간다.
    const { service, ledgerStore } = await setup([payment()]);

    await service.cancelPayment({ userId: USER, paymentId: 'pay_1' });

    expect(ledgerStore.rows.at(-1)?.idempotencyKey).toBe(
      refundIdempotencyKey('pay_1', 0),
    );
  });
});

describe('refund — 오래된 결제 건부터 소진한다 (ADR-PAY-7)', () => {
  /**
   * **함수로 둔다.** 상수로 두면 `markCancelled`가 그 객체를 고쳐서
   * 다음 테스트가 이미 취소된 lot을 물려받는다 — 실제로 한 번 당했다.
   */
  const older = () =>
    payment({
      id: 'pay_old',
      amount: 50_000,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    });
  const newer = () =>
    payment({
      id: 'pay_new',
      amount: 150_000,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });

  it('should take from the oldest payment first', async () => {
    // 최신 것부터 쓰면 오래된 건이 남았다가 기한이 지나 환불 불가가 된다.
    const { service } = await setup([newer(), older()]);

    const result = await service.refund({ userId: USER, amount: 30_000 });

    expect(result.lots).toEqual([{ paymentId: 'pay_old', amount: 30_000 }]);
  });

  it('should spread one refund across two lots when the first is not enough', async () => {
    // 사용자가 든 예: 5만 + 15만 충전, 6.5만 사용, 5.5만 환불
    const { service } = await setup([newer(), older()], 65_000);

    const result = await service.refund({ userId: USER, amount: 55_000 });

    expect(result.lots).toEqual([
      { paymentId: 'pay_old', amount: 50_000 },
      { paymentId: 'pay_new', amount: 5_000 },
    ]);
    expect(result.balance).toBe(80_000);
  });

  it('should take only what is left in a partly refunded lot', async () => {
    const { service } = await setup([newer(), older()]);
    await service.refund({ userId: USER, amount: 20_000 });

    const result = await service.refund({ userId: USER, amount: 40_000 });

    expect(result.lots).toEqual([
      { paymentId: 'pay_old', amount: 30_000 },
      { paymentId: 'pay_new', amount: 10_000 },
    ]);
  });

  it('should skip a lot whose refund deadline has passed', async () => {
    // 기한이 지난 lot은 카드로 되돌릴 수 없다.
    const expired = payment({
      id: 'pay_old',
      amount: 50_000,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      refundableUntil: new Date(NOW.getTime() - 1000),
    });
    const { service } = await setup([newer(), expired]);

    const result = await service.refund({ userId: USER, amount: 30_000 });

    expect(result.lots).toEqual([{ paymentId: 'pay_new', amount: 30_000 }]);
  });

  it('should reject when the amount is larger than the balance', async () => {
    const { service } = await setup([older()], 40_000);

    const error = await rejectionOf(
      service.refund({ userId: USER, amount: 20_000 }),
    );

    expect(codeOf(error)).toBe(PAYMENT_ERRORS.INSUFFICIENT_BALANCE);
  });

  it('should reject when only expired lots are left', async () => {
    const expired = payment({
      refundableUntil: new Date(NOW.getTime() - 1000),
    });
    const { service, ledgerStore } = await setup([expired]);

    const error = await rejectionOf(
      service.refund({ userId: USER, amount: 10_000 }),
    );

    expect(codeOf(error)).toBe(PAYMENT_ERRORS.NO_REFUNDABLE_LOT);
    // 잔액은 있으므로 앞의 잔액 검사는 통과한다. 그래도 원장은 안 건드린다.
    expect(ledgerStore.rows.filter((r) => r.type === 'REFUND')).toHaveLength(0);
  });

  it('should record one ledger row per lot so each card cancel is traceable', async () => {
    const { service, ledgerStore } = await setup([newer(), older()], 65_000);

    await service.refund({ userId: USER, amount: 55_000 });

    const refunds = ledgerStore.rows.filter((r) => r.type === 'REFUND');
    expect(refunds.map((r) => r.sourcePaymentId)).toEqual([
      'pay_old',
      'pay_new',
    ]);
  });

  it('should reject a zero or negative amount', async () => {
    const { service } = await setup([older()]);

    expect(
      codeOf(await rejectionOf(service.refund({ userId: USER, amount: 0 }))),
    ).toBe(PAYMENT_ERRORS.INVALID_AMOUNT);
  });
});

describe('lot 잔여는 원장에서 나온다 (ADR-PAY-7)', () => {
  it('should report the charge minus every refund of that payment', async () => {
    const { service, ledgerStore } = await setup([payment()]);

    await service.refund({ userId: USER, amount: 20_000 });

    expect(ledgerStore.lotRemaining('pay_1')).toBe(30_000);
  });

  it('should report zero for a fully refunded payment', async () => {
    const { service, ledgerStore } = await setup([payment()]);

    await service.cancelPayment({ userId: USER, paymentId: 'pay_1' });

    expect(ledgerStore.lotRemaining('pay_1')).toBe(0);
  });
});
