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
    { countAccepted: () => Promise.resolve(0) },
  );
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  await prisma.penalty.deleteMany();
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

  it('should hide a soft-deleted post from the detail view', async () => {
    // 진짜 저장소가 `deletedAt`으로 거르는지는 Postgres만 안다.
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(500_000);
    const created = await service.create(employerId, request(categoryId));

    // 상세는 잘 나온다.
    expect((await service.findById(created.id)).categoryName).toBe('청소');

    await prisma.jobPost.update({
      where: { id: created.id },
      data: { deletedAt: new Date() },
    });

    await expect(service.findById(created.id)).rejects.toMatchObject({
      code: JOB_POST_ERRORS.NOT_FOUND,
    });
    // 목록에서도 사라진다.
    expect((await service.list({ page: 1 })).total).toBe(0);
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
describe('공고 수정 — 진짜 Postgres에서 (#15)', () => {
  it('should leave the version and the snapshot in step after several edits', async () => {
    // version만 오르고 스냅샷이 없으면 그 계약을 영영 복원할 수 없다.
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(5_000_000);
    const created = await service.create(employerId, request(categoryId));

    await service.update({
      employerId,
      jobPostId: created.id,
      patch: { rewardPerPerson: 60_000 },
    });
    await service.update({
      employerId,
      jobPostId: created.id,
      patch: { requiredDescription: '창고를 정리합니다.' },
    });

    const post = await prisma.jobPost.findUniqueOrThrow({
      where: { id: created.id },
    });
    const snapshots = await prisma.jobPostVersion.findMany({
      where: { jobPostId: created.id },
      orderBy: { version: 'asc' },
    });

    expect(post.version).toBe(3);
    expect(snapshots.map((s) => s.version)).toEqual([1, 2, 3]);
    // 스냅샷은 그 버전 시점의 값이다. v2는 보상금만 바뀐 상태.
    expect(snapshots[0].rewardPerPerson).toBe(REWARD);
    expect(snapshots[1].rewardPerPerson).toBe(60_000);
    expect(snapshots[2].requiredDescription).toBe('창고를 정리합니다.');
  });

  it('should not raise the version when only the title changes', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(5_000_000);
    const created = await service.create(employerId, request(categoryId));

    await service.update({
      employerId,
      jobPostId: created.id,
      patch: { title: '사무실 대청소' },
    });

    const post = await prisma.jobPost.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(post.version).toBe(1);
    expect(post.title).toBe('사무실 대청소');
    expect(await prisma.jobPostVersion.count()).toBe(1);
  });

  it('should keep the locked amount equal to the budget after an edit', async () => {
    // 인원을 올렸는데 잠금이 그대로면 약속한 돈보다 적게 잠긴 공고가 된다.
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(5_000_000);
    const created = await service.create(employerId, request(categoryId));

    const updated = await service.update({
      employerId,
      jobPostId: created.id,
      patch: { headcount: 10 },
    });

    const locked = await prisma.pointTransaction.aggregate({
      where: { referenceId: created.id },
      _sum: { amount: true },
    });
    expect(updated.budget).toBe(REWARD * 10);
    expect(locked._sum.amount).toBe(-updated.budget);
    expect(await balanceOf(employerId)).toBe(5_000_000 - updated.budget);
  });

  it('should release the difference when the budget goes down', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(5_000_000);
    const created = await service.create(employerId, request(categoryId));

    const updated = await service.update({
      employerId,
      jobPostId: created.id,
      patch: { rewardPerPerson: 10_000 },
    });

    const released = await prisma.pointTransaction.findFirstOrThrow({
      where: { referenceId: created.id, type: 'RELEASE' },
    });
    expect(released.amount).toBe(BUDGET - updated.budget);
    expect(await balanceOf(employerId)).toBe(5_000_000 - updated.budget);
  });

  it('should restore the contract of an older version', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(5_000_000);
    const created = await service.create(employerId, request(categoryId));
    await service.update({
      employerId,
      jobPostId: created.id,
      patch: { headcount: 9 },
    });

    const v1 = await service.findVersion(created.id, 1);
    const v2 = await service.findVersion(created.id, 2);

    // 계약 복원이 한 줄이다 (ADR-JOB-1).
    expect(v1.headcount).toBe(HEADCOUNT);
    expect(v2.headcount).toBe(9);
  });

  it('should leave neither the version nor the hold when the balance is short', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(BUDGET);
    const created = await service.create(employerId, request(categoryId));

    await expect(
      service.update({
        employerId,
        jobPostId: created.id,
        patch: { headcount: 50 },
      }),
    ).rejects.toMatchObject({ code: JOB_POST_ERRORS.INSUFFICIENT_BALANCE });

    const post = await prisma.jobPost.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(post.version).toBe(1);
    expect(post.headcount).toBe(HEADCOUNT);
    expect(await prisma.jobPostVersion.count()).toBe(1);
    expect(await balanceOf(employerId)).toBe(0);
  });
});
describe('공고 취소 — 진짜 Postgres에서 (#16)', () => {
  it('should keep the row in the database after cancelling', async () => {
    // 목록에서 사라지지만 DB에는 남는다 (AC3).
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(1_000_000);
    const created = await service.create(employerId, request(categoryId));

    await service.cancel({ employerId, jobPostId: created.id });

    const row = await prisma.jobPost.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.status).toBe('CANCELLED');
    expect(row.deletedAt).toBeNull();
    expect((await service.list({ page: 1 })).total).toBe(0);
    // 상세로는 여전히 볼 수 있다 (#14).
    expect((await service.findById(created.id)).status).toBe('CANCELLED');
  });

  it('should return the whole locked amount to the balance', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(1_000_000);
    const created = await service.create(employerId, request(categoryId));
    expect(await balanceOf(employerId)).toBe(1_000_000 - BUDGET);

    const result = await service.cancel({ employerId, jobPostId: created.id });

    expect(result.released).toBe(BUDGET);
    expect(await balanceOf(employerId)).toBe(1_000_000);
    // 그 공고에 잠긴 돈이 0이 된다.
    const locked = await prisma.pointTransaction.aggregate({
      where: { referenceId: created.id },
      _sum: { amount: true },
    });
    expect(locked._sum.amount).toBe(0);
  });

  it('should release what is actually locked after an edit changed the budget', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(5_000_000);
    const created = await service.create(employerId, request(categoryId));
    await service.update({
      employerId,
      jobPostId: created.id,
      patch: { headcount: 10 },
    });

    const result = await service.cancel({ employerId, jobPostId: created.id });

    expect(result.released).toBe(REWARD * 10);
    expect(await balanceOf(employerId)).toBe(5_000_000);
  });

  it('should release only once when two cancels arrive at the same time', async () => {
    // 둘 다 OPEN을 읽는 창이 있다. 막는 것은 원장의 유니크 제약이다.
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(1_000_000);
    const created = await service.create(employerId, request(categoryId));

    const results = await Promise.allSettled([
      service.cancel({ employerId, jobPostId: created.id }),
      service.cancel({ employerId, jobPostId: created.id }),
    ]);

    // 하나는 성공하고 하나는 전이표나 유니크 제약에 걸린다.
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(
      await prisma.pointTransaction.count({
        where: { referenceId: created.id, type: 'RELEASE' },
      }),
    ).toBe(1);
    // **잔액이 두 배로 돌아오면 안 된다.**
    expect(await balanceOf(employerId)).toBe(1_000_000);
  });

  it('should record no penalty row when nobody was accepted', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(1_000_000);
    const created = await service.create(employerId, request(categoryId));

    await service.cancel({ employerId, jobPostId: created.id });

    expect(await prisma.penalty.count()).toBe(0);
  });
});
describe('공고 취소 — 상태 가드 (#16, ac-verifier가 잡은 것)', () => {
  it('should cancel a CLOSED post against the real database', async () => {
    // 전이표에 `CLOSED → CANCELLED`가 있다. 저장소가 'OPEN'을 하드코딩하고
    // 있었을 때는 이 경로를 타는 테스트가 하나도 없었다.
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(1_000_000);
    const created = await service.create(employerId, request(categoryId));
    await prisma.jobPost.update({
      where: { id: created.id },
      data: { status: 'CLOSED' },
    });

    const result = await service.cancel({ employerId, jobPostId: created.id });

    expect(result.status).toBe('CANCELLED');
    expect(result.released).toBe(BUDGET);
    expect(await balanceOf(employerId)).toBe(1_000_000);
  });

  it('should not overwrite a post whose status changed after it was read', async () => {
    // 서비스의 조회와 저장소의 쓰기는 다른 트랜잭션이다. 그 사이에 다른
    // 경로가 상태를 바꿨으면 덮어쓰면 안 된다.
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(1_000_000);
    const created = await service.create(employerId, request(categoryId));

    const store = new PrismaJobPostStore(prisma as unknown as PrismaService);
    // 서비스가 OPEN을 읽은 직후 누군가 COMPLETED로 바꾼 상황이다.
    await prisma.jobPost.update({
      where: { id: created.id },
      data: { status: 'COMPLETED' },
    });

    const result = await store.cancelAndRelease({
      jobPostId: created.id,
      employerId,
      expectedStatus: 'OPEN',
      penalize: false,
      idempotencyKey: `cancel:${created.id}`,
    });

    expect(result).toBe('STALE');
    const row = await prisma.jobPost.findUniqueOrThrow({
      where: { id: created.id },
    });
    // 상태도 돈도 그대로다.
    expect(row.status).toBe('COMPLETED');
    expect(await balanceOf(employerId)).toBe(1_000_000 - BUDGET);
    expect(
      await prisma.pointTransaction.count({
        where: { referenceId: created.id, type: 'RELEASE' },
      }),
    ).toBe(0);
  });

  it('should report a stale status as an invalid transition', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(1_000_000);
    const created = await service.create(employerId, request(categoryId));
    await prisma.jobPost.update({
      where: { id: created.id },
      data: { status: 'EXPIRED' },
    });

    // EXPIRED는 전이표에 없으므로 서비스가 먼저 막는다.
    await expect(
      service.cancel({ employerId, jobPostId: created.id }),
    ).rejects.toMatchObject({ code: JOB_POST_ERRORS.INVALID_TRANSITION });
  });

  it('should always report penalized false while the accepted counter is stubbed', async () => {
    // **#17이 어댑터를 채우기 전까지 AC2는 실제로 동작하지 않는다.**
    // 이 테스트가 그 사실을 고정한다 — 조용히 바뀌면 여기가 빨개진다.
    const categoryId = await seedCategory();
    const employerId = await seedEmployer(1_000_000);
    const created = await service.create(employerId, request(categoryId));

    const result = await service.cancel({ employerId, jobPostId: created.id });

    expect(result.penalized).toBe(false);
    expect(await prisma.penalty.count()).toBe(0);
  });
});
