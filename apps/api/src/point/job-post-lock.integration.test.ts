import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { lockedAmountFor } from './job-post-lock';

/**
 * **"공고에 얼마가 잠겨 있나"의 정의를 못 박는 파일이다.** (이슈 #53)
 *
 * 합산은 Postgres의 `aggregate`가 하는 일이라 가짜 저장소로는 아무것도
 * 증명되지 않는다. 이 함수는 `PointTransaction` 행만 읽으므로 `JobPost` 행이
 * 없어도 검증된다 — `referenceId`는 문자열일 뿐이다.
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;

const EMPLOYER = 'usr_employer';
const WORKER = 'usr_worker';
const JOB = 'job_1';
const OTHER_JOB = 'job_2';

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  await prisma.pointTransaction.deleteMany();
  await prisma.user.deleteMany();
});

async function seedMembers(): Promise<void> {
  await prisma.user.createMany({
    data: [
      {
        id: EMPLOYER,
        email: 'boss@example.com',
        passwordHash: 'h',
        name: '구인자',
      },
      {
        id: WORKER,
        email: 'seeker@example.com',
        passwordHash: 'h',
        name: '구직자',
      },
    ],
  });
}

/** 원장에 한 줄. 캐시는 건드리지 않는다 — 이 함수는 원장만 본다 */
async function ledgerRow(entry: {
  userId: string;
  type: 'CHARGE' | 'HOLD' | 'RELEASE' | 'PAYOUT';
  amount: number;
  key: string;
  referenceId?: string;
}): Promise<void> {
  await prisma.pointTransaction.create({
    data: {
      userId: entry.userId,
      type: entry.type,
      amount: entry.amount,
      idempotencyKey: entry.key,
      referenceId: entry.referenceId ?? null,
    },
  });
}

describe('lockedAmountFor — 공고 잠금 잔여 (#53)', () => {
  it('should return the whole held budget when only the HOLD row exists', async () => {
    await seedMembers();
    await ledgerRow({
      userId: EMPLOYER,
      type: 'HOLD',
      amount: -60_000,
      key: `hold:${JOB}:1`,
      referenceId: JOB,
    });

    expect(await lockedAmountFor(prisma, JOB)).toBe(60_000);
  });

  it('should return the remainder when part of the hold was already released', async () => {
    // #15가 예산을 줄이면 차액만 RELEASE된다. 남은 것이 실제 잠금이다.
    await seedMembers();
    await ledgerRow({
      userId: EMPLOYER,
      type: 'HOLD',
      amount: -60_000,
      key: `hold:${JOB}:1`,
      referenceId: JOB,
    });
    await ledgerRow({
      userId: EMPLOYER,
      type: 'RELEASE',
      amount: 20_000,
      key: `release:${JOB}:2`,
      referenceId: JOB,
    });

    expect(await lockedAmountFor(prisma, JOB)).toBe(40_000);
  });

  it('should return 0 for a settled post because PAYOUT rows also leave the lock', async () => {
    // point-money.md의 채택안 그대로: 60,000 잠금 → 3명 지급 → 나머지 반환.
    // **구인자의 − 행이 없으므로 지급분은 잠금에서 곧바로 빠져나간다.**
    await seedMembers();
    await ledgerRow({
      userId: EMPLOYER,
      type: 'HOLD',
      amount: -60_000,
      key: `hold:${JOB}:1`,
      referenceId: JOB,
    });
    for (let i = 0; i < 3; i += 1) {
      await ledgerRow({
        userId: WORKER,
        type: 'PAYOUT',
        amount: 10_000,
        key: `payout:app_${i}`,
        referenceId: JOB,
      });
    }
    await ledgerRow({
      userId: EMPLOYER,
      type: 'RELEASE',
      amount: 30_000,
      key: `complete-release:${JOB}`,
      referenceId: JOB,
    });

    expect(await lockedAmountFor(prisma, JOB)).toBe(0);
  });

  it('should return 0 when the job post has no ledger row at all', async () => {
    await seedMembers();

    expect(await lockedAmountFor(prisma, JOB)).toBe(0);
  });

  it('should ignore a CHARGE row that carries the same referenceId', async () => {
    // 충전은 잠금 흐름이 아니다. 같은 이름표가 붙어도 세지 않는다.
    await seedMembers();
    await ledgerRow({
      userId: EMPLOYER,
      type: 'HOLD',
      amount: -60_000,
      key: `hold:${JOB}:1`,
      referenceId: JOB,
    });
    await ledgerRow({
      userId: EMPLOYER,
      type: 'CHARGE',
      amount: 7_000,
      key: `charge:${JOB}`,
      referenceId: JOB,
    });

    expect(await lockedAmountFor(prisma, JOB)).toBe(60_000);
  });

  it('should ignore rows that reference a different job post', async () => {
    await seedMembers();
    await ledgerRow({
      userId: EMPLOYER,
      type: 'HOLD',
      amount: -60_000,
      key: `hold:${JOB}:1`,
      referenceId: JOB,
    });
    await ledgerRow({
      userId: EMPLOYER,
      type: 'HOLD',
      amount: -10_000,
      key: `hold:${OTHER_JOB}:1`,
      referenceId: OTHER_JOB,
    });

    expect(await lockedAmountFor(prisma, JOB)).toBe(60_000);
  });

  it('should return the negative sum as-is instead of throwing when releases exceed holds', async () => {
    // 원장이 깨진 상태다. 여기서 판정하지 않는다 — 대조 배치(#39)의 몫이고,
    // 호출부 둘 다 `> 0` 가드가 있어 음수여도 돈이 나가지 않는다.
    await seedMembers();
    await ledgerRow({
      userId: EMPLOYER,
      type: 'HOLD',
      amount: -10_000,
      key: `hold:${JOB}:1`,
      referenceId: JOB,
    });
    await ledgerRow({
      userId: EMPLOYER,
      type: 'RELEASE',
      amount: 30_000,
      key: `release:${JOB}:2`,
      referenceId: JOB,
    });

    expect(await lockedAmountFor(prisma, JOB)).toBe(-20_000);
  });
});
