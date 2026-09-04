import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { JOB_POST_ERRORS, holdIdempotencyKey } from '@fixer/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { JobPostError, JobPostService } from './job-post.service';
import {
  PrismaBalanceReader,
  PrismaJobPostStore,
  PrismaMemberAddressReader,
} from './prisma-job-post.store';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * **"함께 되거나 함께 안 된다"는 진짜 DB에서만 증명된다.** (이슈 #12)
 *
 * 가짜 저장소는 한 메서드 안에서 순서대로 실행하므로 롤백이 없어도 통과한다.
 * 잔액이 모자랄 때 공고 행과 스냅샷까지 사라지는지는 Postgres만 안다.
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let service: JobPostService;

const REWARD = 50_000;
const HEADCOUNT = 3;
const BUDGET = REWARD * HEADCOUNT;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  service = new JobPostService(
    new PrismaJobPostStore(prisma as unknown as PrismaService),
    new PrismaMemberAddressReader(prisma as unknown as PrismaService),
    new PrismaBalanceReader(prisma as unknown as PrismaService),
  );
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  await prisma.jobPostVersion.deleteMany();
  await prisma.jobPost.deleteMany();
  await prisma.pointTransaction.deleteMany();
  await prisma.userAddress.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
});

async function seedCategory(): Promise<string> {
  const row = await prisma.category.create({
    data: {
      name: '청소',
      slug: 'cleaning',
      sortOrder: 1,
      placeholderText: '어떤 청소인지 적어 주세요.',
    },
  });
  return row.id;
}

/** 충전된 구인자 하나. 캐시와 원장을 함께 올린다 (조건부 UPDATE가 캐시를 본다) */
async function seedEmployer(balance: number): Promise<string> {
  const user = await prisma.user.create({
    data: { email: 'boss@example.com', passwordHash: 'h', name: '구인자' },
  });
  if (balance > 0) {
    await prisma.$transaction([
      prisma.pointTransaction.create({
        data: {
          userId: user.id,
          type: 'CHARGE',
          amount: balance,
          idempotencyKey: `charge:seed:${user.id}`,
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { cachedBalance: balance },
      }),
    ]);
  }
  await prisma.userAddress.create({
    data: {
      userId: user.id,
      label: '기본',
      postalCode: '06236',
      roadAddress: '서울 강남구 테헤란로 1',
      jibunAddress: '서울 강남구 역삼동 1',
      sido: '서울',
      sigungu: '강남구',
    },
  });
  return user.id;
}

function request(categoryId: string, overrides: Record<string, unknown> = {}) {
  return {
    categoryId,
    title: '사무실 청소',
    workStartAt: '2026-10-01T09:00:00.000Z',
    workEndAt: '2026-10-01T18:00:00.000Z',
    headcount: HEADCOUNT,
    rewardPerPerson: REWARD,
    requiredDescription: '30평 사무실 바닥과 창문을 닦습니다.',
    ...overrides,
  } as Parameters<JobPostService['create']>[1];
}

async function balanceOf(userId: string): Promise<number> {
  const { _sum } = await prisma.pointTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  return _sum.amount ?? 0;
}

describe('공고 등록 — 진짜 Postgres에서', () => {
  it('should reduce the balance by the whole budget', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(500_000);

    const created = await service.create(employerId, request(categoryId));

    expect(created.status).toBe('OPEN');
    expect(created.budget).toBe(BUDGET);
    expect(await balanceOf(employerId)).toBe(500_000 - BUDGET);

    const hold = await prisma.pointTransaction.findFirstOrThrow({
      where: { userId: employerId, type: 'HOLD' },
    });
    expect(hold.amount).toBe(-BUDGET);
    expect(hold.idempotencyKey).toBe(holdIdempotencyKey(created.id, 1));
    expect(hold.referenceId).toBe(created.id);
  });

  it('should write the v1 snapshot in the same transaction', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(500_000);

    const created = await service.create(employerId, request(categoryId));

    const snapshot = await prisma.jobPostVersion.findFirstOrThrow({
      where: { jobPostId: created.id, version: 1 },
    });
    expect(snapshot.headcount).toBe(HEADCOUNT);
    expect(snapshot.rewardPerPerson).toBe(REWARD);
  });

  it('should leave neither the post nor the HOLD when the balance is short', async () => {
    // **이 테스트가 이 이슈의 이유다.** 공고만 남으면 예산 없는 공고가
    // 목록에 뜨고, HOLD만 남으면 아무도 풀어줄 수 없는 돈이 된다.
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(100_000);

    const error: unknown = await service
      .create(employerId, request(categoryId))
      .then(
        () => {
          throw new Error('거절되어야 한다');
        },
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(JobPostError);
    expect((error as JobPostError).code).toBe(
      JOB_POST_ERRORS.INSUFFICIENT_BALANCE,
    );
    expect((error as JobPostError).detail).toMatchObject({
      shortfall: BUDGET - 100_000,
    });

    expect(await prisma.jobPost.count()).toBe(0);
    expect(await prisma.jobPostVersion.count()).toBe(0);
    expect(
      await prisma.pointTransaction.count({
        where: { userId: employerId, type: 'HOLD' },
      }),
    ).toBe(0);
    expect(await balanceOf(employerId)).toBe(100_000);
  });

  it('should not let two concurrent posts overspend the balance', async () => {
    // 예산 두 건이 각각 잔액 이하지만 합치면 넘는다. 조건부 UPDATE가
    // 없으면 둘 다 통과해 잔액이 음수가 된다 (ADR-PAY-2).
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(BUDGET + 1_000);

    const results = await Promise.allSettled([
      service.create(employerId, request(categoryId)),
      service.create(employerId, request(categoryId, { title: '창고 정리' })),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.jobPost.count()).toBe(1);
    expect(await balanceOf(employerId)).toBe(1_000);
  });

  it('should fill the work address from the member address', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(500_000);

    const created = await service.create(employerId, request(categoryId));

    expect(created.workAddress).toBe('서울 강남구 테헤란로 1');
  });

  it('should filter by category, region and title against the real database', async () => {
    // **가짜 저장소는 내가 쓴 필터 식을 그대로 되풀이한다.** 진짜 where절이
    // 같은 값을 내는지는 Postgres만 안다 — ac-verifier가 이 갭을 짚었다.
    const cleaning = await seedCategory();
    const delivery = await prisma.category.create({
      data: {
        name: '배달',
        slug: 'delivery',
        sortOrder: 2,
        placeholderText: '출발지와 도착지를 적어 주세요.',
      },
    });
    const employerId = await seedEmployer(1_000_000);

    await service.create(
      employerId,
      request(cleaning, { title: '강남 사무실 청소' }),
    );
    await service.create(
      employerId,
      request(cleaning, {
        title: '마포 창고 정리',
        workAddress: '서울 마포구 월드컵북로 1',
        workSido: '서울',
        workSigungu: '마포구',
      }),
    );
    await service.create(
      employerId,
      request(delivery.id, {
        title: '해운대 전단 배포',
        workAddress: '부산 해운대구 해운대로 1',
        workSido: '부산',
        workSigungu: '해운대구',
      }),
    );

    const byCategory = await service.list({ page: 1, category: delivery.id });
    expect(byCategory.items.map((i) => i.title)).toEqual(['해운대 전단 배포']);

    const bySido = await service.list({ page: 1, sido: '서울' });
    expect(bySido.total).toBe(2);

    // 시/도 없이 시/군/구만 골라도 걸린다.
    const bySigunguOnly = await service.list({ page: 1, sigungu: '해운대구' });
    expect(bySigunguOnly.items.map((i) => i.title)).toEqual([
      '해운대 전단 배포',
    ]);

    // 제목 부분 일치. 대소문자를 가리지 않는다.
    const byTitle = await service.list({ page: 1, q: '창고' });
    expect(byTitle.items.map((i) => i.title)).toEqual(['마포 창고 정리']);

    // AND로 겹친다.
    const both = await service.list({
      page: 1,
      category: cleaning,
      sigungu: '마포구',
    });
    expect(both.total).toBe(1);
  });

  it('should page through the real database and count only the matches', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(10_000_000);
    for (let i = 1; i <= 21; i += 1) {
      await service.create(
        employerId,
        request(categoryId, { title: `공고 ${i}` }),
      );
    }

    const first = await service.list({ page: 1 });
    const second = await service.list({ page: 2 });
    const past = await service.list({ page: 9 });

    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(1);
    expect(second.total).toBe(21);
    // 범위를 넘어도 오류가 아니라 빈 목록이다.
    expect(past.items).toHaveLength(0);
    expect(past.total).toBe(21);
  });

  it('should list the created post with its total', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(500_000);
    await service.create(employerId, request(categoryId));

    const list = await service.list({ page: 1 });

    expect(list.total).toBe(1);
    expect(list.items[0].status).toBe('OPEN');
  });
});
