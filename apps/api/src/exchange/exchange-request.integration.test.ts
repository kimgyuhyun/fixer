import { execSync } from 'node:child_process';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { POINT_ERRORS } from '@fixer/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { PointError } from '../point/point-ledger.service';
import { EnvAccountCipher } from './account-cipher';
import { ExchangeRequestService } from './exchange-request.service';
import { PrismaExchangeAccountStore } from './prisma-exchange-account.store';
import { PrismaExchangeRequestStore } from './prisma-exchange-request.store';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * **성숙도는 진짜 DB에서만 증명된다.** (이슈 #31)
 *
 * 가짜 저장소는 내가 정한 숫자를 그대로 돌려주므로, 7일이 지난 포인트만
 * 세는지도 동시 요청 두 건이 성숙액을 넘기지 않는지도 실제 트랜잭션에서만
 * 확인할 수 있다.
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let store: PrismaExchangeRequestStore;
let service: ExchangeRequestService;

const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  store = new PrismaExchangeRequestStore(prisma as unknown as PrismaService);
  service = new ExchangeRequestService(
    store,
    new PrismaExchangeAccountStore(prisma as unknown as PrismaService),
    store,
  );
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  await prisma.exchangeRequest.deleteMany();
  await prisma.pointTransaction.deleteMany();
  await prisma.exchangeAccount.deleteMany();
  await prisma.user.deleteMany();
});

async function seedWorker(cachedBalance: number): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: 'worker@example.com',
      passwordHash: 'h',
      name: '김구직',
      cachedBalance,
    },
  });
  await prisma.exchangeAccount.create({
    data: {
      userId: user.id,
      bankCode: '088',
      accountNumberEncrypted: new EnvAccountCipher({
        get: () => 'integration-master-key',
      } as unknown as ConfigService).encrypt('11012345678'),
      accountNumberLast4: '5678',
      holderName: '김구직',
      verificationStatus: 'VERIFIED',
    },
  });
  return user.id;
}

/** 원장 한 줄. `paidAt`을 직접 찍어야 성숙도를 시험할 수 있다 */
async function ledger(input: {
  userId: string;
  type: 'PAYOUT' | 'HOLD' | 'EXCHANGE_REQUEST' | 'EXCHANGE_REVERT';
  amount: number;
  at: Date;
  key: string;
}): Promise<void> {
  await prisma.pointTransaction.create({
    data: {
      userId: input.userId,
      type: input.type,
      amount: input.amount,
      idempotencyKey: input.key,
      createdAt: input.at,
    },
  });
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY);
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

describe('환전 요청 — 진짜 Postgres에서', () => {
  it('should create a REQUESTED request and append a -10000 EXCHANGE_REQUEST entry when 20000 matured points exist and 10000 is requested', async () => {
    const userId = await seedWorker(20_000);
    await ledger({
      userId,
      type: 'PAYOUT',
      amount: 20_000,
      at: daysAgo(8),
      key: 'payout:app_1',
    });

    await service.request({ userId, amount: 10_000 });

    const requests = await prisma.exchangeRequest.findMany();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ amount: 10_000, status: 'REQUESTED' });

    const entries = await prisma.pointTransaction.findMany({
      where: { type: 'EXCHANGE_REQUEST' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].amount).toBe(-10_000);
  });

  // 반려가 어느 요청을 되돌리는 것인지 원장에서 되짚을 수 있어야 한다.
  it('should point the ledger entry at the request through referenceId when both rows are written', async () => {
    const userId = await seedWorker(20_000);
    await ledger({
      userId,
      type: 'PAYOUT',
      amount: 20_000,
      at: daysAgo(8),
      key: 'payout:app_1',
    });

    const created = await store.create({ userId, amount: 10_000 });

    const entry = await prisma.pointTransaction.findFirst({
      where: { type: 'EXCHANGE_REQUEST' },
    });
    expect(created).not.toBe('INSUFFICIENT');
    expect(created).not.toBe('NOT_MATURED');
    expect(entry?.referenceId).toBe((created as { id: string }).id);
  });
});

describe('maturedBalanceOf — 진짜 Postgres에서', () => {
  it('should include a payout made exactly 7 days ago', async () => {
    const userId = await seedWorker(20_000);
    const paidAt = daysAgo(7);
    await ledger({
      userId,
      type: 'PAYOUT',
      amount: 20_000,
      at: paidAt,
      key: 'payout:app_1',
    });

    expect(await store.maturedBalanceOf(userId, paidAt)).toBe(20_000);
  });

  it('should exclude a payout made 1 second short of 7 days', async () => {
    const userId = await seedWorker(20_000);
    const cutoff = daysAgo(7);
    await ledger({
      userId,
      type: 'PAYOUT',
      amount: 20_000,
      at: new Date(cutoff.getTime() + 1_000),
      key: 'payout:app_1',
    });

    expect(await store.maturedBalanceOf(userId, cutoff)).toBe(0);
  });

  // 안 빼면 같은 포인트를 몇 번이고 환전할 수 있다.
  it('should subtract earlier EXCHANGE_REQUEST amounts so the same points cannot be exchanged twice', async () => {
    const userId = await seedWorker(10_000);
    const cutoff = daysAgo(7);
    await ledger({
      userId,
      type: 'PAYOUT',
      amount: 20_000,
      at: daysAgo(8),
      key: 'payout:app_1',
    });
    await ledger({
      userId,
      type: 'EXCHANGE_REQUEST',
      amount: -10_000,
      at: daysAgo(1),
      key: 'exchange-request:exr_1',
    });

    expect(await store.maturedBalanceOf(userId, cutoff)).toBe(10_000);
  });

  it('should add EXCHANGE_REVERT amounts back so a rejected request becomes exchangeable again', async () => {
    const userId = await seedWorker(20_000);
    const cutoff = daysAgo(7);
    await ledger({
      userId,
      type: 'PAYOUT',
      amount: 20_000,
      at: daysAgo(8),
      key: 'payout:app_1',
    });
    await ledger({
      userId,
      type: 'EXCHANGE_REQUEST',
      amount: -10_000,
      at: daysAgo(2),
      key: 'exchange-request:exr_1',
    });
    await ledger({
      userId,
      type: 'EXCHANGE_REVERT',
      amount: 10_000,
      at: daysAgo(1),
      key: 'exchange-revert:exr_1',
    });

    expect(await store.maturedBalanceOf(userId, cutoff)).toBe(20_000);
  });
});

describe('환전 요청 경합 — 진짜 Postgres에서', () => {
  /**
   * **조건부 UPDATE만으로는 이걸 못 막는다.** 잔액은 20,000이라 두 요청이
   * 모두 통과하고, 성숙한 10,000을 넘어 미성숙 포인트가 환전된다.
   */
  it('should let only one of two concurrent requests succeed when the matured amount covers only one', async () => {
    const userId = await seedWorker(20_000);
    await ledger({
      userId,
      type: 'PAYOUT',
      amount: 10_000,
      at: daysAgo(8),
      key: 'payout:app_matured',
    });
    await ledger({
      userId,
      type: 'PAYOUT',
      amount: 10_000,
      at: daysAgo(1),
      key: 'payout:app_fresh',
    });

    const results = await Promise.all([
      store.create({ userId, amount: 10_000 }),
      store.create({ userId, amount: 10_000 }),
    ]);

    expect(results.filter((r) => r === 'NOT_MATURED')).toHaveLength(1);
    expect(await prisma.exchangeRequest.count()).toBe(1);
    expect(
      await prisma.pointTransaction.count({
        where: { type: 'EXCHANGE_REQUEST' },
      }),
    ).toBe(1);
  });

  it('should leave neither a request row nor a ledger entry when the balance is short', async () => {
    const userId = await seedWorker(5_000);
    await ledger({
      userId,
      type: 'PAYOUT',
      amount: 20_000,
      at: daysAgo(8),
      key: 'payout:app_1',
    });
    await ledger({
      userId,
      type: 'HOLD',
      amount: -15_000,
      at: daysAgo(2),
      key: 'hold:job_1:1',
    });

    expect(await store.create({ userId, amount: 10_000 })).toBe('INSUFFICIENT');
    expect(await prisma.exchangeRequest.count()).toBe(0);
    expect(
      await prisma.pointTransaction.count({
        where: { type: 'EXCHANGE_REQUEST' },
      }),
    ).toBe(0);
  });

  // 구인자이면서 구직자인 회원에게 실제로 생기는 경로다.
  it('should throw POINT_INSUFFICIENT_BALANCE when matured points exist but the balance is held by an open job post', async () => {
    const userId = await seedWorker(5_000);
    await ledger({
      userId,
      type: 'PAYOUT',
      amount: 20_000,
      at: daysAgo(8),
      key: 'payout:app_1',
    });
    await ledger({
      userId,
      type: 'HOLD',
      amount: -15_000,
      at: daysAgo(2),
      key: 'hold:job_1:1',
    });

    const error = await rejectionOf(
      service.request({ userId, amount: 10_000 }),
    );

    expect(error).toBeInstanceOf(PointError);
    expect((error as PointError).code).toBe(POINT_ERRORS.INSUFFICIENT_BALANCE);
  });
});
