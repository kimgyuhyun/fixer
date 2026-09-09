import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { PENALTY_WINDOW_DAYS } from '@fixer/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminMemberService } from './admin-member.service';
import { PrismaAdminMemberStore } from './prisma-admin-member.store';

/**
 * **"그 지역 회원만"과 "180일 창 안 경고"는 진짜 SQL만 안다.** (이슈 #32)
 *
 * 가짜 저장소에 필터를 흉내 내면 그 흉내를 검증하게 된다. 여기서는 회원과
 * 주소·별점·공고·신청·원장·경고·제재를 실제로 심고, 목록이 그 행들을 어떻게
 * 거르는지와 상세가 다섯 덩이를 한 번에 모아 오는지를 본다.
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let service: AdminMemberService;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 상세를 볼 회원. 다섯 덩이가 전부 달려 있다 */
let richId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  service = new AdminMemberService(
    new PrismaAdminMemberStore(prisma as unknown as PrismaService),
  );
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

async function createMember(input: {
  name: string;
  email: string;
  address?: { sido: string; sigungu: string };
  deactivated?: boolean;
  ratings?: {
    asPoster: number | null;
    asPosterCount: number;
    asWorker: number | null;
    asWorkerCount: number;
  };
}): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash: 'h',
      name: input.name,
      deactivatedAt: input.deactivated === true ? new Date() : null,
      ratingAsPoster: input.ratings?.asPoster ?? null,
      ratingAsPosterCount: input.ratings?.asPosterCount ?? 0,
      ratingAsWorker: input.ratings?.asWorker ?? null,
      ratingAsWorkerCount: input.ratings?.asWorkerCount ?? 0,
    },
  });

  if (input.address !== undefined) {
    await prisma.userAddress.create({
      data: {
        userId: user.id,
        label: '기본',
        postalCode: '06236',
        roadAddress: `${input.address.sido} ${input.address.sigungu} 테헤란로 1`,
        jibunAddress: `${input.address.sido} ${input.address.sigungu} 역삼동 1`,
        sido: input.address.sido,
        sigungu: input.address.sigungu,
      },
    });
  }

  return user.id;
}

async function createJobPost(
  employerId: string,
  categoryId: string,
  title: string,
): Promise<string> {
  const post = await prisma.jobPost.create({
    data: {
      employerId,
      categoryId,
      title,
      status: 'COMPLETED',
      workAddress: '서울특별시 강남구 테헤란로 1',
      workSido: '서울특별시',
      workSigungu: '강남구',
      workStartAt: new Date(Date.now() + DAY_MS),
      workEndAt: new Date(Date.now() + DAY_MS + 3 * 60 * 60 * 1000),
      headcount: 2,
      rewardPerPerson: 30_000,
      requiredDescription: '장갑 지참',
    },
  });
  return post.id;
}

/**
 * 여섯 명을 심는다. 지역·상태·검색어가 서로 다르게 걸리도록 골랐다.
 *
 * | 이름     | 지역             | 상태                        |
 * | 김서울   | 서울 강남구      | 정상 (만료·해제된 제재 있음) |
 * | 이서울   | 서울 마포구      | 정상                        |
 * | 박부산   | 부산 해운대구    | 정상                        |
 * | 최무주소 | (주소 없음)      | 정상                        |
 * | 정탈퇴   | 서울 강남구      | 비활성화                    |
 * | 한제재   | 서울 강남구      | 제재중                      |
 */
beforeEach(async () => {
  await prisma.rating.deleteMany();
  await prisma.application.deleteMany();
  await prisma.jobPost.deleteMany();
  await prisma.pointTransaction.deleteMany();
  await prisma.penalty.deleteMany();
  await prisma.suspension.deleteMany();
  await prisma.userAddress.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();

  const category = await prisma.category.create({
    data: {
      name: '청소',
      slug: 'cleaning',
      sortOrder: 1,
      placeholderText: '무엇을 청소하나요',
    },
  });

  richId = await createMember({
    name: '김서울',
    email: 'seoul@example.com',
    address: { sido: '서울특별시', sigungu: '강남구' },
    ratings: {
      asPoster: 4.5,
      asPosterCount: 4,
      asWorker: 3.5,
      asWorkerCount: 6,
    },
  });
  await createMember({
    name: '이서울',
    email: 'lee@example.com',
    address: { sido: '서울특별시', sigungu: '마포구' },
  });
  const busanId = await createMember({
    name: '박부산',
    email: 'busan@example.com',
    address: { sido: '부산광역시', sigungu: '해운대구' },
  });
  await createMember({ name: '최무주소', email: 'noaddr@example.com' });
  await createMember({
    name: '정탈퇴',
    email: 'quit@example.com',
    address: { sido: '서울특별시', sigungu: '강남구' },
    deactivated: true,
  });
  const bannedId = await createMember({
    name: '한제재',
    email: 'ban@example.com',
    address: { sido: '서울특별시', sigungu: '강남구' },
  });

  // 한제재만 유효 제재다 (§5.1: releasedAt IS NULL AND endAt > now()).
  await prisma.suspension.create({
    data: {
      userId: bannedId,
      startAt: new Date(Date.now() - DAY_MS),
      endAt: new Date(Date.now() + 4 * DAY_MS),
    },
  });

  // 김서울의 제재 둘은 **만료된 것과 해제된 것**이다. 둘 다 유효하지 않다.
  await prisma.suspension.createMany({
    data: [
      {
        userId: richId,
        startAt: new Date(Date.now() - 10 * DAY_MS),
        endAt: new Date(Date.now() - 5 * DAY_MS),
      },
      {
        userId: richId,
        startAt: new Date(Date.now() - 2 * DAY_MS),
        endAt: new Date(Date.now() + 3 * DAY_MS),
        releasedAt: new Date(Date.now() - DAY_MS),
        releasedBy: 'usr_admin',
        releaseReason: '이의 인정',
      },
    ],
  });

  const ownPost = await createJobPost(richId, category.id, '이사 짐 나르기');
  const otherPost = await createJobPost(busanId, category.id, '카페 마감 청소');

  const application = await prisma.application.create({
    data: {
      jobPostId: otherPost,
      applicantId: richId,
      status: 'COMPLETED',
      appliedVersion: 1,
    },
  });

  await prisma.rating.create({
    data: {
      applicationId: application.id,
      raterId: busanId,
      rateeId: richId,
      rateeRole: 'WORKER',
      score: 5,
    },
  });

  await prisma.pointTransaction.createMany({
    data: [
      {
        userId: richId,
        type: 'CHARGE',
        amount: 50_000,
        idempotencyKey: 'pay_1',
      },
      {
        userId: richId,
        type: 'HOLD',
        amount: -20_000,
        idempotencyKey: `hold_${ownPost}`,
        referenceId: ownPost,
      },
    ],
  });

  // 창 안 하나, 창 밖 하나. 목록의 경고 수는 창 안 하나만 세야 한다 (§5).
  await prisma.penalty.createMany({
    data: [
      {
        userId: richId,
        reason: 'NO_SHOW',
        jobPostId: otherPost,
        occurredAt: new Date(Date.now() - 10 * DAY_MS),
      },
      {
        userId: richId,
        reason: 'LATE_CANCEL',
        occurredAt: new Date(Date.now() - (PENALTY_WINDOW_DAYS + 20) * DAY_MS),
      },
    ],
  });
});

/** 목록에서 이름만 뽑는다. 순서를 보지 않는 비교를 위해 정렬한다 */
async function namesOf(
  filter: Partial<Parameters<AdminMemberService['list']>[0]> = {},
): Promise<string[]> {
  const list = await service.list({ page: 1, ...filter });
  return list.items.map((item) => item.name).sort();
}

describe('AdminMemberService.list (real database)', () => {
  it('should return only members whose name partially matches the search word', async () => {
    await expect(namesOf({ q: '김서' })).resolves.toEqual(['김서울']);
  });

  it('should also match a partial email with the same search word', async () => {
    // 이름에는 없고 이메일에만 있는 조각이다 (§11.2 "이름·이메일 부분 일치").
    await expect(namesOf({ q: 'busan' })).resolves.toEqual(['박부산']);
  });

  it('should return only members living in the chosen sido', async () => {
    await expect(namesOf({ sido: '서울특별시' })).resolves.toEqual([
      '김서울',
      '이서울',
      '정탈퇴',
      '한제재',
    ]);
  });

  it('should narrow further with sigungu', async () => {
    await expect(
      namesOf({ sido: '서울특별시', sigungu: '마포구' }),
    ).resolves.toEqual(['이서울']);
  });

  it('should filter by sigungu alone when no sido was chosen', async () => {
    // 시/도를 안 고르고 시/군/구만 골랐을 때 안 거르면 사용자는 필터가 먹은
    // 줄 알고 엉뚱한 목록을 본다 (#13이 정한 규칙).
    await expect(namesOf({ sigungu: '해운대구' })).resolves.toEqual(['박부산']);
  });

  it('should exclude a member who has no address at all when a region is chosen', async () => {
    await expect(namesOf({ sido: '부산광역시' })).resolves.toEqual(['박부산']);
  });

  it('should apply the search word and the region together as AND', async () => {
    await expect(
      namesOf({ q: '서울', sido: '서울특별시', sigungu: '강남구' }),
    ).resolves.toEqual(['김서울']);
  });

  it('should return only deactivated members when the status filter is DEACTIVATED', async () => {
    await expect(namesOf({ status: 'DEACTIVATED' })).resolves.toEqual([
      '정탈퇴',
    ]);
  });

  it('should return every member when neither a search word nor a region is given', async () => {
    await expect(namesOf()).resolves.toHaveLength(6);
  });

  it('should return an empty page instead of failing when the page is past the end', async () => {
    const list = await service.list({ page: 9 });

    expect(list.items).toEqual([]);
    expect(list.total).toBe(6);
  });

  it('should count only the penalties inside the 180-day window', async () => {
    const list = await service.list({ q: '김서', page: 1 });

    // 경고는 둘인데 창 안은 하나다. 창 밖까지 세면 #33 블랙리스트의
    // "누적 경고"와 같은 회원의 숫자가 어긋난다.
    expect(list.items[0]?.penaltyCount).toBe(1);
  });

  it('should not treat an expired or released suspension as SUSPENDED', async () => {
    const list = await service.list({ page: 1 });
    const byName = new Map(list.items.map((item) => [item.name, item.status]));

    expect(byName.get('김서울')).toBe('ACTIVE');
    expect(byName.get('한제재')).toBe('SUSPENDED');
  });

  it('should filter by name, email and region against the real database', async () => {
    // 검색어는 이름·이메일 **어느 쪽이든** 걸리면서, 지역과는 AND로 겹친다.
    await expect(namesOf({ q: 'seoul@', sido: '서울특별시' })).resolves.toEqual(
      ['김서울'],
    );
    await expect(namesOf({ q: 'seoul@', sido: '부산광역시' })).resolves.toEqual(
      [],
    );
  });
});

describe('AdminMemberService.detail (real database)', () => {
  it('should return both role averages with their sample counts', async () => {
    const detail = await service.detail(richId);

    expect(detail.asPoster).toEqual({ average: 4.5, count: 4 });
    expect(detail.asWorker).toEqual({ average: 3.5, count: 6 });
  });

  it('should return every rating received with the rater name, the job post title and the date', async () => {
    const detail = await service.detail(richId);

    expect(detail.reviews).toHaveLength(1);
    expect(detail.reviews[0]).toMatchObject({
      score: 5,
      rateeRole: 'WORKER',
      raterName: '박부산',
      jobPostTitle: '카페 마감 청소',
    });
  });

  it('should return the job posts the member registered and the applications they made', async () => {
    const detail = await service.detail(richId);

    expect(detail.jobPosts.map((post) => post.title)).toEqual([
      '이사 짐 나르기',
    ]);
    expect(detail.applications.map((app) => app.jobPostTitle)).toEqual([
      '카페 마감 청소',
    ]);
  });

  it('should return the ledger entries and a balance summed from the ledger', async () => {
    const detail = await service.detail(richId);

    expect(detail.ledger.map((entry) => entry.amount).sort()).toEqual([
      -20_000, 50_000,
    ]);
    // **캐시가 아니라 원장 합이다** (ADR-PAY-1). cachedBalance는 0인 채다.
    expect(detail.pointBalance).toBe(30_000);
  });

  it('should return penalties with their reason and job post and the suspension history', async () => {
    const detail = await service.detail(richId);

    // 상세의 경고 이력은 창으로 자르지 않는다 — 분쟁 대응 근거다 (§11.3).
    expect(detail.penalties.map((penalty) => penalty.reason).sort()).toEqual([
      'LATE_CANCEL',
      'NO_SHOW',
    ]);
    expect(
      detail.penalties.find((penalty) => penalty.reason === 'NO_SHOW')
        ?.jobPostId,
    ).not.toBeNull();
    // 만료된 것과 해제된 것 둘 다 이력으로 남는다.
    expect(detail.suspensions).toHaveLength(2);
  });

  it('should gather ratings, job posts, applications, ledger and penalties for one member', async () => {
    // **한 번에 준다.** 덩이마다 라우트를 두면 상세 한 화면에 여섯 번을 부른다.
    const detail = await service.detail(richId);

    expect(detail.reviews.length).toBeGreaterThan(0);
    expect(detail.jobPosts.length).toBeGreaterThan(0);
    expect(detail.applications.length).toBeGreaterThan(0);
    expect(detail.ledger.length).toBeGreaterThan(0);
    expect(detail.penalties.length).toBeGreaterThan(0);
    expect(detail.suspensions.length).toBeGreaterThan(0);
  });
});
