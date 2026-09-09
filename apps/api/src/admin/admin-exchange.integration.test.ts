import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import {
  ADMIN_ACTIONS,
  EXCHANGE_PAGE_SIZE,
  maturityCutoff,
} from '@fixer/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaExchangeRequestStore } from '../exchange/prisma-exchange-request.store';
import { PrismaAdminExchangeStore } from './prisma-admin-exchange.store';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * **원장과 감사 로그가 한 트랜잭션인지는 진짜 DB에서만 증명된다.** (이슈 #34)
 *
 * 가짜 저장소는 내가 정한 값을 그대로 돌려주므로, 반려가 포인트를 정확히
 * 되돌리는지도 관리자 둘이 같은 건을 동시에 눌렀을 때 하나만 통과하는지도
 * 실제 트랜잭션에서만 확인할 수 있다.
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let store: PrismaAdminExchangeStore;
let requests: PrismaExchangeRequestStore;

const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  store = new PrismaAdminExchangeStore(prisma as unknown as PrismaService);
  requests = new PrismaExchangeRequestStore(prisma as unknown as PrismaService);
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  await prisma.adminAuditLog.deleteMany();
  await prisma.exchangeRequest.deleteMany();
  await prisma.pointTransaction.deleteMany();
  await prisma.exchangeAccount.deleteMany();
  await prisma.user.deleteMany();
});

/** 관리자 하나. 감사 로그의 외래키가 실재하는 회원을 요구한다 */
async function seedAdmin(): Promise<string> {
  const admin = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      passwordHash: 'h',
      name: '관리자',
      role: 'ADMIN',
    },
  });
  return admin.id;
}

/** 신청자 + `EXCHANGE_REQUEST`가 이미 나간 요청 한 건 */
async function seedRequest(options: {
  matured: number;
  amount: number;
}): Promise<{ userId: string; requestId: string }> {
  const user = await prisma.user.create({
    data: {
      email: 'worker@example.com',
      passwordHash: 'h',
      name: '김구직',
      cachedBalance: options.matured - options.amount,
    },
  });
  await prisma.exchangeAccount.create({
    data: {
      userId: user.id,
      bankCode: '088',
      accountNumberEncrypted: 'enc',
      accountNumberLast4: '5678',
      holderName: '김구직',
      verificationStatus: 'VERIFIED',
    },
  });
  await prisma.pointTransaction.create({
    data: {
      userId: user.id,
      type: 'PAYOUT',
      amount: options.matured,
      idempotencyKey: 'payout:app_1',
      createdAt: new Date(Date.now() - 8 * DAY),
    },
  });

  const request = await prisma.exchangeRequest.create({
    data: { userId: user.id, amount: options.amount },
  });
  await prisma.pointTransaction.create({
    data: {
      userId: user.id,
      type: 'EXCHANGE_REQUEST',
      amount: -options.amount,
      idempotencyKey: `exchange-request:${request.id}`,
      referenceId: request.id,
    },
  });

  return { userId: user.id, requestId: request.id };
}

describe('관리자 환전 관리 — 진짜 Postgres에서', () => {
  it('should record an EXCHANGE_APPROVE audit log carrying the admin id and the request id', async () => {
    const adminId = await seedAdmin();
    const { requestId } = await seedRequest({
      matured: 20_000,
      amount: 10_000,
    });

    await store.updateStatus({
      requestId,
      expectedStatus: 'REQUESTED',
      nextStatus: 'APPROVED',
      adminId,
      action: ADMIN_ACTIONS.EXCHANGE_APPROVE,
    });

    const logs = await prisma.adminAuditLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      adminId,
      action: ADMIN_ACTIONS.EXCHANGE_APPROVE,
      targetType: 'ExchangeRequest',
      targetId: requestId,
    });
  });

  it('should move the request to REJECTED and append a +amount EXCHANGE_REVERT ledger entry', async () => {
    const adminId = await seedAdmin();
    const { requestId } = await seedRequest({
      matured: 20_000,
      amount: 10_000,
    });

    await store.reject({
      requestId,
      userId: (
        await prisma.exchangeRequest.findUniqueOrThrow({
          where: { id: requestId },
        })
      ).userId,
      amount: 10_000,
      expectedStatus: 'REQUESTED',
      adminId,
      reason: '예금주가 다릅니다',
    });

    const row = await prisma.exchangeRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(row.status).toBe('REJECTED');

    const reverts = await prisma.pointTransaction.findMany({
      where: { type: 'EXCHANGE_REVERT' },
    });
    expect(reverts).toHaveLength(1);
    expect(reverts[0]).toMatchObject({
      amount: 10_000,
      referenceId: requestId,
    });
  });

  it('should restore the balance to exactly the amount it held before the request', async () => {
    const adminId = await seedAdmin();
    const { userId, requestId } = await seedRequest({
      matured: 20_000,
      amount: 10_000,
    });

    await store.reject({
      requestId,
      userId,
      amount: 10_000,
      expectedStatus: 'REQUESTED',
      adminId,
      reason: '착오',
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.cachedBalance).toBe(20_000);
  });

  // #31의 `maturedBalanceOf`가 `EXCHANGE_REVERT`를 더하도록 짜여 있다.
  // 반려 쪽에서 그 계약이 실제로 맞물리는지는 여기서만 드러난다.
  it('should make the reverted amount exchangeable again through maturedBalanceOf', async () => {
    const adminId = await seedAdmin();
    const { userId, requestId } = await seedRequest({
      matured: 20_000,
      amount: 10_000,
    });

    await store.reject({
      requestId,
      userId,
      amount: 10_000,
      expectedStatus: 'REQUESTED',
      adminId,
      reason: '착오',
    });

    await expect(
      requests.maturedBalanceOf(userId, maturityCutoff()),
    ).resolves.toBe(20_000);
  });

  it('should let only one of two concurrent approvals of the same request succeed', async () => {
    const adminId = await seedAdmin();
    const { requestId } = await seedRequest({
      matured: 20_000,
      amount: 10_000,
    });

    const both = await Promise.all([
      store.updateStatus({
        requestId,
        expectedStatus: 'REQUESTED',
        nextStatus: 'APPROVED',
        adminId,
        action: ADMIN_ACTIONS.EXCHANGE_APPROVE,
      }),
      store.updateStatus({
        requestId,
        expectedStatus: 'REQUESTED',
        nextStatus: 'APPROVED',
        adminId,
        action: ADMIN_ACTIONS.EXCHANGE_APPROVE,
      }),
    ]);

    expect(both.filter((one) => one === 'STALE')).toHaveLength(1);
    // 감사 로그도 한 줄이어야 한다. 두 줄이면 조치가 두 번 있었던 것처럼 남는다.
    await expect(prisma.adminAuditLog.count()).resolves.toBe(1);
  });

  it('should return an empty page instead of an error when the page is past the last one', async () => {
    await seedRequest({ matured: 20_000, amount: 10_000 });

    const page = await store.listAll({ page: 99 }, EXCHANGE_PAGE_SIZE);

    expect(page.items).toEqual([]);
    // 건수는 필터를 적용한 전체다. 페이지가 비어도 1건이 있다는 사실은 남는다.
    expect(page.total).toBe(1);
  });
});
