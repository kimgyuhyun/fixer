import {
  ADMIN_ERRORS,
  JOB_POST_ERRORS,
  cancelIdempotencyKey,
  type AdminJobPostFilter,
  type JobPostStatus,
} from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import {
  JobPostError,
  type AcceptedCounter,
  type JobPostRecord,
  type JobPostStore,
} from '../job-post/job-post.service';
import {
  AdminError,
  AdminJobPostService,
  type AdminJobPostRow,
  type AdminJobPostStore,
} from './admin-job-post.service';

const ADMIN = 'usr_admin';
const EMPLOYER = 'usr_employer';
const POST = 'job_1';

/** 필터 없이 첫 페이지 */
const ALL: AdminJobPostFilter = { page: 1 };

function record(overrides: Partial<JobPostRecord> = {}): JobPostRecord {
  return {
    id: POST,
    employerId: EMPLOYER,
    categoryId: 'cat_cleaning',
    title: '사무실 청소',
    status: 'OPEN',
    version: 1,
    workAddress: '서울 강남구 테헤란로 1',
    workSido: '서울',
    workSigungu: '강남구',
    workStartAt: new Date('2026-10-01T09:00:00.000Z'),
    workEndAt: new Date('2026-10-01T18:00:00.000Z'),
    headcount: 3,
    rewardPerPerson: 50_000,
    requiredDescription: '30평 사무실 바닥과 창문을 닦습니다.',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function row(overrides: Partial<AdminJobPostRow> = {}): AdminJobPostRow {
  return {
    ...record(),
    employerName: '박구인',
    categoryName: '청소',
    ...overrides,
  };
}

/**
 * 목록 저장소 대역.
 *
 * **거르지 않는다.** 검색어가 실제로 좁히는지는 진짜 SQL만 아는 일이라
 * 통합 테스트가 본다. 여기서 거르면 가짜의 필터 구현을 검증하게 된다.
 */
class FakeAdminStore implements AdminJobPostStore {
  received?: { filter: AdminJobPostFilter; pageSize: number };

  constructor(
    private readonly items: AdminJobPostRow[],
    private readonly total = items.length,
  ) {}

  listAll(
    filter: AdminJobPostFilter,
    pageSize: number,
  ): Promise<{ items: AdminJobPostRow[]; total: number }> {
    this.received = { filter, pageSize };
    return Promise.resolve({ items: this.items, total: this.total });
  }
}

/** 취소 호출을 기록만 하는 공고 저장소 대역 */
class FakeJobPostStore implements Partial<JobPostStore> {
  readonly cancels: Parameters<JobPostStore['cancelAndRelease']>[0][] = [];

  constructor(
    private readonly post: JobPostRecord | null,
    private readonly released = 150_000,
    private readonly result: 'OK' | 'STALE' = 'OK',
  ) {}

  findById(): Promise<(JobPostRecord & { categoryName: string }) | null> {
    return Promise.resolve(
      this.post === null ? null : { ...this.post, categoryName: '청소' },
    );
  }

  cancelAndRelease(
    input: Parameters<JobPostStore['cancelAndRelease']>[0],
  ): Promise<{ released: number; alreadyReleased: boolean } | 'STALE'> {
    this.cancels.push(input);
    return Promise.resolve(
      this.result === 'STALE'
        ? 'STALE'
        : { released: this.released, alreadyReleased: false },
    );
  }
}

function accepted(count: number): AcceptedCounter {
  return { countAccepted: () => Promise.resolve(count) };
}

function serviceWith(input: {
  rows?: AdminJobPostRow[];
  total?: number;
  post?: JobPostRecord | null;
  released?: number;
  acceptedCount?: number;
  cancelResult?: 'OK' | 'STALE';
}): {
  service: AdminJobPostService;
  admins: FakeAdminStore;
  posts: FakeJobPostStore;
} {
  const admins = new FakeAdminStore(input.rows ?? [], input.total);
  const posts = new FakeJobPostStore(
    input.post === undefined ? record() : input.post,
    input.released ?? 150_000,
    input.cancelResult ?? 'OK',
  );
  const service = new AdminJobPostService(
    admins,
    posts as unknown as JobPostStore,
    accepted(input.acceptedCount ?? 0),
  );
  return { service, admins, posts };
}

describe('AdminJobPostService.list', () => {
  it('should return title, employerName, categoryName, status and createdAt for every row', async () => {
    const { service } = serviceWith({
      rows: [row({ title: '사무실 청소', employerName: '박구인' })],
    });

    const list = await service.list(ALL);

    expect(list.items).toEqual([
      {
        id: POST,
        title: '사무실 청소',
        employerName: '박구인',
        categoryName: '청소',
        status: 'OPEN',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]);
  });

  it('should return an empty items array with the unfiltered-page total when page is past the last page', async () => {
    const { service } = serviceWith({ rows: [], total: 42 });

    const list = await service.list({ page: 99 });

    expect(list.items).toEqual([]);
    expect(list.total).toBe(42);
    expect(list.page).toBe(99);
  });
});

describe('AdminJobPostService.forceCancel', () => {
  it('should set the post to CANCELLED and release the whole held amount', async () => {
    const { service } = serviceWith({ released: 150_000 });

    const result = await service.forceCancel({
      adminId: ADMIN,
      jobPostId: POST,
      reason: '허위 공고',
    });

    expect(result).toMatchObject({
      id: POST,
      status: 'CANCELLED',
      released: 150_000,
    });
  });

  it('should record an AdminAuditLog row carrying the admin id, the reason and the time', async () => {
    const { service, posts } = serviceWith({});

    await service.forceCancel({
      adminId: ADMIN,
      jobPostId: POST,
      reason: '허위 공고',
    });

    // 시각은 저장소가 `createdAt` 기본값으로 찍는다. 서비스가 넘기는 것은
    // 누가·왜 둘이고, 그 둘이 취소와 **같은 호출**에 실려 가야 한다.
    expect(posts.cancels).toHaveLength(1);
    expect(posts.cancels[0]).toMatchObject({
      jobPostId: POST,
      idempotencyKey: cancelIdempotencyKey(POST),
      audit: { adminId: ADMIN, reason: '허위 공고' },
    });
  });

  it('should release the amount actually held in the ledger, not the recomputed budget, when the budget was edited after posting', async () => {
    // 예산은 3명 × 50,000 = 150,000인데 원장에 실제로 잠긴 것은 90,000이다.
    // #15에서 정원을 줄이며 일부가 이미 풀렸다.
    const { service } = serviceWith({
      post: record({ headcount: 3, rewardPerPerson: 50_000 }),
      released: 90_000,
    });

    const result = await service.forceCancel({
      adminId: ADMIN,
      jobPostId: POST,
      reason: '허위 공고',
    });

    expect(result.released).toBe(90_000);
  });

  it('should release 0 and still record the audit log when nothing is held', async () => {
    const { service, posts } = serviceWith({ released: 0 });

    const result = await service.forceCancel({
      adminId: ADMIN,
      jobPostId: POST,
      reason: '중복 공고',
    });

    expect(result.released).toBe(0);
    expect(posts.cancels[0]?.audit).toMatchObject({ reason: '중복 공고' });
  });

  it('should not penalize the employer when the post has no accepted applicant', async () => {
    const { service, posts } = serviceWith({ acceptedCount: 0 });

    const result = await service.forceCancel({
      adminId: ADMIN,
      jobPostId: POST,
      reason: '허위 공고',
    });

    expect(result.penalized).toBe(false);
    expect(posts.cancels[0]?.penalize).toBe(false);
  });

  it('should penalize the employer once when the post has at least one accepted applicant', async () => {
    const { service, posts } = serviceWith({ acceptedCount: 2 });

    const result = await service.forceCancel({
      adminId: ADMIN,
      jobPostId: POST,
      reason: '허위 공고',
    });

    expect(result.penalized).toBe(true);
    expect(posts.cancels.filter((c) => c.penalize)).toHaveLength(1);
  });

  it('should cancel a CLOSED post as well, since the transition table allows CLOSED to CANCELLED', async () => {
    const { service } = serviceWith({ post: record({ status: 'CLOSED' }) });

    const result = await service.forceCancel({
      adminId: ADMIN,
      jobPostId: POST,
      reason: '근무 조건 위반',
    });

    expect(result.status).toBe('CANCELLED');
  });

  it('should throw ADMIN_REASON_REQUIRED when the reason is empty or only whitespace', async () => {
    const { service, posts } = serviceWith({});

    for (const reason of ['', '   ', '\n']) {
      const error = await service
        .forceCancel({ adminId: ADMIN, jobPostId: POST, reason })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AdminError);
      expect((error as AdminError).code).toBe(ADMIN_ERRORS.REASON_REQUIRED);
    }
    // 사유가 없으면 저장소까지 가지 않는다.
    expect(posts.cancels).toHaveLength(0);
  });

  it('should throw JOB_POST_NOT_FOUND when the post does not exist or is soft-deleted', async () => {
    const { service } = serviceWith({ post: null });

    const error = await service
      .forceCancel({ adminId: ADMIN, jobPostId: 'job_gone', reason: '허위' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(JobPostError);
    expect((error as JobPostError).code).toBe(JOB_POST_ERRORS.NOT_FOUND);
  });

  it('should throw JOB_POST_INVALID_TRANSITION when the post is already CANCELLED', async () => {
    const { service } = serviceWith({ post: record({ status: 'CANCELLED' }) });

    const error = await service
      .forceCancel({ adminId: ADMIN, jobPostId: POST, reason: '허위' })
      .catch((e: unknown) => e);

    expect((error as JobPostError).code).toBe(
      JOB_POST_ERRORS.INVALID_TRANSITION,
    );
  });

  it('should throw JOB_POST_INVALID_TRANSITION when the post is COMPLETED', async () => {
    const { service } = serviceWith({ post: record({ status: 'COMPLETED' }) });

    const error = await service
      .forceCancel({ adminId: ADMIN, jobPostId: POST, reason: '허위' })
      .catch((e: unknown) => e);

    expect((error as JobPostError).code).toBe(
      JOB_POST_ERRORS.INVALID_TRANSITION,
    );
  });

  it('should write no audit log when the cancel is rejected', async () => {
    // 전이가 표에 없으면 저장소를 부르지 않는다 — 부르지 않으므로 감사
    // 로그도 안 남는다. 조치가 없었는데 기록만 남는 것을 막는다.
    const rejected: JobPostStatus[] = ['CANCELLED', 'COMPLETED', 'EXPIRED'];

    for (const status of rejected) {
      const { service, posts } = serviceWith({ post: record({ status }) });
      await service
        .forceCancel({ adminId: ADMIN, jobPostId: POST, reason: '허위' })
        .catch(() => undefined);

      expect(posts.cancels).toHaveLength(0);
    }
  });
});
