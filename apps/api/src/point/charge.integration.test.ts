import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import {
  ChargeService,
  PaymentError,
  type GatewayPayment,
  type PaymentGateway,
  type WebhookVerifier,
} from './charge.service';
import { PAYMENT_ERRORS } from '@fixer/shared';
import { PointLedgerService } from './point-ledger.service';
import { PrismaPaymentStore } from './prisma-payment.store';
import { PrismaPointLedgerStore } from './prisma-point-ledger.store';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * **웹훅 멱등은 진짜 DB에서만 증명된다.** (이슈 #28 AC4)
 *
 * 가짜 저장소의 `some(...)` 검사는 두 요청이 같은 순간에 들어와도 순서대로
 * 실행되므로 통과한다. 실제로 막는 것은 유니크 인덱스이고, 그건 Postgres만
 * 갖고 있다 (ADR-PAY-3).
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let service: ChargeService;
let payments: PrismaPaymentStore;

const USER_EMAIL = 'buyer@example.com';
const AMOUNT = 50_000;

/**
 * 우리가 박아 둔 금액을 그대로 PAID로 답한다.
 *
 * `gatewayAmountOverride`를 두는 이유는, 금액 불일치를 만들려면 **포트원이
 * 우리와 다른 값을 말하는** 상황이어야 하기 때문이다. DB의 금액을 고치면
 * 이 가짜도 같은 값을 읽어 둘이 다시 일치해 버린다.
 */
let gatewayAmountOverride: number | null = null;

const gateway: PaymentGateway = {
  async find(paymentId: string): Promise<GatewayPayment | null> {
    const row = await prisma.payment.findUnique({ where: { id: paymentId } });
    return row === null
      ? null
      : {
          id: row.id,
          amount: gatewayAmountOverride ?? row.amount,
          status: 'PAID',
        };
  },
};

const alwaysValid: WebhookVerifier = { verify: () => true };

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  payments = new PrismaPaymentStore(prisma as unknown as PrismaService);
  const ledger = new PointLedgerService(
    new PrismaPointLedgerStore(prisma as unknown as PrismaService),
  );
  service = new ChargeService(payments, gateway, ledger, alwaysValid);
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  gatewayAmountOverride = null;
  await prisma.pointTransaction.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.user.deleteMany();
});

async function seedMember(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: USER_EMAIL, passwordHash: 'hash', name: '구인자' },
  });
  return user.id;
}

function webhookBody(paymentId: string): string {
  return JSON.stringify({ type: 'Transaction.Paid', data: { paymentId } });
}

describe('충전 — 진짜 Postgres에서', () => {
  it('should leave the balance equal to the charged amount', async () => {
    const userId = await seedMember();
    const started = await service.start(userId, { amount: AMOUNT });

    const result = await service.confirm({
      paymentId: started.paymentId,
      userId,
    });

    expect(result.balance).toBe(AMOUNT);
    expect(result.applied).toBe(true);
    expect(await prisma.pointTransaction.count({ where: { userId } })).toBe(1);
  });

  it('should record exactly one CHARGE when the same webhook arrives twice at once', async () => {
    // 순서대로 두 번이 아니라 **동시에** 두 번이다. 유니크 인덱스가 없으면
    // 둘 다 통과해 잔액이 두 배가 된다 — 곧바로 금전 사고다.
    const userId = await seedMember();
    const started = await service.start(userId, { amount: AMOUNT });
    const body = webhookBody(started.paymentId);

    const results = await Promise.allSettled([
      service.handleWebhook(body, {}),
      service.handleWebhook(body, {}),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded).toHaveLength(2);
    expect(await prisma.pointTransaction.count({ where: { userId } })).toBe(1);

    const rows = await prisma.pointTransaction.findMany({ where: { userId } });
    expect(rows[0].amount).toBe(AMOUNT);
    expect(rows[0].idempotencyKey).toBe(`charge:${started.paymentId}`);
  });

  it('should report applied exactly once across concurrent deliveries', async () => {
    // 둘 다 "충전했습니다"라고 답하면 화면이 같은 금액을 두 번 보여준다.
    const userId = await seedMember();
    const started = await service.start(userId, { amount: AMOUNT });
    const body = webhookBody(started.paymentId);

    const [first, second] = await Promise.all([
      service.handleWebhook(body, {}),
      service.handleWebhook(body, {}),
    ]);

    expect([first.applied, second.applied].filter(Boolean)).toHaveLength(1);
  });

  it('should not charge when the gateway reports a different amount', async () => {
    const userId = await seedMember();
    const started = await service.start(userId, { amount: AMOUNT });
    // 포트원은 1,000원만 결제됐다고 말한다. 우리는 50,000원을 박아 두었다.
    gatewayAmountOverride = 1_000;

    // 인자 없는 toThrow()는 아무 에러로도 통과한다. 코드까지 본다.
    const error: unknown = await service
      .confirm({ paymentId: started.paymentId, userId })
      .then(
        () => {
          throw new Error('거절되어야 한다');
        },
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(PaymentError);
    expect((error as PaymentError).code).toBe(PAYMENT_ERRORS.AMOUNT_MISMATCH);

    expect(await prisma.pointTransaction.count({ where: { userId } })).toBe(0);
    const row = await prisma.payment.findUniqueOrThrow({
      where: { id: started.paymentId },
    });
    expect(row.status).toBe('PENDING');
  });

  it('should keep the payment row so a refund can find it later', async () => {
    // ADR-PAY-7의 FIFO 환불이 이 행의 createdAt 순서를 쓴다 (#29).
    const userId = await seedMember();
    const first = await service.start(userId, { amount: 10_000 });
    const second = await service.start(userId, { amount: 20_000 });
    await service.confirm({ paymentId: first.paymentId, userId });
    await service.confirm({ paymentId: second.paymentId, userId });

    const rows = await prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    expect(rows.map((r) => r.amount)).toEqual([10_000, 20_000]);
    expect(rows.every((r) => r.status === 'PAID')).toBe(true);
  });
});
