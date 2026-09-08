import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { UNDERFILL_NOTICE_LEAD_MS } from '@fixer/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { PostgresJobLock } from '../retention/prisma-purge.store';
import { JobPostScheduleService } from './job-post-schedule.service';
import { NotificationService } from './notification.service';
import { PrismaJobPostScheduleStore } from './prisma-job-post-schedule.store';
import { PrismaNotificationStore } from './prisma-notification.store';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * **이 이슈에는 화면이 없다. 이 파일이 데모다.** (이슈 #38)
 *
 * 가짜 저장소로는 증명할 수 없는 것이 셋이다.
 *
 * 1. **조건절이 진짜로 그것만 고르는지** — 시간 창·인원 비교·멱등 플래그가
 *    한 쿼리에 함께 들어간다. 가짜는 그 조건을 TypeScript로 다시 쓴 것이라
 *    SQL이 틀려도 초록불이 켜진다.
 * 2. **표시가 원자적인지** — 두 실행이 같은 행을 놓고 다툴 때 하나만 이겨야
 *    한다 (`spec-fixed.md` §8.2 1차 방어).
 * 3. **advisory lock이 진짜 분산락인지** — 다른 연결이 정말 못 잡는지 (AC4).
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let store: PrismaJobPostScheduleStore;
let service: JobPostScheduleService;

const LEAD = UNDERFILL_NOTICE_LEAD_MS;
const SECOND = 1000;
const NOTIFY_KEY = 3801;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  store = new PrismaJobPostScheduleStore(prisma as unknown as PrismaService);
  service = new JobPostScheduleService(
    store,
    // 진짜 알림 저장소를 쓴다. 알림이 실제로 행으로 남는지가 AC1이다.
    new NotificationService(
      new PrismaNotificationStore(prisma as unknown as PrismaService),
    ),
    new PostgresJobLock(prisma as unknown as PrismaService),
  );
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  await prisma.notification.deleteMany();
  await prisma.jobPost.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
});

async function seedEmployer(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: 'boss@example.com', passwordHash: 'h', name: '구인자' },
  });
  return user.id;
}

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

/** 공고 하나. 상태·인원·시작 시각만 바꿔 가며 쓴다 */
async function seedJobPost(input: {
  employerId: string;
  categoryId: string;
  title: string;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  headcount: number;
  acceptedCount: number;
  workStartAt: Date;
  underfilledNotifiedAt?: Date | null;
}): Promise<string> {
  const post = await prisma.jobPost.create({
    data: {
      employerId: input.employerId,
      categoryId: input.categoryId,
      title: input.title,
      status: input.status,
      workAddress: '서울 강남구 테헤란로 1',
      workSido: '서울',
      workSigungu: '강남구',
      workStartAt: input.workStartAt,
      workEndAt: new Date(input.workStartAt.getTime() + 4 * 60 * 60 * 1000),
      headcount: input.headcount,
      acceptedCount: input.acceptedCount,
      rewardPerPerson: 50_000,
      requiredDescription: '복장 자유',
      underfilledNotifiedAt: input.underfilledNotifiedAt ?? null,
    },
  });
  return post.id;
}

describe('PrismaJobPostScheduleStore.findUnderfilled', () => {
  it('should return only the OPEN, under-filled, unnotified posts inside the window from the real database', async () => {
    const now = new Date();
    const employerId = await seedEmployer();
    const categoryId = await seedCategory();
    const base = {
      employerId,
      categoryId,
      headcount: 3,
      acceptedCount: 1,
      status: 'OPEN' as const,
    };
    const target = await seedJobPost({
      ...base,
      title: '대상',
      workStartAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    await seedJobPost({
      ...base,
      title: '아직 멀었다',
      workStartAt: new Date(now.getTime() + LEAD + 60 * 60 * 1000),
    });
    await seedJobPost({
      ...base,
      title: '정원이 찼다',
      acceptedCount: 3,
      workStartAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    await seedJobPost({
      ...base,
      title: '이미 알렸다',
      workStartAt: new Date(now.getTime() + 60 * 60 * 1000),
      underfilledNotifiedAt: now,
    });
    await seedJobPost({
      ...base,
      title: '취소됐다',
      status: 'CANCELLED',
      workStartAt: new Date(now.getTime() + 60 * 60 * 1000),
    });

    const found = await store.findUnderfilled(
      now,
      new Date(now.getTime() + LEAD),
    );

    expect(found.map((p) => p.id)).toEqual([target]);
  });
});

describe('PrismaJobPostScheduleStore.close', () => {
  it('should write CLOSED and EXPIRED to the real database', async () => {
    const now = new Date();
    const employerId = await seedEmployer();
    const categoryId = await seedCategory();
    const base = {
      employerId,
      categoryId,
      status: 'OPEN' as const,
      workStartAt: new Date(now.getTime() - SECOND),
    };
    const filled = await seedJobPost({
      ...base,
      title: '정원이 찼다',
      headcount: 2,
      acceptedCount: 2,
    });
    const underfilled = await seedJobPost({
      ...base,
      title: '미달이다',
      headcount: 2,
      acceptedCount: 1,
    });

    await service.closeStarted(now, 3802);

    const rows = await prisma.jobPost.findMany({
      where: { id: { in: [filled, underfilled] } },
      select: { id: true, status: true },
    });
    expect(rows.find((r) => r.id === filled)?.status).toBe('CLOSED');
    expect(rows.find((r) => r.id === underfilled)?.status).toBe('EXPIRED');
  });
});

describe('PrismaJobPostScheduleStore.markNotified', () => {
  it('should hand the post to only one of two runs', async () => {
    const now = new Date();
    const employerId = await seedEmployer();
    const categoryId = await seedCategory();
    const jobPostId = await seedJobPost({
      employerId,
      categoryId,
      title: '미달이다',
      status: 'OPEN',
      headcount: 3,
      acceptedCount: 1,
      workStartAt: new Date(now.getTime() + 60 * 60 * 1000),
    });

    const [first, second] = await Promise.all([
      store.markNotified(jobPostId, now),
      store.markNotified(jobPostId, now),
    ]);

    // 둘 다 true면 알림이 두 번 나간다 (AC2).
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });
});

describe('PostgresJobLock', () => {
  it('should refuse the second runner while the first holds the job key', async () => {
    // 다른 연결이어야 진짜 검증이다. 같은 세션은 재진입이 허용된다.
    const other = new PrismaClient({
      adapter: new PrismaPg({ connectionString: container.getConnectionUri() }),
    });
    const otherLock = new PostgresJobLock(other as unknown as PrismaService);
    const now = new Date();
    const employerId = await seedEmployer();
    const categoryId = await seedCategory();
    const jobPostId = await seedJobPost({
      employerId,
      categoryId,
      title: '미달이다',
      status: 'OPEN',
      headcount: 3,
      acceptedCount: 1,
      workStartAt: new Date(now.getTime() + 60 * 60 * 1000),
    });

    try {
      await otherLock.tryLock(NOTIFY_KEY);

      const report = await service.notifyUnderfilled(now, LEAD, NOTIFY_KEY);

      expect(report.skippedByLock).toBe(true);
      const untouched = await prisma.jobPost.findUniqueOrThrow({
        where: { id: jobPostId },
      });
      expect(untouched.underfilledNotifiedAt).toBeNull();
      expect(await prisma.notification.count()).toBe(0);
    } finally {
      await otherLock.unlock(NOTIFY_KEY);
      await other.$disconnect();
    }
  });
});
