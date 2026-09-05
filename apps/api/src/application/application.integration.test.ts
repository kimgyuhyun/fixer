import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { APPLICATION_ERRORS } from '@fixer/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { ApplicationService } from './application.service';
import {
  PrismaApplicationStore,
  PrismaJobPostReader,
} from './prisma-application.store';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * **경합은 진짜 DB에서만 증명된다.** (이슈 #17)
 *
 * 가짜 저장소는 한 스레드에서 순서대로 실행하므로 유니크 제약이 없어도
 * 통과한다. 지원 버튼을 두 번 눌렀을 때 행이 하나만 생기는지는 Postgres만
 * 안다. AC4의 "경고가 쌓이지 않는다"도 Penalty 테이블을 직접 세어야 한다.
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let service: ApplicationService;
/** 서비스를 거치지 않고 제약 자체를 확인할 때 쓴다 */
let store: PrismaApplicationStore;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  store = new PrismaApplicationStore(prisma as unknown as PrismaService);
  service = new ApplicationService(
    store,
    new PrismaJobPostReader(prisma as unknown as PrismaService),
  );
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  await prisma.application.deleteMany();
  await prisma.penalty.deleteMany();
  await prisma.jobPostVersion.deleteMany();
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

/** 모집 중인 공고 하나. 예산 잠금은 #12가 하는 일이라 여기선 안 만든다 */
async function seedOpenPost(employerId: string, version = 1): Promise<string> {
  const category = await prisma.category.create({
    data: {
      name: '청소',
      slug: `cleaning-${Date.now()}`,
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
      version,
      workAddress: '서울 강남구 테헤란로 1',
      workSido: '서울',
      workSigungu: '강남구',
      workStartAt: new Date('2026-10-01T09:00:00.000Z'),
      workEndAt: new Date('2026-10-01T18:00:00.000Z'),
      headcount: 3,
      rewardPerPerson: 50_000,
      requiredDescription: '30평 사무실 바닥과 창문을 닦습니다.',
    },
  });
  return post.id;
}

function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? String(error);
}

describe('apply', () => {
  it('should create an APPLIED application when a job seeker applies to an OPEN job post', async () => {
    const employerId = await seedUser('boss@example.com');
    const applicantId = await seedUser('seeker@example.com');
    const jobPostId = await seedOpenPost(employerId);

    await service.apply({ applicantId, jobPostId });

    const rows = await prisma.application.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('APPLIED');
  });

  it("should store the job post's current version in appliedVersion", async () => {
    const employerId = await seedUser('boss@example.com');
    const applicantId = await seedUser('seeker@example.com');
    const jobPostId = await seedOpenPost(employerId, 3);

    const result = await service.apply({ applicantId, jobPostId });

    expect(result.appliedVersion).toBe(3);
  });

  /**
   * 결과는 맞지만 **이 테스트만으로는 부족하다.**
   *
   * 두 요청이 실제로는 순차 실행되어, 두 번째가 유니크 제약이 아니라
   * 서비스의 사전 조회에서 막힐 수 있다. 그러면 사전 조회를 지워도 이
   * 테스트는 통과한다 — 아래 `ApplicationStore.create` 테스트가 제약
   * 자체를 직접 지나간다.
   */
  it('should let exactly one of two concurrent applies succeed and reject the other with APPLICATION_ALREADY_APPLIED', async () => {
    const employerId = await seedUser('boss@example.com');
    const applicantId = await seedUser('seeker@example.com');
    const jobPostId = await seedOpenPost(employerId);

    const results = await Promise.allSettled([
      service.apply({ applicantId, jobPostId }),
      service.apply({ applicantId, jobPostId }),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(codeOf(failed[0].reason)).toBe(APPLICATION_ERRORS.ALREADY_APPLIED);
    expect(await prisma.application.count()).toBe(1);
  });

  it('should refresh appliedVersion to the current version when re-applying after the job post was edited', async () => {
    const employerId = await seedUser('boss@example.com');
    const applicantId = await seedUser('seeker@example.com');
    const jobPostId = await seedOpenPost(employerId, 1);

    const applied = await service.apply({ applicantId, jobPostId });
    await service.withdraw({ applicantId, applicationId: applied.id });
    // 그 사이 구인자가 필수항목을 고쳤다 (#15)
    await prisma.jobPost.update({
      where: { id: jobPostId },
      data: { version: 4 },
    });

    const again = await service.apply({ applicantId, jobPostId });

    expect(again.appliedVersion).toBe(4);
    // 새 행이 아니라 되살린 것이다 (§4.5의 유니크 제약)
    expect(await prisma.application.count()).toBe(1);
  });

  it('should let exactly one of two concurrent re-applies succeed and reject the other with APPLICATION_ALREADY_APPLIED', async () => {
    const employerId = await seedUser('boss@example.com');
    const applicantId = await seedUser('seeker@example.com');
    const jobPostId = await seedOpenPost(employerId);

    const applied = await service.apply({ applicantId, jobPostId });
    await service.withdraw({ applicantId, applicationId: applied.id });

    const results = await Promise.allSettled([
      service.apply({ applicantId, jobPostId }),
      service.apply({ applicantId, jobPostId }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.application.count()).toBe(1);
  });

  it('should throw JOB_POST_NOT_FOUND when the job post is soft-deleted', async () => {
    const employerId = await seedUser('boss@example.com');
    const applicantId = await seedUser('seeker@example.com');
    const jobPostId = await seedOpenPost(employerId);
    await prisma.jobPost.update({
      where: { id: jobPostId },
      data: { deletedAt: new Date() },
    });

    await expect(
      service.apply({ applicantId, jobPostId }),
    ).rejects.toMatchObject({ code: 'JOB_POST_NOT_FOUND' });
  });
});

describe('withdraw', () => {
  it('should move the application from APPLIED to WITHDRAWN', async () => {
    const employerId = await seedUser('boss@example.com');
    const applicantId = await seedUser('seeker@example.com');
    const jobPostId = await seedOpenPost(employerId);
    const applied = await service.apply({ applicantId, jobPostId });

    await service.withdraw({ applicantId, applicationId: applied.id });

    const row = await prisma.application.findUnique({
      where: { id: applied.id },
    });
    expect(row?.status).toBe('WITHDRAWN');
  });

  /**
   * AC4. 수락 전 철회는 아무 잘못이 아니다.
   *
   * 신청 모듈에 penalty 포트를 두지 않은 것이 구조적 보장이지만, 나중에
   * 누가 배선하면 조용히 깨진다. 그래서 테이블을 직접 센다.
   */
  it('should create no Penalty row when an APPLIED application is withdrawn', async () => {
    const employerId = await seedUser('boss@example.com');
    const applicantId = await seedUser('seeker@example.com');
    const jobPostId = await seedOpenPost(employerId);
    const applied = await service.apply({ applicantId, jobPostId });

    await service.withdraw({ applicantId, applicationId: applied.id });

    expect(await prisma.penalty.count()).toBe(0);
  });

  it('should let exactly one of two concurrent withdrawals succeed and reject the other with APPLICATION_INVALID_TRANSITION', async () => {
    const employerId = await seedUser('boss@example.com');
    const applicantId = await seedUser('seeker@example.com');
    const jobPostId = await seedOpenPost(employerId);
    const applied = await service.apply({ applicantId, jobPostId });

    const results = await Promise.allSettled([
      service.withdraw({ applicantId, applicationId: applied.id }),
      service.withdraw({ applicantId, applicationId: applied.id }),
    ]);

    const failed = results.filter((r) => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(codeOf(failed[0].reason)).toBe(
      APPLICATION_ERRORS.INVALID_TRANSITION,
    );
  });
});

/**
 * **제약을 직접 지나간다.**
 *
 * 서비스를 거치면 사전 조회가 먼저 막아서 두 번째 INSERT가 DB까지 가지
 * 않는다. 경합에서 실제로 이기는 것이 유니크 제약이라는 사실은 저장소를
 * 직접 두 번 불러야 증명된다 (§4.5).
 */
describe('ApplicationStore.create', () => {
  it('should return DUPLICATE when the same applicant row already exists', async () => {
    const employerId = await seedUser('boss@example.com');
    const applicantId = await seedUser('seeker@example.com');
    const jobPostId = await seedOpenPost(employerId);

    const first = await store.create({
      jobPostId,
      applicantId,
      appliedVersion: 1,
    });
    const second = await store.create({
      jobPostId,
      applicantId,
      appliedVersion: 1,
    });

    expect(first).not.toBe('DUPLICATE');
    expect(second).toBe('DUPLICATE');
    expect(await prisma.application.count()).toBe(1);
  });
});
