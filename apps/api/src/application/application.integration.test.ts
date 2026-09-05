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
  PrismaApplicantProfileReader,
  PrismaApplicationStore,
  PrismaJobPostReader,
} from './prisma-application.store';
import { PrismaAcceptedCounter } from '../job-post/prisma-job-post.store';
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
/** #17이 0으로 막아 뒀던 확정 인원 카운터. #18이 컬럼을 읽게 바꾼다 */
let accepted: PrismaAcceptedCounter;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  store = new PrismaApplicationStore(prisma as unknown as PrismaService);
  accepted = new PrismaAcceptedCounter(prisma as unknown as PrismaService);
  service = new ApplicationService(
    store,
    new PrismaJobPostReader(prisma as unknown as PrismaService),
    new PrismaApplicantProfileReader(prisma as unknown as PrismaService),
  );
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  await prisma.application.deleteMany();
  await prisma.pointTransaction.deleteMany();
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
async function seedOpenPost(
  employerId: string,
  version = 1,
  seats: { headcount?: number; acceptedCount?: number } = {},
): Promise<string> {
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
      headcount: seats.headcount ?? 3,
      acceptedCount: seats.acceptedCount ?? 0,
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

/** 그 공고에 지원해 둔 신청 하나를 만든다 */
async function seedApplication(
  jobPostId: string,
  email: string,
): Promise<string> {
  const applicantId = await seedUser(email);
  const applied = await service.apply({ applicantId, jobPostId });
  return applied.id;
}

/**
 * **정원 초과는 진짜 DB에서만 증명된다.** (이슈 #18, `ADR-APP-1`)
 *
 * 가짜 저장소는 한 스레드에서 순서대로 실행하므로 조건부 UPDATE가 없어도
 * 통과한다. 정원이 1자리 남았을 때 수락 요청 두 개가 동시에 오면 하나만
 * 성공하는지는 Postgres의 행 잠금만 안다 (§4.4).
 */
describe('accept', () => {
  // 소프트 삭제된 공고는 못 찾은 것으로 다룬다 (#14). 가짜 리더가 null을
  // 돌려주는 것만으로는 `deletedAt` 필터가 실제로 걸리는지 알 수 없다.
  it('should throw JOB_POST_NOT_FOUND when the job post is soft-deleted', async () => {
    const employerId = await seedUser('boss@example.com');
    const jobPostId = await seedOpenPost(employerId, 1, { headcount: 3 });
    const applicationId = await seedApplication(jobPostId, 'a@example.com');
    await prisma.jobPost.update({
      where: { id: jobPostId },
      data: { deletedAt: new Date() },
    });

    await expect(
      service.accept({ employerId, applicationId }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.JOB_POST_NOT_FOUND });
  });

  it('should let exactly one of two concurrent accepts succeed when one seat is left', async () => {
    const employerId = await seedUser('boss@example.com');
    const jobPostId = await seedOpenPost(employerId, 1, {
      headcount: 3,
      acceptedCount: 2,
    });
    const first = await seedApplication(jobPostId, 'a@example.com');
    const second = await seedApplication(jobPostId, 'b@example.com');

    const results = await Promise.allSettled([
      service.accept({ employerId, applicationId: first }),
      service.accept({ employerId, applicationId: second }),
    ]);

    const won = results.filter((r) => r.status === 'fulfilled');
    expect(won).toHaveLength(1);
    expect(
      results
        .filter((r) => r.status === 'rejected')
        .map((r) => codeOf(r.reason)),
    ).toEqual([APPLICATION_ERRORS.HEADCOUNT_FULL]);
  });

  /**
   * **위 테스트만으로는 부족하다.**
   *
   * "성공 1건 · 실패 1건"인데 카운터가 4로 올라간 구현이 실제로 가능하다 —
   * 신청 갱신과 카운터 증가가 다른 트랜잭션이면 그렇게 된다. 정원이 넘으면
   * 잠긴 포인트보다 지급할 돈이 많아지므로, **숫자 자체를 봐야 한다.**
   */
  it('should leave acceptedCount equal to headcount after two concurrent accepts race for the last seat', async () => {
    const employerId = await seedUser('boss@example.com');
    const jobPostId = await seedOpenPost(employerId, 1, {
      headcount: 3,
      acceptedCount: 2,
    });
    const first = await seedApplication(jobPostId, 'a@example.com');
    const second = await seedApplication(jobPostId, 'b@example.com');

    await Promise.allSettled([
      service.accept({ employerId, applicationId: first }),
      service.accept({ employerId, applicationId: second }),
    ]);

    const post = await prisma.jobPost.findUniqueOrThrow({
      where: { id: jobPostId },
    });
    expect(post.acceptedCount).toBe(3);
  });

  // AC5. 수락 버튼 연타. 같은 신청을 두 요청이 동시에 노린다.
  it('should let exactly one of two concurrent accepts of the same application succeed', async () => {
    const employerId = await seedUser('boss@example.com');
    const jobPostId = await seedOpenPost(employerId, 1, { headcount: 3 });
    const applicationId = await seedApplication(jobPostId, 'a@example.com');

    const results = await Promise.allSettled([
      service.accept({ employerId, applicationId }),
      service.accept({ employerId, applicationId }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const post = await prisma.jobPost.findUniqueOrThrow({
      where: { id: jobPostId },
    });
    expect(post.acceptedCount).toBe(1);
  });

  /**
   * 카운터를 진실로 삼기로 한 결정이 치르는 값이다 (`ADR-APP-1`).
   *
   * 화면에 보이는 수와 정원을 막는 수가 갈리면 안 된다. 컬럼만 올리고
   * 상태를 안 바꾸는 구현은 이 테스트에서만 걸린다.
   */
  it('should equal the number of ACCEPTED rows after several accepts', async () => {
    const employerId = await seedUser('boss@example.com');
    const jobPostId = await seedOpenPost(employerId, 1, { headcount: 3 });
    const first = await seedApplication(jobPostId, 'a@example.com');
    const second = await seedApplication(jobPostId, 'b@example.com');

    await service.accept({ employerId, applicationId: first });
    await service.accept({ employerId, applicationId: second });

    const post = await prisma.jobPost.findUniqueOrThrow({
      where: { id: jobPostId },
    });
    const rows = await prisma.application.count({
      where: { jobPostId, status: 'ACCEPTED' },
    });
    expect(post.acceptedCount).toBe(rows);
  });
});

/**
 * **트랜잭션을 직접 지나간다.**
 *
 * 서비스를 거치면 사전 조회가 먼저 막아서 두 문장이 함께 실행되는 경로를
 * 못 본다. `$transaction`을 통째로 빼도 서비스 레벨 테스트는 전부 통과한다 —
 * 그 사실을 잡는 것이 아래 세 개다.
 */
describe('ApplicationStore.accept', () => {
  it('should return FULL when acceptedCount already equals headcount', async () => {
    const employerId = await seedUser('boss@example.com');
    const jobPostId = await seedOpenPost(employerId, 1, {
      headcount: 1,
      acceptedCount: 1,
    });
    const applicationId = await seedApplication(jobPostId, 'a@example.com');

    const result = await store.accept({
      applicationId,
      jobPostId,
      acceptedAt: new Date(),
    });

    expect(result).toBe('FULL');
  });

  it('should return STALE when the application is not APPLIED', async () => {
    const employerId = await seedUser('boss@example.com');
    const jobPostId = await seedOpenPost(employerId, 1, { headcount: 3 });
    const applicantId = await seedUser('a@example.com');
    const applied = await service.apply({ applicantId, jobPostId });
    await service.withdraw({ applicantId, applicationId: applied.id });

    const result = await store.accept({
      applicationId: applied.id,
      jobPostId,
      acceptedAt: new Date(),
    });

    expect(result).toBe('STALE');
  });

  /**
   * **롤백을 직접 증명한다.**
   *
   * 신청 갱신이 실패했는데 카운터만 올라가면, 아무도 안 쓴 자리로 정원이
   * 채워진다. 그 공고는 영영 사람을 못 채우고 구인자의 포인트는 잠긴 채 남는다.
   */
  it('should leave acceptedCount unchanged when it returns STALE', async () => {
    const employerId = await seedUser('boss@example.com');
    const jobPostId = await seedOpenPost(employerId, 1, { headcount: 3 });
    const applicantId = await seedUser('a@example.com');
    const applied = await service.apply({ applicantId, jobPostId });
    await service.withdraw({ applicantId, applicationId: applied.id });

    await store.accept({
      applicationId: applied.id,
      jobPostId,
      acceptedAt: new Date(),
    });

    const post = await prisma.jobPost.findUniqueOrThrow({
      where: { id: jobPostId },
    });
    expect(post.acceptedCount).toBe(0);
  });
});

/**
 * **목록 시나리오 3개가 전부 가짜 저장소만 지나갔다.**
 *
 * 가짜가 정렬하고 가짜가 걸러내므로, Prisma 쪽 `orderBy`를 지우거나 `where`의
 * 상태 필터를 지워도 서비스 레벨 테스트는 전부 통과한다. 그러면 철회한 사람이
 * 구인자의 지원자 목록에 그대로 뜨는데 아무 테스트도 안 깨진다.
 */
describe('ApplicationStore.listByJobPost', () => {
  it('should return rows ordered by createdAt ascending', async () => {
    const employerId = await seedUser('boss@example.com');
    const jobPostId = await seedOpenPost(employerId, 1, { headcount: 3 });
    const inserted = await seedApplication(jobPostId, 'a@example.com');
    const older = await seedApplication(jobPostId, 'b@example.com');
    // **나중에 넣은 행을 더 오래된 것으로 만든다.** 삽입 순서와 createdAt
    // 순서가 같으면 `orderBy`를 지워도 통과해서 아무것도 검사하지 못한다.
    await prisma.application.update({
      where: { id: older },
      data: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
    });

    const rows = await store.listByJobPost(jobPostId, ['APPLIED', 'ACCEPTED']);

    expect(rows.map((r) => r.id)).toEqual([older, inserted]);
  });

  it('should exclude statuses that were not asked for', async () => {
    const employerId = await seedUser('boss@example.com');
    const jobPostId = await seedOpenPost(employerId, 1, { headcount: 3 });
    const applicantId = await seedUser('a@example.com');
    const applied = await service.apply({ applicantId, jobPostId });
    await service.withdraw({ applicantId, applicationId: applied.id });

    const rows = await store.listByJobPost(jobPostId, ['APPLIED', 'ACCEPTED']);

    expect(rows).toEqual([]);
  });
});

/**
 * **어댑터가 이름을 진짜로 읽는지 확인한다.**
 *
 * 서비스 테스트는 가짜 프로필을 주므로, 이 어댑터가 User를 아예 안 읽어도
 * 전부 통과한다. 그러면 지원자 목록에 이름이 빈 채로 뜬다.
 *
 * 평점이 전원 "신규"인 것은 **지금 상태를 못 박아 두는 것**이다. `Rating`은
 * #26이 만든다 — 그때 이 테스트가 깨지면서 어댑터를 고칠 자리를 알려준다.
 */
describe('PrismaApplicantProfileReader', () => {
  it('should return every applicant as 신규 until #26 fills the rating aggregate', async () => {
    const employerId = await seedUser('boss@example.com');
    const jobPostId = await seedOpenPost(employerId, 1, { headcount: 3 });
    const applicantId = await seedUser('seeker@example.com');
    await service.apply({ applicantId, jobPostId });

    const profiles = await new PrismaApplicantProfileReader(
      prisma as unknown as PrismaService,
    ).profilesOf([applicantId]);

    expect(profiles.get(applicantId)).toEqual({
      name: 'seeker@example.com',
      ratingAsWorker: null,
      ratingCount: 0,
    });
  });
});

/**
 * #17이 `() => 0`으로 막아 뒀던 자리다.
 *
 * 교체를 안 해도 #18의 다른 테스트는 전부 통과한다 — 공고 상세가 수락 뒤에도
 * "0 / 6"인 채로 이슈가 닫히는 것을 이 테스트가 막는다.
 */
describe('PrismaAcceptedCounter', () => {
  it("should return the job post's acceptedCount column", async () => {
    const employerId = await seedUser('boss@example.com');
    const jobPostId = await seedOpenPost(employerId, 1, {
      headcount: 6,
      acceptedCount: 2,
    });

    expect(await accepted.countAccepted(jobPostId)).toBe(2);
  });
});
/**
 * 충전하고 공고 예산을 잠근 상태를 만든다 (#12가 하는 일).
 *
 * 완료 확인이 반환할 금액을 **원장에서** 구하므로, `HOLD` 행이 없으면
 * 반환액이 0이 되어 AC1을 검사할 수 없다.
 */
async function seedChargedAndHeld(
  employerId: string,
  jobPostId: string,
  budget: number,
): Promise<void> {
  await prisma.pointTransaction.create({
    data: {
      userId: employerId,
      type: 'CHARGE',
      amount: budget,
      idempotencyKey: `charge:${jobPostId}`,
    },
  });
  await prisma.pointTransaction.create({
    data: {
      userId: employerId,
      type: 'HOLD',
      amount: -budget,
      idempotencyKey: `hold:${jobPostId}:1`,
      referenceId: jobPostId,
    },
  });
  await prisma.user.update({
    where: { id: employerId },
    data: { cachedBalance: 0 },
  });
}

/** 그 사람의 원장 합계. **금전 판정의 진실은 여기다** (ADR-PAY-1) */
async function ledgerSum(userId: string): Promise<number> {
  const { _sum } = await prisma.pointTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  return _sum.amount ?? 0;
}

/** 확정 인원 `accepted`명인 공고 하나를 통째로 만든다 */
async function seedCompletable(seats: {
  headcount: number;
  accepted: number;
  rewardPerPerson?: number;
}): Promise<{
  employerId: string;
  jobPostId: string;
  workers: string[];
  applicationIds: string[];
}> {
  const rewardPerPerson = seats.rewardPerPerson ?? 10_000;
  const employerId = await seedUser('boss@example.com');
  const jobPostId = await seedOpenPost(employerId, 1, {
    headcount: seats.headcount,
  });
  await prisma.jobPost.update({
    where: { id: jobPostId },
    data: { rewardPerPerson },
  });
  await seedChargedAndHeld(
    employerId,
    jobPostId,
    seats.headcount * rewardPerPerson,
  );

  const workers: string[] = [];
  const applicationIds: string[] = [];
  for (let i = 0; i < seats.accepted; i += 1) {
    const applicantId = await seedUser(`seeker${i}@example.com`);
    const row = await service.apply({ applicantId, jobPostId });
    await service.accept({ employerId, applicationId: row.id });
    workers.push(applicantId);
    applicationIds.push(row.id);
  }

  return { employerId, jobPostId, workers, applicationIds };
}

describe('complete — 완료 확인 (#23)', () => {
  it("should increase each worker's balance by the reward per person", async () => {
    const { employerId, jobPostId, workers } = await seedCompletable({
      headcount: 6,
      accepted: 3,
    });

    await service.complete({ jobPostId, employerId });

    for (const worker of workers) {
      expect(await ledgerSum(worker)).toBe(10_000);
    }
  });

  it('should leave the worker balance unchanged before completion', async () => {
    const { employerId, jobPostId, workers } = await seedCompletable({
      headcount: 6,
      accepted: 3,
    });
    const worker = workers[0];

    // 수락만으로는 돈이 넘어가지 않는다.
    const before = await ledgerSum(worker);

    await service.complete({ jobPostId, employerId });

    // **전환을 본다.** 완료 전 잔액만 재면 `complete`를 부르지 않게 되어,
    // 구현이 없어도 통과하는 테스트가 된다.
    expect(before).toBe(0);
    expect(await ledgerSum(worker)).toBe(10_000);
  });

  it('should leave the employer holding only the released amount', async () => {
    const { employerId, jobPostId } = await seedCompletable({
      headcount: 6,
      accepted: 3,
    });

    await service.complete({ jobPostId, employerId });

    // 60,000 충전 → 60,000 잠금 → 3명분 지급, 3명분 반환.
    expect(await ledgerSum(employerId)).toBe(30_000);
  });

  it('should write nothing more when the same post is completed twice', async () => {
    const { employerId, jobPostId } = await seedCompletable({
      headcount: 6,
      accepted: 3,
    });

    await service.complete({ jobPostId, employerId });
    const after = await prisma.pointTransaction.count();

    // 이미 COMPLETED라 전이표에서 걸린다. 인자 없는 toThrow()는 어떤 에러든
    // 통과하므로, 막힌 이유까지 못 박는다.
    await expect(
      service.complete({ jobPostId, employerId }),
    ).rejects.toMatchObject({
      code: APPLICATION_ERRORS.JOB_POST_INVALID_TRANSITION,
    });

    expect(await prisma.pointTransaction.count()).toBe(after);
    expect(await ledgerSum(employerId)).toBe(30_000);
  });

  it('should let exactly one of two concurrent completions settle', async () => {
    const { employerId, jobPostId, workers } = await seedCompletable({
      headcount: 6,
      accepted: 3,
    });

    const results = await Promise.allSettled([
      service.complete({ jobPostId, employerId }),
      service.complete({ jobPostId, employerId }),
    ]);

    const settled = results.filter((r) => r.status === 'fulfilled');
    expect(settled).toHaveLength(1);
    // 두 번 지급됐다면 여기가 20,000이 된다.
    expect(await ledgerSum(workers[0])).toBe(10_000);
  });

  it('should keep the cached balance equal to the ledger sum for employer and workers', async () => {
    const { employerId, jobPostId, workers } = await seedCompletable({
      headcount: 6,
      accepted: 3,
    });

    await service.complete({ jobPostId, employerId });

    for (const userId of [employerId, ...workers]) {
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(row.cachedBalance).toBe(await ledgerSum(userId));
    }
  });

  /**
   * **가짜 저장소는 자기가 대입한 값을 되읽는다.** 진짜 UPDATE가 상태를
   * 정말 옮겼는지는 여기서만 알 수 있다. #18이 `acceptedCount`에 같은
   * 확인을 두고 있다.
   */
  it('should persist the job post as COMPLETED in the database', async () => {
    const { employerId, jobPostId } = await seedCompletable({
      headcount: 6,
      accepted: 3,
    });

    await service.complete({ jobPostId, employerId });

    const post = await prisma.jobPost.findUniqueOrThrow({
      where: { id: jobPostId },
    });
    expect(post.status).toBe('COMPLETED');
    // 신청도 함께 옮겨진다. 공고만 끝나고 신청이 ACCEPTED로 남으면
    // 그 사람들은 영원히 수락 상태가 된다.
    const stillAccepted = await prisma.application.count({
      where: { jobPostId, status: 'ACCEPTED' },
    });
    expect(stillAccepted).toBe(0);
  });

  it('should leave the job post OPEN when the payout writes fail', async () => {
    const { employerId, jobPostId, applicationIds } = await seedCompletable({
      headcount: 6,
      accepted: 3,
    });
    // 지급 행의 멱등 키를 미리 선점한다. 두 번째 지급이 유니크 제약에 걸린다.
    await prisma.pointTransaction.create({
      data: {
        userId: employerId,
        type: 'PAYOUT',
        amount: 1,
        idempotencyKey: `payout:${applicationIds[1]}`,
      },
    });

    // 멱등 키가 겹쳐 유니크 제약에 걸린다. 이 테스트가 증명하려는 것은
    // "쓰기가 실패했을 때 전부 되돌아간다"이므로, 실패 이유가 그 제약임을
    // 못 박아야 다른 이유로 죽는 경우와 구분된다.
    await expect(
      service.complete({ jobPostId, employerId }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // 한 트랜잭션이라면 공고도 신청도 그대로다 (ADR-PAY-4).
    const post = await prisma.jobPost.findUniqueOrThrow({
      where: { id: jobPostId },
    });
    expect(post.status).toBe('OPEN');
    const stillAccepted = await prisma.application.count({
      where: { jobPostId, status: 'ACCEPTED' },
    });
    expect(stillAccepted).toBe(3);
  });

  it('should throw JOB_POST_NOT_FOUND when the post was soft deleted', async () => {
    const { employerId, jobPostId } = await seedCompletable({
      headcount: 6,
      accepted: 3,
    });
    await prisma.jobPost.update({
      where: { id: jobPostId },
      data: { deletedAt: new Date() },
    });

    await expect(
      service.complete({ jobPostId, employerId }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.JOB_POST_NOT_FOUND });
  });
});
