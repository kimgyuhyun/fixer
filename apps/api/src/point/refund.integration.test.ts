import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { PAYMENT_ERRORS } from '@fixer/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { PaymentError } from './charge.service';
import { PointLedgerService } from './point-ledger.service';
import { PrismaPointLedgerStore } from './prisma-point-ledger.store';
import { PrismaRefundStore } from './prisma-refund.store';
import { RefundService, type RefundStore } from './refund.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * **lot 잔여를 원장에서 낸다는 것이 진짜인지 여기서 본다.** (ADR-PAY-7)
 *
 * 가짜 저장소는 내가 쓴 합산식을 그대로 되풀이하므로, 그 식이 틀려도
 * 테스트는 통과한다. `groupBy`가 실제로 같은 값을 내는지는 Postgres만 안다.
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let service: RefundService;

const USER_EMAIL = 'buyer@example.com';

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  service = new RefundService(
    new PrismaRefundStore(prisma as unknown as PrismaService),
    new PointLedgerService(
      new PrismaPointLedgerStore(prisma as unknown as PrismaService),
    ),
  );
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
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

/**
 * 원장 행 하나를 쌓으면서 `cachedBalance`도 함께 올린다.
 *
 * 캐시를 안 맞추면 잔액 검증(조건부 UPDATE, ADR-PAY-2)이 0으로 보고 막는다.
 * 실제 충전은 `append`를 거치며 둘을 함께 갱신하므로, 테스트도 같은 상태를
 * 만들어야 한다.
 */
async function seedLedgerRow(input: {
  userId: string;
  type: 'CHARGE' | 'HOLD';
  amount: number;
  idempotencyKey: string;
  sourcePaymentId?: string;
  createdAt?: Date;
}): Promise<void> {
  await prisma.$transaction([
    prisma.pointTransaction.create({
      data: {
        userId: input.userId,
        type: input.type,
        amount: input.amount,
        idempotencyKey: input.idempotencyKey,
        sourcePaymentId: input.sourcePaymentId ?? null,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      },
    }),
    prisma.user.update({
      where: { id: input.userId },
      data: { cachedBalance: { increment: input.amount } },
    }),
  ]);
}

/** 충전된 결제 건 하나를 만든다. 원장 행까지 함께 쌓는다 */
async function seedCharge(
  userId: string,
  id: string,
  amount: number,
  createdAt: Date,
  refundableUntil: Date | null = null,
): Promise<void> {
  await prisma.payment.create({
    data: { id, userId, amount, status: 'PAID', createdAt, refundableUntil },
  });
  await seedLedgerRow({
    userId,
    type: 'CHARGE',
    amount,
    idempotencyKey: `charge:${id}`,
    sourcePaymentId: id,
    createdAt,
  });
}

async function balanceOf(userId: string): Promise<number> {
  const { _sum } = await prisma.pointTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  return _sum.amount ?? 0;
}

async function lotRemaining(paymentId: string): Promise<number> {
  const { _sum } = await prisma.pointTransaction.aggregate({
    where: { sourcePaymentId: paymentId },
    _sum: { amount: true },
  });
  return _sum.amount ?? 0;
}

const OLD = new Date('2026-07-01T00:00:00.000Z');
const NEW = new Date('2026-08-01T00:00:00.000Z');

describe('환불 — 진짜 Postgres에서', () => {
  it('should take from the oldest payment first', async () => {
    // 최신 것부터 쓰면 오래된 건이 남았다가 기한이 지나 환불 불가가 된다.
    const userId = await seedMember();
    await seedCharge(userId, 'pay_new', 150_000, NEW);
    await seedCharge(userId, 'pay_old', 50_000, OLD);

    const result = await service.refund({ userId, amount: 30_000 });

    expect(result.lots).toEqual([{ paymentId: 'pay_old', amount: 30_000 }]);
    expect(await lotRemaining('pay_old')).toBe(20_000);
    expect(await lotRemaining('pay_new')).toBe(150_000);
  });

  it('should spread one refund across two lots', async () => {
    // 5만 + 15만 충전, 6.5만 사용, 5.5만 환불 — 사용자가 든 예 그대로다.
    const userId = await seedMember();
    await seedCharge(userId, 'pay_old', 50_000, OLD);
    await seedCharge(userId, 'pay_new', 150_000, NEW);
    await seedLedgerRow({
      userId,
      type: 'HOLD',
      amount: -65_000,
      idempotencyKey: 'hold:1',
    });

    const result = await service.refund({ userId, amount: 55_000 });

    expect(result.lots).toEqual([
      { paymentId: 'pay_old', amount: 50_000 },
      { paymentId: 'pay_new', amount: 5_000 },
    ]);
    expect(await balanceOf(userId)).toBe(80_000);
    expect(await lotRemaining('pay_old')).toBe(0);
    expect(await lotRemaining('pay_new')).toBe(145_000);
  });

  it('should mark a fully consumed lot CANCELLED', async () => {
    const userId = await seedMember();
    await seedCharge(userId, 'pay_old', 50_000, OLD);

    await service.cancelPayment({ userId, paymentId: 'pay_old' });

    const row = await prisma.payment.findUniqueOrThrow({
      where: { id: 'pay_old' },
    });
    expect(row.status).toBe('CANCELLED');
  });

  it('should refund only once when the same cancel arrives twice at once', async () => {
    // 유니크 인덱스가 없으면 둘 다 통과해 잔액이 음수가 된다.
    const userId = await seedMember();
    await seedCharge(userId, 'pay_old', 50_000, OLD);

    const results = await Promise.allSettled([
      service.cancelPayment({ userId, paymentId: 'pay_old' }),
      service.cancelPayment({ userId, paymentId: 'pay_old' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(
      await prisma.pointTransaction.count({
        where: { userId, type: 'REFUND' },
      }),
    ).toBe(1);
    expect(await balanceOf(userId)).toBe(0);
  });

  it('should answer applied:false instead of throwing when two cancels read the same remaining', async () => {
    // 자연 타이밍에서는 앞 요청이 먼저 끝나 두 번째가 remaining===0을 보고
    // 조기 반환한다. **그건 운이다.** 두 조회를 강제로 같은 순간에 맞춰
    // 진짜 경합을 만든다 — ac-verifier가 이 경로로 500을 재현했다.
    const userId = await seedMember();
    await seedCharge(userId, 'pay_old', 50_000, OLD);

    const store = new PrismaRefundStore(prisma as unknown as PrismaService);
    let waiting: (() => void) | null = null;
    const bothArrived = new Promise<void>((resolve) => {
      let seen = 0;
      waiting = () => {
        seen += 1;
        if (seen === 2) resolve();
      };
    });

    /** 두 호출이 **둘 다 조회를 마칠 때까지** 서로를 기다리게 한다 */
    const barriered: RefundStore = {
      listRefundableLots: (userId) => store.listRefundableLots(userId),
      markCancelled: (paymentId) => store.markCancelled(paymentId),
      async findLot(paymentId) {
        const lot = await store.findLot(paymentId);
        waiting?.();
        await bothArrived;
        return lot;
      },
    };

    const racing = new RefundService(
      barriered,
      new PointLedgerService(
        new PrismaPointLedgerStore(prisma as unknown as PrismaService),
      ),
    );

    const results = await Promise.allSettled([
      racing.cancelPayment({ userId, paymentId: 'pay_old' }),
      racing.cancelPayment({ userId, paymentId: 'pay_old' }),
    ]);

    // 둘 다 성공 응답이어야 한다. 하나가 500이면 사용자는 취소가 안 된 줄 안다.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const applied = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value.applied);
    expect(applied.filter(Boolean)).toHaveLength(1);

    expect(
      await prisma.pointTransaction.count({
        where: { userId, type: 'REFUND' },
      }),
    ).toBe(1);
    expect(await balanceOf(userId)).toBe(0);
  });

  it('should reject when the points were already spent', async () => {
    const userId = await seedMember();
    await seedCharge(userId, 'pay_old', 50_000, OLD);
    await seedLedgerRow({
      userId,
      type: 'HOLD',
      amount: -20_000,
      idempotencyKey: 'hold:2',
    });

    const error: unknown = await service
      .cancelPayment({ userId, paymentId: 'pay_old' })
      .then(
        () => {
          throw new Error('거절되어야 한다');
        },
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(PaymentError);
    expect((error as PaymentError).code).toBe(
      PAYMENT_ERRORS.INSUFFICIENT_BALANCE,
    );
    expect(
      await prisma.pointTransaction.count({
        where: { userId, type: 'REFUND' },
      }),
    ).toBe(0);
  });

  it('should skip a lot whose refund deadline has passed', async () => {
    const userId = await seedMember();
    await seedCharge(userId, 'pay_old', 50_000, OLD, new Date(Date.now() - 1));
    await seedCharge(userId, 'pay_new', 150_000, NEW);

    const result = await service.refund({ userId, amount: 30_000 });

    expect(result.lots).toEqual([{ paymentId: 'pay_new', amount: 30_000 }]);
    expect(await lotRemaining('pay_old')).toBe(50_000);
  });

  it('should leave the ledger sum matching the remaining lots', async () => {
    // 숫자가 한 벌이라는 것이 이 이슈의 근거다 — 어긋나면 lot 잔여와
    // 잔액 중 어느 쪽이 맞는지 판단할 방법이 없다.
    const userId = await seedMember();
    await seedCharge(userId, 'pay_old', 50_000, OLD);
    await seedCharge(userId, 'pay_new', 150_000, NEW);

    await service.refund({ userId, amount: 70_000 });

    const lotSum =
      (await lotRemaining('pay_old')) + (await lotRemaining('pay_new'));
    expect(lotSum).toBe(await balanceOf(userId));
    expect(lotSum).toBe(130_000);
  });
});
