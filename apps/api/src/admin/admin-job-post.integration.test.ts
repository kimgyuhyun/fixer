import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { ADMIN_ACTIONS } from '@fixer/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { JobPostService } from '../job-post/job-post.service';
import {
  PrismaBalanceReader,
  PrismaJobPostStore,
  PrismaMemberAddressReader,
} from '../job-post/prisma-job-post.store';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminJobPostService } from './admin-job-post.service';
import {
  PrismaAdminJobPostStore,
  PrismaRoleReader,
} from './prisma-admin.store';

/**
 * **검색이 실제로 좁히는지는 진짜 SQL만 안다.** (이슈 #35)
 *
 * 가짜 저장소에 필터를 구현해서 검증하면 그 가짜를 검증하게 된다. 부분 일치,
 * 대소문자 무시, 조인한 이름으로 거르기는 전부 Postgres의 동작이다.
 *
 * 감사 로그가 취소와 **한 트랜잭션**인지도 여기서만 증명된다 — 나눠 놓아도
 * 순서대로 실행되는 가짜에서는 통과한다.
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let posts: JobPostService;
let admin: AdminJobPostService;
let store: PrismaJobPostStore;
let roles: PrismaRoleReader;

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
  const as = prisma as unknown as PrismaService;
  store = new PrismaJobPostStore(as);
  posts = new JobPostService(
    store,
    new PrismaMemberAddressReader(as),
    new PrismaBalanceReader(as),
    { countAccepted: () => Promise.resolve(0) },
  );
  roles = new PrismaRoleReader(as);
  admin = new AdminJobPostService(new PrismaAdminJobPostStore(as), store, {
    countAccepted: () => Promise.resolve(0),
  });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  await prisma.adminAuditLog.deleteMany();
  await prisma.penalty.deleteMany();
  await prisma.jobPostVersion.deleteMany();
  await prisma.jobPost.deleteMany();
  await prisma.pointTransaction.deleteMany();
  await prisma.userAddress.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
});

async function seedCategory(name = '청소', slug = 'cleaning'): Promise<string> {
  const row = await prisma.category.create({
    data: { name, slug, sortOrder: 1, placeholderText: '적어 주세요.' },
  });
  return row.id;
}

async function seedAdmin(): Promise<string> {
  const row = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      passwordHash: 'h',
      name: '김관리',
      role: 'ADMIN',
    },
  });
  return row.id;
}

/** 충전된 구인자 하나. 캐시와 원장을 함께 올린다 */
async function seedEmployer(name: string, balance: number): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${encodeURIComponent(name)}@example.com`,
      passwordHash: 'h',
      name,
    },
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

async function seedPost(
  employerId: string,
  categoryId: string,
  title: string,
): Promise<string> {
  const created = await posts.create(employerId, {
    categoryId,
    title,
    workStartAt: '2026-10-01T09:00:00.000Z',
    workEndAt: '2026-10-01T18:00:00.000Z',
    headcount: HEADCOUNT,
    rewardPerPerson: REWARD,
    requiredDescription: '30평 사무실 바닥과 창문을 닦습니다.',
  });
  return created.id;
}

describe('관리자 공고 목록 — 진짜 Postgres에서', () => {
  it('should include posts of every status when no status filter is given', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer('박구인', 500_000);
    const open = await seedPost(employerId, categoryId, '사무실 청소');
    const cancelled = await seedPost(employerId, categoryId, '창고 정리');
    await posts.cancel({ employerId, jobPostId: cancelled });

    const list = await admin.list({ page: 1 });

    expect(list.items.map((i) => i.id).sort()).toEqual(
      [open, cancelled].sort(),
    );
    expect(list.items.map((i) => i.status).sort()).toEqual([
      'CANCELLED',
      'OPEN',
    ]);
  });

  it("should return only that employer's posts when q matches an employer name", async () => {
    const categoryId = await seedCategory();
    const mine = await seedEmployer('박구인', 500_000);
    const other = await seedEmployer('최사장', 500_000);
    const target = await seedPost(mine, categoryId, '사무실 청소');
    await seedPost(other, categoryId, '창고 정리');

    const list = await admin.list({ q: '박구인', page: 1 });

    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.id).toBe(target);
    expect(list.items[0]?.employerName).toBe('박구인');
    expect(list.total).toBe(1);
  });

  it('should return the post when q matches its title instead of an employer name', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer('박구인', 500_000);
    const target = await seedPost(employerId, categoryId, '사무실 청소');
    await seedPost(employerId, categoryId, '창고 정리');

    const list = await admin.list({ q: '사무실', page: 1 });

    expect(list.items.map((i) => i.id)).toEqual([target]);
  });

  it('should match an employer name partially and case-insensitively', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer('Park Boss', 500_000);
    const target = await seedPost(employerId, categoryId, '사무실 청소');

    const list = await admin.list({ q: 'park', page: 1 });

    expect(list.items.map((i) => i.id)).toEqual([target]);
  });

  it('should narrow by both filters when q and status are given together', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer('박구인', 500_000);
    const open = await seedPost(employerId, categoryId, '사무실 청소');
    const cancelled = await seedPost(employerId, categoryId, '사무실 정리');
    await posts.cancel({ employerId, jobPostId: cancelled });

    // 검색어는 둘 다 맞지만 상태로 하나만 남는다. OR이면 둘 다 온다.
    const list = await admin.list({ q: '사무실', status: 'OPEN', page: 1 });

    expect(list.items.map((i) => i.id)).toEqual([open]);
  });
});

describe('관리자 강제 취소 — 진짜 Postgres에서', () => {
  it('should record exactly one RELEASE when the same post is force-cancelled twice concurrently', async () => {
    const categoryId = await seedCategory();
    const adminId = await seedAdmin();
    const employerId = await seedEmployer('박구인', 500_000);
    const jobPostId = await seedPost(employerId, categoryId, '사무실 청소');

    const results = await Promise.allSettled([
      admin.forceCancel({ adminId, jobPostId, reason: '허위 공고' }),
      admin.forceCancel({ adminId, jobPostId, reason: '허위 공고' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const releases = await prisma.pointTransaction.findMany({
      where: { referenceId: jobPostId, type: 'RELEASE' },
    });
    expect(releases).toHaveLength(1);
    expect(releases[0]?.amount).toBe(BUDGET);
  });

  it('should leave the post uncancelled when writing the audit log fails', async () => {
    const categoryId = await seedCategory();
    const employerId = await seedEmployer('박구인', 500_000);
    const jobPostId = await seedPost(employerId, categoryId, '사무실 청소');

    // 존재하지 않는 관리자다. `AdminAuditLog.adminId`의 외래키가 거부하므로
    // 감사 로그 쓰기만 실패한다 — 그때 취소까지 함께 되돌아가야 한다.
    const failed = await store
      .cancelAndRelease({
        jobPostId,
        employerId,
        expectedStatus: 'OPEN',
        penalize: false,
        idempotencyKey: `cancel:${jobPostId}`,
        audit: { adminId: 'usr_does_not_exist', reason: '허위 공고' },
      })
      .catch(() => 'THREW' as const);

    expect(failed).toBe('THREW');

    const row = await prisma.jobPost.findUnique({ where: { id: jobPostId } });
    expect(row?.status).toBe('OPEN');
    const releases = await prisma.pointTransaction.findMany({
      where: { referenceId: jobPostId, type: 'RELEASE' },
    });
    expect(releases).toHaveLength(0);
  });

  it('should record an audit log carrying who, when and why', async () => {
    const categoryId = await seedCategory();
    const adminId = await seedAdmin();
    const employerId = await seedEmployer('박구인', 500_000);
    const jobPostId = await seedPost(employerId, categoryId, '사무실 청소');

    await admin.forceCancel({ adminId, jobPostId, reason: '허위 공고' });

    const logs = await prisma.adminAuditLog.findMany({
      where: { targetType: 'JobPost', targetId: jobPostId },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      adminId,
      action: ADMIN_ACTIONS.JOB_POST_FORCE_CANCEL,
      reason: '허위 공고',
    });
    expect(logs[0]?.createdAt).toBeInstanceOf(Date);
  });
});

/**
 * `@ac-verifier`가 AC1을 부분 충족으로 판정해 더한 것. (Green 이후)
 *
 * AC1의 Given이 "관리자"인데, **관리자를 실제로 판별하는 이 함수가 저장소
 * 전체에서 한 번도 실행된 적이 없었다** — 가드 테스트도 컨트롤러 테스트도
 * 대역을 꽂는다. `role` 컬럼을 읽는 쿼리가 진짜로 도는지는 여기서만 안다.
 */
describe('PrismaRoleReader — 진짜 Postgres에서', () => {
  it('should return the seeded role from a real Postgres row and null for a user id that does not exist', async () => {
    const adminId = await seedAdmin();
    const memberId = await seedEmployer('박구인', 0);

    await expect(roles.roleOf(adminId)).resolves.toBe('ADMIN');
    // 기본값이 USER다. 가입만 한 사람이 관리자가 되면 안 된다.
    await expect(roles.roleOf(memberId)).resolves.toBe('USER');
    await expect(roles.roleOf('usr_does_not_exist')).resolves.toBeNull();
  });
});
