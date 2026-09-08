import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { ApplicationService } from '../application/application.service';
import {
  PrismaApplicantProfileReader,
  PrismaApplicationStore,
  PrismaJobPostReader,
} from '../application/prisma-application.store';
import type { PublishNotificationInput } from '../notification/notification.service';
import type { PrismaService } from '../prisma/prisma.service';
import { recordPenalty } from './penalty-transaction';
import { PrismaSuspensionReader } from './suspension.reader';

/**
 * **180일 창과 5건 임계는 진짜 DB에서만 증명된다.** (이슈 #25)
 *
 * 가짜 저장소로는 "창 밖 경고를 안 센다"를 흉내 내는 순간 그 흉내 자체를
 * 검증하게 된다. 여기서는 `Penalty` 행을 실제 시각으로 심고, 판정이 그
 * 행들을 어떻게 세는지를 본다.
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let service: ApplicationService;
let suspensions: PrismaSuspensionReader;
/** 제재 발생 알림이 실제로 나갔는지 본다 (§5) */
let published: PublishNotificationInput[];

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-08T00:00:00.000Z');

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  published = [];
  suspensions = new PrismaSuspensionReader(prisma as unknown as PrismaService);
  service = new ApplicationService(
    new PrismaApplicationStore(prisma as unknown as PrismaService),
    new PrismaJobPostReader(prisma as unknown as PrismaService),
    new PrismaApplicantProfileReader(prisma as unknown as PrismaService),
    {
      publish: (input) => {
        published.push(input);
        return Promise.resolve();
      },
    },
    suspensions,
  );
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  published.length = 0;
  await prisma.notification.deleteMany();
  await prisma.application.deleteMany();
  await prisma.suspension.deleteMany();
  await prisma.penalty.deleteMany();
  await prisma.jobPost.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
});

async function seedUser(email: string): Promise<string> {
  const row = await prisma.user.create({
    data: { email, passwordHash: 'h', name: email },
  });
  return row.id;
}

/** 그 사람에게 경고를 `count`건 심는다. `daysAgo` 전에 생긴 것으로 친다 */
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
        occurredAt: new Date(NOW.getTime() - daysAgo * DAY_MS),
      },
    });
  }
}

/** 경고 1건을 쓰고 판정까지 한 번에. 진짜 트랜잭션 안에서 돈다 */
function penalize(userId: string, now: Date = NOW) {
  return prisma.$transaction((tx) =>
    recordPenalty(tx, { userId, reason: 'NO_SHOW', jobPostId: null, now }),
  );
}

describe('recordPenalty', () => {
  it('should create a suspension ending 5 days later when the 5th penalty inside the window is recorded', async () => {
    const userId = await seedUser('four@example.com');
    await seedPenalties(userId, 4, 10);

    const suspension = await penalize(userId);

    expect(suspension?.endAt.toISOString()).toBe(
      new Date(NOW.getTime() + 5 * DAY_MS).toISOString(),
    );
  });

  // AC2. 190일 전 3건은 창 밖이라 이번 것까지 세도 3건뿐이다.
  it('should not create a suspension when only 2 of the 5 penalties are inside the window', async () => {
    const userId = await seedUser('old@example.com');
    await seedPenalties(userId, 3, 190);
    await seedPenalties(userId, 1, 10);

    const suspension = await penalize(userId);

    expect(suspension).toBeNull();
    expect(await prisma.suspension.count()).toBe(0);
  });

  // 창의 끝값. "최근 180일 내"는 정확히 180일 전까지 포함한다.
  it('should count a penalty that occurred exactly at the window start', async () => {
    const userId = await seedUser('edge-in@example.com');
    await seedPenalties(userId, 4, 180);

    const suspension = await penalize(userId);

    expect(suspension).not.toBeNull();
  });

  it('should ignore a penalty that occurred one millisecond before the window start', async () => {
    const userId = await seedUser('edge-out@example.com');
    await seedPenalties(userId, 3, 10);
    await prisma.penalty.create({
      data: {
        userId,
        reason: 'NO_SHOW',
        occurredAt: new Date(NOW.getTime() - 180 * DAY_MS - 1),
      },
    });

    const suspension = await penalize(userId);

    expect(suspension).toBeNull();
  });

  /**
   * 6번째 경고가 제재를 하나 더 만들면 **제재가 겹쳐 5일이 10일이 된다.**
   * 규칙은 5건 → 5일 하나뿐이다 (PRD Out of Scope: 단계별 차등 없음).
   */
  it('should not create a second suspension when a 6th penalty arrives while one is active', async () => {
    const userId = await seedUser('again@example.com');
    await seedPenalties(userId, 4, 10);
    await penalize(userId);

    const second = await penalize(userId, new Date(NOW.getTime() + DAY_MS));

    expect(second).toBeNull();
    expect(await prisma.suspension.count()).toBe(1);
  });
});

describe('findActive', () => {
  it('should ignore a suspension whose end time has passed', async () => {
    const userId = await seedUser('ended@example.com');
    await prisma.suspension.create({
      data: {
        userId,
        startAt: new Date(NOW.getTime() - 10 * DAY_MS),
        endAt: new Date(NOW.getTime() - 5 * DAY_MS),
      },
    });

    expect(await suspensions.findActive(userId, NOW)).toBeNull();
  });

  // §5.1. 관리자가 풀어 준 제재는 남은 기간과 무관하게 끝난 것이다 (#33).
  it('should ignore a suspension that was released early', async () => {
    const userId = await seedUser('released@example.com');
    await prisma.suspension.create({
      data: {
        userId,
        startAt: new Date(NOW.getTime() - DAY_MS),
        endAt: new Date(NOW.getTime() + 4 * DAY_MS),
        releasedAt: new Date(NOW.getTime() - 1 * DAY_MS),
        releasedBy: 'usr_admin',
        releaseReason: '이의 인정',
      },
    });

    expect(await suspensions.findActive(userId, NOW)).toBeNull();
  });
});

/** 경고를 쌓는 두 경로가 실제로 판정까지 이어지는지 (#20 · #24 → #25) */
describe('경고가 쌓이는 경로', () => {
  it('should notify the member with SUSPENSION_STARTED when the 5th penalty suspends them', async () => {
    const employerId = await seedUser('boss@example.com');
    const applicantId = await seedUser('noshow@example.com');
    await seedPenalties(applicantId, 4, 10);
    const applicationId = await seedAccepted(employerId, applicantId);

    await service.markNoShow({ employerId, applicationId });

    expect(published.map((n) => n.type)).toContain('SUSPENSION_STARTED');
  });

  it('should suspend the applicant when a late cancel makes their 5th penalty', async () => {
    const employerId = await seedUser('boss2@example.com');
    const applicantId = await seedUser('late@example.com');
    await seedPenalties(applicantId, 4, 10);
    // 수락 +2시간을 넘긴 취소만 경고다 (#20).
    const applicationId = await seedAccepted(
      employerId,
      applicantId,
      new Date(Date.now() - 3 * 60 * 60 * 1000),
    );

    await service.cancel({ actorId: applicantId, applicationId });

    expect(await prisma.suspension.count()).toBe(1);
  });

  // §5.1. 풀어 준 사람은 다시 지원할 수 있어야 한다.
  it("should accept the application when the member's suspension was released early", async () => {
    const employerId = await seedUser('boss3@example.com');
    const applicantId = await seedUser('freed@example.com');
    const jobPostId = await seedOpenPost(employerId);
    await prisma.suspension.create({
      data: {
        userId: applicantId,
        endAt: new Date(Date.now() + 5 * DAY_MS),
        releasedAt: new Date(),
        releasedBy: 'usr_admin',
        releaseReason: '이의 인정',
      },
    });

    const result = await service.apply({ applicantId, jobPostId });

    expect(result.status).toBe('APPLIED');
  });
});

/** 모집 중인 공고 하나 */
async function seedOpenPost(employerId: string): Promise<string> {
  const category = await prisma.category.create({
    data: {
      name: '청소',
      slug: `cleaning-${Date.now()}-${Math.random()}`,
      sortOrder: 1,
      placeholderText: '어떤 청소인지 적어 주세요.',
    },
  });
  const post = await prisma.jobPost.create({
    data: {
      employerId,
      categoryId: category.id,
      title: '사무실 청소',
      status: 'OPEN',
      version: 1,
      workAddress: '서울 강남구 테헤란로 1',
      workSido: '서울',
      workSigungu: '강남구',
      // 이미 시작된 근무. 노쇼를 표시할 수 있어야 한다 (#24 AC3).
      workStartAt: new Date(Date.now() - 60 * 60 * 1000),
      workEndAt: new Date(Date.now() + 60 * 60 * 1000),
      headcount: 3,
      acceptedCount: 1,
      rewardPerPerson: 50_000,
      requiredDescription: '30평 사무실 바닥과 창문을 닦습니다.',
    },
  });
  return post.id;
}

/** 수락된 신청 하나 */
async function seedAccepted(
  employerId: string,
  applicantId: string,
  acceptedAt: Date = new Date(),
): Promise<string> {
  const jobPostId = await seedOpenPost(employerId);
  const row = await prisma.application.create({
    data: {
      jobPostId,
      applicantId,
      status: 'ACCEPTED',
      appliedVersion: 1,
      acceptedAt,
    },
  });
  return row.id;
}
