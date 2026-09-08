import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaApplicantProfileReader } from '../application/prisma-application.store';
import type { PrismaService } from '../prisma/prisma.service';
import { PrismaRatingStore } from './prisma-rating.store';

/**
 * **평점 캐시와 거래당 1회는 진짜 DB에서만 증명된다.** (이슈 #26)
 *
 * 가짜 저장소로는 "유니크 제약이 두 번째를 막는다"를 흉내 내는 순간 그
 * 흉내 자체를 검증하게 된다. 여기서는 `Rating` 행을 실제로 넣고, `User`의
 * 평균 컬럼이 어떻게 바뀌는지를 본다.
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let store: PrismaRatingStore;
let profiles: PrismaApplicantProfileReader;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  store = new PrismaRatingStore(prisma as unknown as PrismaService);
  profiles = new PrismaApplicantProfileReader(
    prisma as unknown as PrismaService,
  );
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  await prisma.rating.deleteMany();
  await prisma.application.deleteMany();
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

/** 완료된 거래 한 건. 구인자와 구직자가 함께 생긴다 */
async function seedCompletedApplication(): Promise<{
  applicationId: string;
  employerId: string;
  applicantId: string;
}> {
  const employerId = await seedUser(`employer-${Date.now()}@example.com`);
  const applicantId = await seedUser(`worker-${Date.now()}@example.com`);
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
      status: 'COMPLETED',
      version: 1,
      workAddress: '서울 강남구 테헤란로 1',
      workSido: '서울',
      workSigungu: '강남구',
      workStartAt: new Date('2026-10-01T09:00:00.000Z'),
      workEndAt: new Date('2026-10-01T18:00:00.000Z'),
      headcount: 3,
      acceptedCount: 1,
      rewardPerPerson: 50_000,
      requiredDescription: '30평 사무실 바닥과 창문을 닦습니다.',
    },
  });
  const application = await prisma.application.create({
    data: {
      jobPostId: post.id,
      applicantId,
      status: 'COMPLETED',
      appliedVersion: 1,
    },
  });
  return { applicationId: application.id, employerId, applicantId };
}

describe('create', () => {
  it("should write the average and the count into the rated member's worker cache", async () => {
    const { applicationId, employerId, applicantId } =
      await seedCompletedApplication();

    await store.create({
      applicationId,
      raterId: employerId,
      rateeId: applicantId,
      rateeRole: 'WORKER',
      score: 4,
    });

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: applicantId },
    });
    expect(row.ratingAsWorker).toBe(4);
    expect(row.ratingAsWorkerCount).toBe(1);
  });

  // 역할별로 나뉜다 (§2.1). 구직자로 받은 별점이 구인자 평점을 건드리면 안 된다.
  it('should leave the poster cache untouched when the rating was left for the worker', async () => {
    const { applicationId, employerId, applicantId } =
      await seedCompletedApplication();

    await store.create({
      applicationId,
      raterId: employerId,
      rateeId: applicantId,
      rateeRole: 'WORKER',
      score: 4,
    });

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: applicantId },
    });
    expect(row.ratingAsPoster).toBeNull();
    expect(row.ratingAsPosterCount).toBe(0);
  });

  /**
   * 증분이 아니라 재집계다 (`ADR-PEN-3`). 두 번째 별점이 들어오면 평균은
   * 그 사람의 그 역할 별점 **전부**를 다시 센 값이어야 한다.
   */
  it('should recompute the average over every rating the member received in that role', async () => {
    const first = await seedCompletedApplication();
    await store.create({
      applicationId: first.applicationId,
      raterId: first.employerId,
      rateeId: first.applicantId,
      rateeRole: 'WORKER',
      score: 5,
    });

    const second = await seedCompletedApplication();
    await prisma.rating.create({
      data: {
        applicationId: second.applicationId,
        raterId: second.employerId,
        rateeId: first.applicantId,
        rateeRole: 'WORKER',
        score: 2,
      },
    });
    await store.create({
      applicationId: second.applicationId,
      raterId: second.applicantId,
      rateeId: first.applicantId,
      rateeRole: 'WORKER',
      score: 2,
    });

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: first.applicantId },
    });
    expect(row.ratingAsWorkerCount).toBe(3);
    expect(row.ratingAsWorker).toBe(3);
  });

  // 유니크는 `(applicationId, raterId)`다. 양방향 입력이 §7의 요구다.
  it("should accept the counterpart's rating on the same transaction", async () => {
    const { applicationId, employerId, applicantId } =
      await seedCompletedApplication();
    await store.create({
      applicationId,
      raterId: employerId,
      rateeId: applicantId,
      rateeRole: 'WORKER',
      score: 4,
    });

    const result = await store.create({
      applicationId,
      raterId: applicantId,
      rateeId: employerId,
      rateeRole: 'POSTER',
      score: 5,
    });

    expect(result).not.toBe('DUPLICATE');
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: employerId },
    });
    expect(row.ratingAsPoster).toBe(5);
  });

  it('should report DUPLICATE when the same rater rates the same transaction twice', async () => {
    const { applicationId, employerId, applicantId } =
      await seedCompletedApplication();
    await store.create({
      applicationId,
      raterId: employerId,
      rateeId: applicantId,
      rateeRole: 'WORKER',
      score: 4,
    });

    const second = await store.create({
      applicationId,
      raterId: employerId,
      rateeId: applicantId,
      rateeRole: 'WORKER',
      score: 1,
    });

    expect(second).toBe('DUPLICATE');
    expect(await prisma.rating.count()).toBe(1);
  });
});

describe('profilesOf', () => {
  /**
   * #18이 남겨 둔 임시 구현체를 걷어냈는지 본다. 안 채우면 지원자 목록이
   * 별점을 아무리 받아도 전원 "신규"로 보인다.
   */
  it("should report the applicant's cached worker rating instead of an empty sample", async () => {
    const { applicationId, employerId, applicantId } =
      await seedCompletedApplication();
    await store.create({
      applicationId,
      raterId: employerId,
      rateeId: applicantId,
      rateeRole: 'WORKER',
      score: 3,
    });

    const found = await profiles.profilesOf([applicantId]);

    expect(found.get(applicantId)?.ratingAsWorker).toBe(3);
    expect(found.get(applicantId)?.ratingCount).toBe(1);
  });
});
