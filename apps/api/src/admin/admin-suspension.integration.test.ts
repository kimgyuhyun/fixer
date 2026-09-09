import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import {
  ADMIN_ACTIONS,
  JOB_POST_ERRORS,
  PENALTY_WINDOW_DAYS,
} from '@fixer/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { JobPostError, JobPostService } from '../job-post/job-post.service';
import {
  PrismaAcceptedCounter,
  PrismaBalanceReader,
  PrismaJobPostStore,
  PrismaMemberAddressReader,
} from '../job-post/prisma-job-post.store';
import { PrismaSuspensionReader } from '../penalty/suspension.reader';
import type { PublishNotificationInput } from '../notification/notification.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminSuspensionService } from './admin-suspension.service';
import { PrismaAdminSuspensionStore } from './prisma-admin.store';

/**
 * **"현재 제재 중인 회원만"은 진짜 SQL만 안다.** (이슈 #33)
 *
 * 가짜 저장소에 `releasedAt IS NULL AND endAt > now()`를 흉내 내면 그 흉내를
 * 검증하게 된다. 여기서는 `Suspension` 행을 실제 시각으로 심고, 목록이 그
 * 행들을 어떻게 거르는지를 본다.
 *
 * 해제와 감사 로그가 **한 트랜잭션**인지, 그리고 해제해도 `Penalty`가 남는지도
 * 여기서만 증명된다 — 나눠 놓아도 순서대로 실행되는 가짜에서는 통과한다.
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let admin: AdminSuspensionService;
let store: PrismaAdminSuspensionStore;
let posts: JobPostService;
let published: PublishNotificationInput[];

const DAY_MS = 24 * 60 * 60 * 1000;
const REWARD = 50_000;
const HEADCOUNT = 3;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const as = prisma as unknown as PrismaService;
  published = [];
  store = new PrismaAdminSuspensionStore(as);
  admin = new AdminSuspensionService(store, {
    publish: (input) => {
      published.push(input);
      return Promise.resolve();
    },
  });
  posts = new JobPostService(
    new PrismaJobPostStore(as),
    new PrismaMemberAddressReader(as),
    new PrismaBalanceReader(as),
    new PrismaAcceptedCounter(as),
    // 재동의 알림(#21)은 이 파일의 관심사가 아니다.
    { publish: () => Promise.resolve() },
    // **진짜 판정을 쓴다.** 대역으로 바꾸면 AC4가 아무것도 검증하지 않는다.
    new PrismaSuspensionReader(as),
  );
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  published.length = 0;
  await prisma.adminAuditLog.deleteMany();
  await prisma.suspension.deleteMany();
  await prisma.penalty.deleteMany();
  await prisma.jobPostVersion.deleteMany();
  await prisma.jobPost.deleteMany();
  await prisma.pointTransaction.deleteMany();
  await prisma.userAddress.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
});

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

/** 충전된 회원 하나. 주소와 잔액까지 갖춰 공고를 올릴 수 있는 상태다 */
async function seedMember(name: string, balance = 500_000): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${encodeURIComponent(name)}@example.com`,
      passwordHash: 'h',
      name,
    },
  });
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

/** 그 사람에게 유효한 제재 하나. 끝 시각을 옮겨 경계를 만든다 */
async function seedSuspension(
  userId: string,
  endAt: Date,
  releasedAt: Date | null = null,
): Promise<string> {
  const row = await prisma.suspension.create({
    data: {
      userId,
      startAt: new Date(Date.now() - DAY_MS),
      endAt,
      releasedAt,
      ...(releasedAt === null
        ? {}
        : { releasedBy: 'seed', releaseReason: '씨앗' }),
    },
  });
  return row.id;
}

/** 경고 `count`건을 `daysAgo` 전에 생긴 것으로 심는다 */
async function seedPenalties(
  userId: string,
  count: number,
  daysAgo: number,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await prisma.penalty.create({
      data: {
        userId,
        reason: 'NO_SHOW',
        occurredAt: new Date(Date.now() - daysAgo * DAY_MS),
      },
    });
  }
}

async function seedCategory(): Promise<string> {
  const row = await prisma.category.create({
    data: {
      name: '청소',
      slug: 'cleaning',
      sortOrder: 1,
      placeholderText: '적어 주세요.',
    },
  });
  return row.id;
}

function postJob(employerId: string, categoryId: string) {
  return posts.create(employerId, {
    categoryId,
    title: '사무실 청소',
    workStartAt: '2026-10-01T09:00:00.000Z',
    workEndAt: '2026-10-01T18:00:00.000Z',
    headcount: HEADCOUNT,
    rewardPerPerson: REWARD,
    requiredDescription: '30평 사무실 바닥과 창문을 닦습니다.',
  });
}

describe('블랙리스트 목록 — 진짜 Postgres에서', () => {
  it("should return only that member's row when q matches a member name partially and case-insensitively", async () => {
    const hit = await seedMember('Kim제재');
    const miss = await seedMember('박정상');
    await seedSuspension(hit, new Date(Date.now() + DAY_MS));
    await seedSuspension(miss, new Date(Date.now() + DAY_MS));

    const list = await admin.list({ q: 'kim', page: 1 });

    expect(list.items.map((i) => i.userId)).toEqual([hit]);
  });

  it('should exclude a suspension whose endAt has already passed', async () => {
    const userId = await seedMember('김만료');
    await seedSuspension(userId, new Date(Date.now() - DAY_MS));

    const list = await admin.list({ page: 1 });

    expect(list.items).toEqual([]);
  });

  it('should exclude a suspension that an admin already released', async () => {
    const userId = await seedMember('김해제');
    await seedSuspension(userId, new Date(Date.now() + DAY_MS), new Date());

    const list = await admin.list({ page: 1 });

    expect(list.items).toEqual([]);
  });

  it('should include a suspension whose endAt is one millisecond after now', async () => {
    const userId = await seedMember('김경계');
    // 끝 시각 정각은 이미 끝난 것이다 — 부등호가 `>`이지 `>=`가 아니다 (§5.1).
    // 1밀리초 뒤는 아직 제재 중이다.
    await seedSuspension(userId, new Date(Date.now() + 60 * 1000));

    const list = await admin.list({ page: 1 });

    expect(list.items.map((i) => i.userId)).toEqual([userId]);
  });

  it('should count only the penalties inside the 180-day window as penaltyCount', async () => {
    const userId = await seedMember('김누적');
    await seedPenalties(userId, 5, 10);
    await seedPenalties(userId, 3, PENALTY_WINDOW_DAYS + 10);
    await seedSuspension(userId, new Date(Date.now() + DAY_MS));

    const list = await admin.list({ page: 1 });

    expect(list.items[0]?.penaltyCount).toBe(5);
  });
});

describe('제재 조기 해제 — 진짜 Postgres에서', () => {
  it('should record releasedAt, releasedBy and releaseReason on the suspension', async () => {
    const adminId = await seedAdmin();
    const userId = await seedMember('김제재');
    const suspensionId = await seedSuspension(
      userId,
      new Date(Date.now() + 4 * DAY_MS),
    );

    await admin.release({ adminId, suspensionId, reason: '이의 인정' });

    const row = await prisma.suspension.findUnique({
      where: { id: suspensionId },
    });
    expect({
      released: row?.releasedAt !== null,
      by: row?.releasedBy,
      reason: row?.releaseReason,
    }).toEqual({ released: true, by: adminId, reason: '이의 인정' });
  });

  it('should record an AdminAuditLog row carrying the admin id, the reason and the time', async () => {
    const adminId = await seedAdmin();
    const userId = await seedMember('김제재');
    const suspensionId = await seedSuspension(
      userId,
      new Date(Date.now() + 4 * DAY_MS),
    );

    await admin.release({ adminId, suspensionId, reason: '이의 인정' });

    const logs = await prisma.adminAuditLog.findMany();
    expect(logs).toHaveLength(1);
    expect({
      adminId: logs[0]?.adminId,
      action: logs[0]?.action,
      targetType: logs[0]?.targetType,
      targetId: logs[0]?.targetId,
      reason: logs[0]?.reason,
      hasTime: logs[0]?.createdAt instanceof Date,
    }).toEqual({
      adminId,
      action: ADMIN_ACTIONS.SUSPENSION_RELEASE,
      targetType: 'Suspension',
      targetId: suspensionId,
      reason: '이의 인정',
      hasTime: true,
    });
  });

  it('should keep every Penalty row of the released member with its original reason and occurredAt', async () => {
    const adminId = await seedAdmin();
    const userId = await seedMember('김제재');
    await seedPenalties(userId, 5, 10);
    const before = await prisma.penalty.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
    });
    const suspensionId = await seedSuspension(
      userId,
      new Date(Date.now() + 4 * DAY_MS),
    );

    await admin.release({ adminId, suspensionId, reason: '이의 인정' });

    const after = await prisma.penalty.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
    });
    expect(after).toEqual(before);
  });

  it('should keep the released Suspension row instead of deleting it', async () => {
    const adminId = await seedAdmin();
    const userId = await seedMember('김제재');
    const suspensionId = await seedSuspension(
      userId,
      new Date(Date.now() + 4 * DAY_MS),
    );

    await admin.release({ adminId, suspensionId, reason: '이의 인정' });

    expect(
      await prisma.suspension.findUnique({ where: { id: suspensionId } }),
    ).not.toBeNull();
  });

  it('should release exactly once when the same suspension is released twice concurrently', async () => {
    const adminId = await seedAdmin();
    const userId = await seedMember('김제재');
    const suspensionId = await seedSuspension(
      userId,
      new Date(Date.now() + 4 * DAY_MS),
    );

    const results = await Promise.allSettled([
      admin.release({ adminId, suspensionId, reason: '이의 인정' }),
      admin.release({ adminId, suspensionId, reason: '이의 인정' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.adminAuditLog.count()).toBe(1);
  });

  it('should leave the suspension unreleased when writing the audit log fails', async () => {
    const userId = await seedMember('김제재');
    const suspensionId = await seedSuspension(
      userId,
      new Date(Date.now() + 4 * DAY_MS),
    );

    // 존재하지 않는 관리자다. `AdminAuditLog.adminId`의 외래키가 거부하므로
    // 감사 로그 쓰기만 실패한다 — 그때 해제까지 함께 되돌아가야 한다.
    const failed = await store
      .release({
        suspensionId,
        adminId: 'usr_does_not_exist',
        reason: '이의 인정',
        now: new Date(),
      })
      .catch(() => 'THREW' as const);

    expect(failed).toBe('THREW');
    const row = await prisma.suspension.findUnique({
      where: { id: suspensionId },
    });
    expect(row?.releasedAt).toBeNull();
  });

  it("should keep the member's 180-day penalty count unchanged after the release", async () => {
    const adminId = await seedAdmin();
    const userId = await seedMember('김제재');
    await seedPenalties(userId, 5, 10);
    const suspensionId = await seedSuspension(
      userId,
      new Date(Date.now() + 4 * DAY_MS),
    );

    await admin.release({ adminId, suspensionId, reason: '이의 인정' });

    expect(await prisma.penalty.count({ where: { userId } })).toBe(5);
  });
});

describe('해제된 회원의 공고 등록 — 진짜 Postgres에서', () => {
  it('should let the member post a job right after the admin releases the suspension', async () => {
    const adminId = await seedAdmin();
    const categoryId = await seedCategory();
    const userId = await seedMember('김제재');
    const suspensionId = await seedSuspension(
      userId,
      new Date(Date.now() + 4 * DAY_MS),
    );

    // 풀기 전에는 막혀 있어야 한다. 이게 아니면 뒤의 성공이 무의미하다.
    const blocked = await postJob(userId, categoryId).catch(
      (e: unknown) => e as JobPostError,
    );
    expect(blocked).toBeInstanceOf(JobPostError);

    await admin.release({ adminId, suspensionId, reason: '이의 인정' });

    const created = await postJob(userId, categoryId);
    expect(created.status).toBe('OPEN');
  });

  it("should create the post when the member's only suspension was released early", async () => {
    const adminId = await seedAdmin();
    const categoryId = await seedCategory();
    const userId = await seedMember('김제재');
    // 아직 만료 전이다. 조기 해제가 아니면 여전히 막혀야 하는 상태다.
    const suspensionId = await seedSuspension(
      userId,
      new Date(Date.now() + 4 * DAY_MS),
    );
    await admin.release({ adminId, suspensionId, reason: '이의 인정' });

    const created = await postJob(userId, categoryId);

    expect(created.status).toBe('OPEN');
  });

  it('should still block the member when a second suspension of theirs is still active', async () => {
    const adminId = await seedAdmin();
    const categoryId = await seedCategory();
    const userId = await seedMember('김제재');
    const released = await seedSuspension(
      userId,
      new Date(Date.now() + 4 * DAY_MS),
    );
    await seedSuspension(userId, new Date(Date.now() + 2 * DAY_MS));

    await admin.release({
      adminId,
      suspensionId: released,
      reason: '이의 인정',
    });

    const error = await postJob(userId, categoryId).catch((e: unknown) => e);
    expect((error as JobPostError).code).toBe(JOB_POST_ERRORS.SUSPENDED);
  });

  it("should still block a member whose own suspension is untouched while another member's was released", async () => {
    const adminId = await seedAdmin();
    const categoryId = await seedCategory();
    const freed = await seedMember('김해제');
    const stillBlocked = await seedMember('박제재');
    const freedSuspension = await seedSuspension(
      freed,
      new Date(Date.now() + 4 * DAY_MS),
    );
    await seedSuspension(stillBlocked, new Date(Date.now() + 4 * DAY_MS));

    await admin.release({
      adminId,
      suspensionId: freedSuspension,
      reason: '이의 인정',
    });

    const error = await postJob(stillBlocked, categoryId).catch(
      (e: unknown) => e,
    );
    expect((error as JobPostError).code).toBe(JOB_POST_ERRORS.SUSPENDED);
  });
});
