import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPointLedgerStore } from './prisma-point-ledger.store';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * **이 이슈에는 화면이 없다. 이 파일이 데모다.** (이슈 #27)
 *
 * 동시성(AC5)과 캐시-원장 일치(AC6)는 가짜 저장소로 증명할 수 없다. 조건부
 * UPDATE가 실제로 원자적인지는 진짜 Postgres에서만 드러난다.
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let store: PrismaPointLedgerStore;

const USER = 'usr_ledger';

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  // 마이그레이션을 그대로 적용한다. 스키마가 실제와 다르면 검증이 무의미하다.
  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  store = new PrismaPointLedgerStore(prisma as unknown as PrismaService);
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  await prisma.pointTransaction.deleteMany();
  await prisma.user.deleteMany();
});

/** 잔액이 있는 회원 하나를 만든다 */
async function memberWith(balance: number): Promise<void> {
  await prisma.user.create({
    data: {
      id: USER,
      email: `${USER}@example.com`,
      passwordHash: 'hash',
      name: '김구직',
      cachedBalance: 0,
    },
  });
  if (balance > 0) {
    await store.append({
      userId: USER,
      type: 'CHARGE',
      amount: balance,
      idempotencyKey: `seed_${balance}`,
    });
  }
}

describe('PrismaPointLedgerStore — 멱등 (AC4)', () => {
  it('should reject a duplicate idempotencyKey at the database level', async () => {
    await memberWith(0);
    const entry = {
      userId: USER,
      type: 'CHARGE' as const,
      amount: 10_000,
      idempotencyKey: 'webhook_abc',
    };

    const first = await store.append(entry);
    const second = await store.append(entry);

    expect(first).not.toBe('DUPLICATE');
    expect(second).toBe('DUPLICATE');
    expect(await prisma.pointTransaction.count()).toBe(1);
  });

  it('should not change the balance when a duplicate is rejected', async () => {
    // 중복 웹훅이 잔액을 두 번 올리면 곧바로 금전 사고다.
    await memberWith(0);
    const entry = {
      userId: USER,
      type: 'CHARGE' as const,
      amount: 10_000,
      idempotencyKey: 'webhook_abc',
    };
    await store.append(entry);

    await store.append(entry);

    expect(await store.sumBalance(USER)).toBe(10_000);
    expect(await store.readCachedBalance(USER)).toBe(10_000);
  });
});

describe('PrismaPointLedgerStore — 동시성 (AC5)', () => {
  it('should never let the balance go negative when CHARGE and HOLD race', async () => {
    await memberWith(10_000);

    // 동시에 들어온다. 읽고 쓰는 사이의 틈이 있으면 여기서 드러난다.
    await Promise.all([
      store.append({
        userId: USER,
        type: 'CHARGE',
        amount: 5_000,
        idempotencyKey: 'race_charge',
      }),
      store.append({
        userId: USER,
        type: 'HOLD',
        amount: -10_000,
        idempotencyKey: 'race_hold',
      }),
    ]);

    const balance = await store.sumBalance(USER);
    expect(balance).toBeGreaterThanOrEqual(0);
    expect(await store.readCachedBalance(USER)).toBe(balance);
  });

  it('should let exactly one of two concurrent HOLDs succeed when only one fits', async () => {
    // 잔액 10000에 10000짜리 잠금이 둘. 하나만 성공해야 한다.
    await memberWith(10_000);

    const results = await Promise.all([
      store.append({
        userId: USER,
        type: 'HOLD',
        amount: -10_000,
        idempotencyKey: 'hold_a',
      }),
      store.append({
        userId: USER,
        type: 'HOLD',
        amount: -10_000,
        idempotencyKey: 'hold_b',
      }),
    ]);

    const succeeded = results.filter((r) => r !== 'INSUFFICIENT');
    expect(succeeded).toHaveLength(1);
    expect(await store.sumBalance(USER)).toBe(0);
  });

  it('should keep the cached balance equal to the ledger sum after a race', async () => {
    // AC6. 캐시와 원장이 어긋나면 어느 쪽이 맞는지 판단할 근거가 없다.
    await memberWith(50_000);

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.append({
          userId: USER,
          type: i % 2 === 0 ? 'HOLD' : 'RELEASE',
          amount: i % 2 === 0 ? -3_000 : 3_000,
          idempotencyKey: `mixed_${i}`,
        }),
      ),
    );

    expect(await store.readCachedBalance(USER)).toBe(
      await store.sumBalance(USER),
    );
  });
});

describe('PrismaPointLedgerStore — 잔액 검증 (AC2)', () => {
  it('should leave nothing in the ledger when the balance is short', async () => {
    await memberWith(10_000);
    const before = await prisma.pointTransaction.count();

    const result = await store.append({
      userId: USER,
      type: 'HOLD',
      amount: -12_000,
      idempotencyKey: 'too_much',
    });

    expect(result).toBe('INSUFFICIENT');
    expect(await prisma.pointTransaction.count()).toBe(before);
    // 캐시도 되돌아가야 한다. 트랜잭션이 통째로 롤백되기 때문이다.
    expect(await store.readCachedBalance(USER)).toBe(10_000);
  });

  it('should allow spending exactly the whole balance', async () => {
    await memberWith(10_000);

    const result = await store.append({
      userId: USER,
      type: 'HOLD',
      amount: -10_000,
      idempotencyKey: 'exact',
    });

    expect(result).not.toBe('INSUFFICIENT');
    expect(await store.sumBalance(USER)).toBe(0);
  });
});
