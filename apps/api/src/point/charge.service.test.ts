import { PAYMENT_ERRORS, chargeIdempotencyKey } from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import {
  ChargeService,
  PaymentError,
  type GatewayPayment,
  type PaymentGateway,
  type PaymentRecord,
  type PaymentStore,
  type WebhookVerifier,
} from './charge.service';
import {
  PointLedgerService,
  type PointLedgerStore,
  type PointTransactionRecord,
} from './point-ledger.service';

const USER = 'usr_1';
const OTHER = 'usr_2';
const AMOUNT = 50_000;

/** 진짜 원장 서비스를 쓴다. 멱등은 원장이 책임지므로 가짜로 덮으면 못 본다 */
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

  private sum(userId: string): number {
    return this.rows
      .filter((r) => r.userId === userId)
      .reduce((total, r) => total + r.amount, 0);
  }
}

class FakePaymentStore implements PaymentStore {
  constructor(readonly rows: PaymentRecord[] = []) {}

  create(input: {
    id: string;
    userId: string;
    amount: number;
  }): Promise<PaymentRecord> {
    const row: PaymentRecord = { ...input, status: 'PENDING' };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  find(paymentId: string): Promise<PaymentRecord | null> {
    const found = this.rows.find((r) => r.id === paymentId);
    return Promise.resolve(found ? { ...found } : null);
  }

  markPaid(paymentId: string): Promise<void> {
    const found = this.rows.find((r) => r.id === paymentId);
    if (found) found.status = 'PAID';
    return Promise.resolve();
  }
}

/** 포트원 대역. **몇 번 물어봤는지 센다** — 안 물어보면 대조가 없는 것이다 */
class FakeGateway implements PaymentGateway {
  askedFor: string[] = [];
  constructor(private readonly answer: GatewayPayment | null) {}

  find(paymentId: string): Promise<GatewayPayment | null> {
    this.askedFor.push(paymentId);
    return Promise.resolve(this.answer);
  }
}

function verifier(ok: boolean): WebhookVerifier {
  return { verify: () => ok };
}

const PAYMENT_ID = 'pay_1';

function setup(
  opts: {
    /** 우리가 박아 둔 금액 */
    ourAmount?: number;
    ourStatus?: PaymentRecord['status'];
    ourUserId?: string;
    /** 포트원이 돌려주는 것 */
    gateway?: GatewayPayment | null;
    signatureOk?: boolean;
    /** 결제 건 자체를 안 만든다 */
    noPaymentRow?: boolean;
  } = {},
) {
  const payments = new FakePaymentStore(
    opts.noPaymentRow
      ? []
      : [
          {
            id: PAYMENT_ID,
            userId: opts.ourUserId ?? USER,
            amount: opts.ourAmount ?? AMOUNT,
            status: opts.ourStatus ?? 'PENDING',
          },
        ],
  );
  const gateway = new FakeGateway(
    opts.gateway === undefined
      ? { id: PAYMENT_ID, amount: AMOUNT, status: 'PAID' }
      : opts.gateway,
  );
  const ledgerStore = new FakeLedgerStore();
  const ledger = new PointLedgerService(ledgerStore);
  const service = new ChargeService(
    payments,
    gateway,
    ledger,
    verifier(opts.signatureOk ?? true),
  );
  return { service, payments, gateway, ledgerStore, ledger };
}

function webhookBody(paymentId = PAYMENT_ID): string {
  return JSON.stringify({ type: 'Transaction.Paid', data: { paymentId } });
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

describe('start — 결제 시작 (AC1)', () => {
  it('should create a pending payment row with the amount the server decided', async () => {
    const { service, payments } = setup({ noPaymentRow: true });

    const started = await service.start(USER, { amount: 30_000 });

    const stored = payments.rows.find((r) => r.id === started.paymentId);
    expect(stored).toMatchObject({
      userId: USER,
      amount: 30_000,
      status: 'PENDING',
    });
  });

  it('should return a paymentId the client can open the checkout with', async () => {
    const { service } = setup({ noPaymentRow: true });

    const started = await service.start(USER, { amount: 30_000 });

    expect(started.paymentId).toMatch(/^pay_/);
    expect(started.amount).toBe(30_000);
  });

  it('should reject an amount that is not a multiple of the charge unit', async () => {
    // 잔돈이 섞이면 환불 lot 소진에서 1원짜리 나머지가 남는다 (ADR-PAY-7).
    const { service, payments } = setup({ noPaymentRow: true });

    const error = await rejectionOf(service.start(USER, { amount: 1_500 }));

    expect(codeOf(error)).toBe(PAYMENT_ERRORS.INVALID_AMOUNT);
    expect(payments.rows).toHaveLength(0);
  });

  it('should reject an amount over the per-charge limit', async () => {
    const { service } = setup({ noPaymentRow: true });

    const error = await rejectionOf(service.start(USER, { amount: 2_000_000 }));

    expect(codeOf(error)).toBe(PAYMENT_ERRORS.INVALID_AMOUNT);
  });
});

describe('confirm — 금액을 서버가 다시 확인한다 (AC2)', () => {
  it('should ask the gateway for the payment instead of trusting the client', async () => {
    const { service, gateway } = setup();

    await service.confirm({ paymentId: PAYMENT_ID, userId: USER });

    expect(gateway.askedFor).toEqual([PAYMENT_ID]);
  });

  it('should record a CHARGE for the amount both sides agree on', async () => {
    const { service, ledgerStore } = setup();

    await service.confirm({ paymentId: PAYMENT_ID, userId: USER });

    expect(ledgerStore.rows).toHaveLength(1);
    expect(ledgerStore.rows[0]).toMatchObject({
      userId: USER,
      type: 'CHARGE',
      amount: AMOUNT,
      idempotencyKey: chargeIdempotencyKey(PAYMENT_ID),
      sourcePaymentId: PAYMENT_ID,
    });
  });

  it('should mark the payment row PAID', async () => {
    const { service, payments } = setup();

    await service.confirm({ paymentId: PAYMENT_ID, userId: USER });

    expect(payments.rows[0].status).toBe('PAID');
  });

  it('should report the balance as the ledger sum', async () => {
    const { service } = setup();

    const result = await service.confirm({
      paymentId: PAYMENT_ID,
      userId: USER,
    });

    expect(result).toMatchObject({ charged: AMOUNT, balance: AMOUNT });
    expect(result.applied).toBe(true);
  });
});

describe('confirm — 금액이 다르면 거절한다 (AC3)', () => {
  it('should reject with PAYMENT_AMOUNT_MISMATCH when the gateway amount differs', async () => {
    // 클라이언트가 금액을 바꿔 보내도 우리가 박아 둔 값과 대조하므로 걸린다.
    const { service } = setup({
      gateway: { id: PAYMENT_ID, amount: 1_000, status: 'PAID' },
    });

    const error = await rejectionOf(
      service.confirm({ paymentId: PAYMENT_ID, userId: USER }),
    );

    expect(codeOf(error)).toBe(PAYMENT_ERRORS.AMOUNT_MISMATCH);
  });

  it('should record nothing when the amount differs', async () => {
    const { service, ledgerStore, payments } = setup({
      gateway: { id: PAYMENT_ID, amount: 1_000, status: 'PAID' },
    });

    await rejectionOf(service.confirm({ paymentId: PAYMENT_ID, userId: USER }));

    expect(ledgerStore.rows).toHaveLength(0);
    expect(payments.rows[0].status).toBe('PENDING');
  });

  it('should reject with PAYMENT_NOT_PAID when the gateway says PENDING', async () => {
    const { service, ledgerStore } = setup({
      gateway: { id: PAYMENT_ID, amount: AMOUNT, status: 'PENDING' },
    });

    const error = await rejectionOf(
      service.confirm({ paymentId: PAYMENT_ID, userId: USER }),
    );

    expect(codeOf(error)).toBe(PAYMENT_ERRORS.NOT_PAID);
    expect(ledgerStore.rows).toHaveLength(0);
  });

  it('should reject a FAILED payment too', async () => {
    const { service } = setup({
      gateway: { id: PAYMENT_ID, amount: AMOUNT, status: 'FAILED' },
    });

    const error = await rejectionOf(
      service.confirm({ paymentId: PAYMENT_ID, userId: USER }),
    );

    expect(codeOf(error)).toBe(PAYMENT_ERRORS.NOT_PAID);
  });

  it('should reject with PAYMENT_NOT_FOUND when the gateway knows no such payment', async () => {
    const { service } = setup({ gateway: null });

    const error = await rejectionOf(
      service.confirm({ paymentId: PAYMENT_ID, userId: USER }),
    );

    expect(codeOf(error)).toBe(PAYMENT_ERRORS.NOT_FOUND);
  });

  it('should reject a payment that belongs to another member', async () => {
    // 남의 결제 건을 확정해 자기 잔액을 늘리는 길을 막는다.
    const { service, ledgerStore } = setup({ ourUserId: OTHER });

    const error = await rejectionOf(
      service.confirm({ paymentId: PAYMENT_ID, userId: USER }),
    );

    expect(codeOf(error)).toBe(PAYMENT_ERRORS.NOT_OWNED);
    expect(ledgerStore.rows).toHaveLength(0);
  });
});

describe('handleWebhook — 두 번 와도 한 건 (AC4)', () => {
  it('should record a CHARGE on the first delivery', async () => {
    const { service, ledgerStore } = setup();

    await service.handleWebhook(webhookBody(), {});

    expect(ledgerStore.rows).toHaveLength(1);
  });

  it('should record nothing more on the second delivery', async () => {
    const { service, ledgerStore } = setup();
    await service.handleWebhook(webhookBody(), {});

    await service.handleWebhook(webhookBody(), {});

    expect(ledgerStore.rows).toHaveLength(1);
  });

  it('should succeed on the second delivery instead of failing', async () => {
    // 200을 주지 않으면 포트원이 계속 재전송한다 (ADR-PAY-3).
    const { service } = setup();
    await service.handleWebhook(webhookBody(), {});

    const second = await service.handleWebhook(webhookBody(), {});

    expect(second.applied).toBe(false);
    expect(second.balance).toBe(AMOUNT);
  });

  it('should reject a body whose signature does not verify', async () => {
    const { service } = setup({ signatureOk: false });

    const error = await rejectionOf(service.handleWebhook(webhookBody(), {}));

    expect(codeOf(error)).toBe(PAYMENT_ERRORS.WEBHOOK_SIGNATURE_INVALID);
  });

  it('should record nothing when the signature is invalid', async () => {
    // 위조된 본문으로 잔액을 만들 수 있으면 나머지 검증이 전부 무의미하다.
    const { service, ledgerStore, gateway } = setup({ signatureOk: false });

    await rejectionOf(service.handleWebhook(webhookBody(), {}));

    expect(ledgerStore.rows).toHaveLength(0);
    expect(gateway.askedFor).toHaveLength(0);
  });

  it('should ignore the amount written in the webhook body and ask the gateway', async () => {
    // 서명이 맞아도 본문은 우리가 만든 것이 아니다.
    const { service, ledgerStore } = setup();
    const lyingBody = JSON.stringify({
      data: { paymentId: PAYMENT_ID, amount: 999_999_999 },
    });

    await service.handleWebhook(lyingBody, {});

    expect(ledgerStore.rows[0].amount).toBe(AMOUNT);
  });

  it('should reject a body that carries no paymentId', async () => {
    const { service } = setup();

    const error = await rejectionOf(service.handleWebhook('{}', {}));

    expect(codeOf(error)).toBe(PAYMENT_ERRORS.NOT_FOUND);
  });

  it('should record one CHARGE when the confirm API and the webhook both arrive', async () => {
    // 어느 쪽이 먼저 오든 결과가 같아야 한다는 것이 이 이슈의 핵심이다.
    const { service, ledgerStore } = setup();

    await service.confirm({ paymentId: PAYMENT_ID, userId: USER });
    await service.handleWebhook(webhookBody(), {});

    expect(ledgerStore.rows).toHaveLength(1);
    expect(
      await service.confirm({ paymentId: PAYMENT_ID, userId: USER }),
    ).toMatchObject({ applied: false, balance: AMOUNT });
  });
});
