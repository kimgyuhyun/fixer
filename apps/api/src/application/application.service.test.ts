import { APPLICATION_ERRORS, JOB_POST_ERRORS } from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import {
  ApplicationService,
  type ApplicantProfile,
  type ApplicantProfileReader,
  type ApplicationRecord,
  type ApplicationStore,
  type JobPostReader,
} from './application.service';

const APPLICANT = 'usr_seeker';
const EMPLOYER = 'usr_employer';
const JOB_POST = 'job_1';

/** 모집 중인 공고 하나. 필요한 칸이 몇 개뿐이라 인라인으로 만든다 */
function openPost(overrides: Partial<PostRow> = {}): PostRow {
  return {
    id: JOB_POST,
    employerId: EMPLOYER,
    status: 'OPEN',
    version: 1,
    headcount: 2,
    acceptedCount: 0,
    ...overrides,
  };
}

type PostRow = {
  id: string;
  employerId: string;
  status: 'DRAFT' | 'OPEN' | 'CLOSED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
  version: number;
  headcount: number;
  acceptedCount: number;
};

class FakeJobPosts implements JobPostReader {
  constructor(private readonly row: PostRow | null) {}

  findForApplication(jobPostId: string): Promise<PostRow | null> {
    if (this.row === null || this.row.id !== jobPostId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(this.row);
  }
}

/**
 * 가짜 저장소.
 *
 * **유니크 제약을 흉내 낸다.** `create`가 같은 (공고, 지원자) 짝에 두 번째
 * 행을 만들지 않고 `'DUPLICATE'`를 돌려주는 것이 진짜 DB의 동작이다. 이걸
 * 빼면 서비스의 사전 조회만 검증하게 되어, 이 이슈가 막으려는 경합을 못 본다.
 */
class FakeStore implements ApplicationStore {
  readonly rows: ApplicationRecord[] = [];
  private seq = 0;

  constructor(private readonly post: PostRow | null = null) {}

  create(input: {
    jobPostId: string;
    applicantId: string;
    appliedVersion: number;
  }): Promise<ApplicationRecord | 'DUPLICATE'> {
    const clash = this.rows.find(
      (r) =>
        r.jobPostId === input.jobPostId && r.applicantId === input.applicantId,
    );
    if (clash !== undefined) return Promise.resolve('DUPLICATE');

    const row: ApplicationRecord = {
      id: `app_${++this.seq}`,
      jobPostId: input.jobPostId,
      applicantId: input.applicantId,
      status: 'APPLIED',
      appliedVersion: input.appliedVersion,
      acceptedAt: null,
      // 행마다 다른 시각. 목록 정렬(#18)을 검사하려면 같은 값이면 안 된다.
      createdAt: new Date(Date.UTC(2026, 8, 5, 0, 0, this.seq)),
    };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  findById(applicationId: string): Promise<ApplicationRecord | null> {
    return Promise.resolve(
      this.rows.find((r) => r.id === applicationId) ?? null,
    );
  }

  findByApplicant(
    jobPostId: string,
    applicantId: string,
  ): Promise<ApplicationRecord | null> {
    return Promise.resolve(
      this.rows.find(
        (r) => r.jobPostId === jobPostId && r.applicantId === applicantId,
      ) ?? null,
    );
  }

  updateStatus(input: {
    applicationId: string;
    expectedStatus: ApplicationRecord['status'];
    nextStatus: ApplicationRecord['status'];
  }): Promise<ApplicationRecord | 'STALE'> {
    const row = this.rows.find((r) => r.id === input.applicationId);
    // 조건부 UPDATE의 WHERE. 그 사이 상태가 바뀌었으면 덮어쓰지 않는다.
    if (row === undefined || row.status !== input.expectedStatus) {
      return Promise.resolve('STALE');
    }
    row.status = input.nextStatus;
    return Promise.resolve({ ...row });
  }

  reapply(input: {
    applicationId: string;
    appliedVersion: number;
  }): Promise<ApplicationRecord | 'STALE'> {
    const row = this.rows.find((r) => r.id === input.applicationId);
    if (row === undefined || row.status !== 'WITHDRAWN') {
      return Promise.resolve('STALE');
    }
    row.status = 'APPLIED';
    row.appliedVersion = input.appliedVersion;
    return Promise.resolve({ ...row });
  }

  /**
   * 수락. **두 조건부 UPDATE를 함께 흉내 낸다** (#18, ADR-APP-1).
   *
   * 신청이 `APPLIED`가 아니면 `'STALE'`, 정원이 찼으면 `'FULL'`이고
   * **둘 다 카운터를 건드리지 않는다** — 진짜 트랜잭션이 하는 일이다.
   */
  accept(input: {
    applicationId: string;
    jobPostId: string;
    acceptedAt: Date;
  }): Promise<ApplicationRecord | 'STALE' | 'FULL'> {
    const row = this.rows.find((r) => r.id === input.applicationId);
    if (row === undefined || row.status !== 'APPLIED') {
      return Promise.resolve('STALE');
    }
    if (this.post !== null && this.post.acceptedCount >= this.post.headcount) {
      return Promise.resolve('FULL');
    }

    row.status = 'ACCEPTED';
    row.acceptedAt = input.acceptedAt;
    if (this.post !== null) this.post.acceptedCount += 1;
    return Promise.resolve({ ...row });
  }

  listByJobPost(
    jobPostId: string,
    statuses: readonly ApplicationRecord['status'][],
  ): Promise<ApplicationRecord[]> {
    return Promise.resolve(
      this.rows
        .filter((r) => r.jobPostId === jobPostId && statuses.includes(r.status))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((r) => ({ ...r })),
    );
  }
}

/** 지원자의 이름과 평점. 등록해 둔 것만 돌려준다 */
class FakeProfiles implements ApplicantProfileReader {
  constructor(private readonly rows: Record<string, ApplicantProfile> = {}) {}

  profilesOf(
    applicantIds: readonly string[],
  ): Promise<Map<string, ApplicantProfile>> {
    const found = new Map<string, ApplicantProfile>();
    for (const id of applicantIds) {
      const profile = this.rows[id];
      if (profile !== undefined) found.set(id, profile);
    }
    return Promise.resolve(found);
  }
}

function makeService(
  post: PostRow | null = openPost(),
  profiles: Record<string, ApplicantProfile> = {},
): {
  service: ApplicationService;
  store: FakeStore;
  post: PostRow | null;
} {
  // 저장소가 공고 행을 함께 본다. 수락이 신청과 카운터를 **함께** 바꾸므로
  // 둘을 다른 객체에 두면 트랜잭션의 전부-아니면-전무를 흉내 낼 수 없다.
  const store = new FakeStore(post);
  return {
    service: new ApplicationService(
      store,
      new FakeJobPosts(post),
      new FakeProfiles(profiles),
    ),
    store,
    post,
  };
}

/** 이미 지원해 둔 상태를 만든다 */
async function seedApplied(
  service: ApplicationService,
): Promise<{ id: string }> {
  const applied = await service.apply({
    applicantId: APPLICANT,
    jobPostId: JOB_POST,
  });
  return { id: applied.id };
}

describe('apply', () => {
  it('should create an APPLIED application when a job seeker applies to an OPEN job post', async () => {
    const { service } = makeService();

    const result = await service.apply({
      applicantId: APPLICANT,
      jobPostId: JOB_POST,
    });

    expect(result.status).toBe('APPLIED');
    expect(result.applicantId).toBe(APPLICANT);
  });

  it("should store the job post's current version in appliedVersion", async () => {
    const { service } = makeService(openPost({ version: 1 }));

    const result = await service.apply({
      applicantId: APPLICANT,
      jobPostId: JOB_POST,
    });

    expect(result.appliedVersion).toBe(1);
  });

  // 상수 1을 넣어도 위 테스트는 통과한다. 이게 그걸 잡는다.
  it('should store version 3 in appliedVersion when applying to a job post edited twice', async () => {
    const { service } = makeService(openPost({ version: 3 }));

    const result = await service.apply({
      applicantId: APPLICANT,
      jobPostId: JOB_POST,
    });

    expect(result.appliedVersion).toBe(3);
  });

  it('should revive the withdrawn application back to APPLIED when the applicant re-applies', async () => {
    const { service } = makeService();
    const { id } = await seedApplied(service);
    await service.withdraw({ applicantId: APPLICANT, applicationId: id });

    const again = await service.apply({
      applicantId: APPLICANT,
      jobPostId: JOB_POST,
    });

    expect(again.status).toBe('APPLIED');
  });

  it('should keep the same application id when re-applying after withdrawing', async () => {
    const { service } = makeService();
    const { id } = await seedApplied(service);
    await service.withdraw({ applicantId: APPLICANT, applicationId: id });

    const again = await service.apply({
      applicantId: APPLICANT,
      jobPostId: JOB_POST,
    });

    expect(again.id).toBe(id);
  });

  /**
   * 되살리면서 버전을 다시 안 찍으면, 철회한 뒤 조건이 바뀐 공고에
   * **본 적 없는 조건으로** 다시 지원한 것이 된다.
   */
  it('should refresh appliedVersion to the current version when re-applying after the job post was edited', async () => {
    const post = openPost({ version: 1 });
    const store = new FakeStore();
    const service = new ApplicationService(
      store,
      new FakeJobPosts(post),
      new FakeProfiles(),
    );

    const { id } = await seedApplied(service);
    await service.withdraw({ applicantId: APPLICANT, applicationId: id });
    post.version = 4; // 그 사이 구인자가 필수항목을 고쳤다 (#15)

    const again = await service.apply({
      applicantId: APPLICANT,
      jobPostId: JOB_POST,
    });

    expect(again.appliedVersion).toBe(4);
  });

  it('should reject with APPLICATION_JOB_POST_NOT_OPEN when the job post is CLOSED', async () => {
    const { service } = makeService(openPost({ status: 'CLOSED' }));

    await expect(
      service.apply({ applicantId: APPLICANT, jobPostId: JOB_POST }),
    ).rejects.toMatchObject({
      code: APPLICATION_ERRORS.JOB_POST_NOT_OPEN,
    });
  });

  it('should throw APPLICATION_JOB_POST_NOT_OPEN when the job post is CANCELLED', async () => {
    const { service } = makeService(openPost({ status: 'CANCELLED' }));

    await expect(
      service.apply({ applicantId: APPLICANT, jobPostId: JOB_POST }),
    ).rejects.toMatchObject({
      code: APPLICATION_ERRORS.JOB_POST_NOT_OPEN,
    });
  });

  it('should throw JOB_POST_NOT_FOUND when the job post does not exist', async () => {
    const { service } = makeService(null);

    await expect(
      service.apply({ applicantId: APPLICANT, jobPostId: JOB_POST }),
    ).rejects.toMatchObject({ code: JOB_POST_ERRORS.NOT_FOUND });
  });

  it('should throw APPLICATION_OWN_JOB_POST when the employer applies to their own job post', async () => {
    const { service } = makeService();

    await expect(
      service.apply({ applicantId: EMPLOYER, jobPostId: JOB_POST }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.OWN_JOB_POST });
  });

  it('should throw APPLICATION_ALREADY_APPLIED when the applicant already has an APPLIED application', async () => {
    const { service } = makeService();
    await seedApplied(service);

    await expect(
      service.apply({ applicantId: APPLICANT, jobPostId: JOB_POST }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.ALREADY_APPLIED });
  });

  /**
   * §4.4가 지목한 그 틈. **사전 조회는 "없음"을 봤는데 그 사이 행이 생겼다.**
   *
   * 진짜 DB에서는 두 요청이 순차 실행되어 사전 조회가 먼저 막아버리는 일이
   * 잦아서, 이 경로를 확실히 지나가려면 조회가 놓치는 상황을 만들어야 한다.
   * 여기서 잡지 않으면 `'DUPLICATE'` 분기는 영영 실행되지 않는다.
   */
  it('should throw APPLICATION_ALREADY_APPLIED when the store reports DUPLICATE because the pre-check missed a row inserted in between', async () => {
    const store = new FakeStore();
    const service = new ApplicationService(
      store,
      new FakeJobPosts(openPost()),
      new FakeProfiles(),
    );
    await store.create({
      jobPostId: JOB_POST,
      applicantId: APPLICANT,
      appliedVersion: 1,
    });
    // 조회는 계속 "없음"이라고 한다 — 다른 요청이 방금 넣은 행을 못 본다.
    store.findByApplicant = () => Promise.resolve(null);

    await expect(
      service.apply({ applicantId: APPLICANT, jobPostId: JOB_POST }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.ALREADY_APPLIED });
  });
});

describe('withdraw', () => {
  it('should move the application from APPLIED to WITHDRAWN', async () => {
    const { service } = makeService();
    const { id } = await seedApplied(service);

    const result = await service.withdraw({
      applicantId: APPLICANT,
      applicationId: id,
    });

    expect(result.status).toBe('WITHDRAWN');
  });

  it('should throw APPLICATION_NOT_FOUND when no application has that id', async () => {
    const { service } = makeService();

    await expect(
      service.withdraw({ applicantId: APPLICANT, applicationId: 'app_nope' }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.NOT_FOUND });
  });

  it('should throw APPLICATION_NOT_OWNED when the application belongs to someone else', async () => {
    const { service } = makeService();
    const { id } = await seedApplied(service);

    await expect(
      service.withdraw({ applicantId: 'usr_other', applicationId: id }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.NOT_OWNED });
  });

  // AC5의 서버 쪽. 버튼만 숨기면 API를 직접 부르는 것이 막히지 않는다.
  it('should throw APPLICATION_INVALID_TRANSITION when the application is ACCEPTED', async () => {
    const { service, store } = makeService();
    const { id } = await seedApplied(service);
    store.rows[0].status = 'ACCEPTED';

    await expect(
      service.withdraw({ applicantId: APPLICANT, applicationId: id }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.INVALID_TRANSITION });
  });

  it('should throw APPLICATION_INVALID_TRANSITION when the application is already WITHDRAWN', async () => {
    const { service } = makeService();
    const { id } = await seedApplied(service);
    await service.withdraw({ applicantId: APPLICANT, applicationId: id });

    await expect(
      service.withdraw({ applicantId: APPLICANT, applicationId: id }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.INVALID_TRANSITION });
  });

  /**
   * 우리가 읽은 뒤 구인자가 수락했다. 저장소가 `'STALE'`을 주면 덮어쓰지
   * 않는다 — 덮어쓰면 계약이 체결된 신청이 철회로 사라진다.
   */
  it('should reject with APPLICATION_INVALID_TRANSITION when the store reports STALE because the employer accepted in between', async () => {
    const { service, store } = makeService();
    const { id } = await seedApplied(service);

    const original = store.updateStatus.bind(store);
    store.updateStatus = (input) => {
      store.rows[0].status = 'ACCEPTED'; // 조회와 쓰기 사이에 끼어든다
      return original(input);
    };

    await expect(
      service.withdraw({ applicantId: APPLICANT, applicationId: id }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.INVALID_TRANSITION });
  });
});

describe('findMine', () => {
  it('should return the application when the applicant has applied to that job post', async () => {
    const { service } = makeService();
    await seedApplied(service);

    const mine = await service.findMine(JOB_POST, APPLICANT);

    expect(mine?.status).toBe('APPLIED');
  });

  it('should return null when the applicant has never applied to that job post', async () => {
    const { service } = makeService();

    expect(await service.findMine(JOB_POST, APPLICANT)).toBeNull();
  });
});

describe('accept', () => {
  it('should move the application from APPLIED to ACCEPTED', async () => {
    const { service } = makeService();
    const { id } = await seedApplied(service);

    const result = await service.accept({
      employerId: EMPLOYER,
      applicationId: id,
    });

    expect(result.status).toBe('ACCEPTED');
  });

  // #20의 무상 취소 창(수락 +2시간)이 이 값으로 판정한다. 없으면 그 판정을 못 한다.
  it('should stamp acceptedAt when the application is accepted', async () => {
    const { service } = makeService();
    const { id } = await seedApplied(service);

    const result = await service.accept({
      employerId: EMPLOYER,
      applicationId: id,
    });

    expect(result.acceptedAt).not.toBeNull();
  });

  it("should increase the job post's acceptedCount by 1", async () => {
    const { service, post } = makeService(openPost({ acceptedCount: 0 }));
    const { id } = await seedApplied(service);

    await service.accept({ employerId: EMPLOYER, applicationId: id });

    expect(post?.acceptedCount).toBe(1);
  });

  // 정원의 끝값. 마지막 한 자리는 채워져야 한다 — 한 칸 일찍 막으면
  // 구인자가 6명을 뽑기로 했는데 5명만 확정된다.
  it('should succeed when exactly one seat is left because acceptedCount is headcount minus 1', async () => {
    const { service } = makeService(
      openPost({ headcount: 3, acceptedCount: 2 }),
    );
    const { id } = await seedApplied(service);

    const result = await service.accept({
      employerId: EMPLOYER,
      applicationId: id,
    });

    expect(result.status).toBe('ACCEPTED');
  });

  it('should throw APPLICATION_HEADCOUNT_FULL when acceptedCount already equals headcount', async () => {
    const { service } = makeService(
      openPost({ headcount: 2, acceptedCount: 2 }),
    );
    const { id } = await seedApplied(service);

    await expect(
      service.accept({ employerId: EMPLOYER, applicationId: id }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.HEADCOUNT_FULL });
  });

  // AC5. 수락 버튼 연타. 두 번째가 조용히 성공하면 카운터가 2가 된다.
  it('should not increase acceptedCount when the same application is accepted twice', async () => {
    const { service, post } = makeService(
      openPost({ headcount: 3, acceptedCount: 0 }),
    );
    const { id } = await seedApplied(service);
    await service.accept({ employerId: EMPLOYER, applicationId: id });

    await expect(
      service.accept({ employerId: EMPLOYER, applicationId: id }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.INVALID_TRANSITION });
    expect(post?.acceptedCount).toBe(1);
  });

  it('should throw APPLICATION_NOT_FOUND when no application has that id', async () => {
    const { service } = makeService();

    await expect(
      service.accept({ employerId: EMPLOYER, applicationId: 'app_없음' }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.NOT_FOUND });
  });

  // id만 알면 남의 공고에 사람을 확정시킬 수 있으면 안 된다. 돈이 잠긴 쪽은 그 주인이다.
  it('should throw APPLICATION_NOT_EMPLOYER when the caller does not own the job post', async () => {
    const { service } = makeService();
    const { id } = await seedApplied(service);

    await expect(
      service.accept({ employerId: 'usr_남', applicationId: id }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.NOT_EMPLOYER });
  });

  // 취소된 공고는 RELEASE로 돈이 이미 풀렸다. 지급할 돈이 없는 계약이 생긴다.
  it('should throw APPLICATION_JOB_POST_NOT_OPEN when the job post is CANCELLED', async () => {
    const { service, store } = makeService(openPost({ status: 'CANCELLED' }));
    store.rows.push({
      id: 'app_1',
      jobPostId: JOB_POST,
      applicantId: APPLICANT,
      status: 'APPLIED',
      appliedVersion: 1,
      acceptedAt: null,
      createdAt: new Date(Date.UTC(2026, 8, 5)),
    });

    await expect(
      service.accept({ employerId: EMPLOYER, applicationId: 'app_1' }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.JOB_POST_NOT_OPEN });
  });

  it('should throw APPLICATION_INVALID_TRANSITION when the application is already ACCEPTED', async () => {
    const { service } = makeService(openPost({ headcount: 3 }));
    const { id } = await seedApplied(service);
    await service.accept({ employerId: EMPLOYER, applicationId: id });

    await expect(
      service.accept({ employerId: EMPLOYER, applicationId: id }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.INVALID_TRANSITION });
  });

  // 철회한 사람을 구인자가 확정시키는 경로. 표에 WITHDRAWN → ACCEPTED가 없다.
  it('should throw APPLICATION_INVALID_TRANSITION when the application is WITHDRAWN', async () => {
    const { service } = makeService();
    const { id } = await seedApplied(service);
    await service.withdraw({ applicantId: APPLICANT, applicationId: id });

    await expect(
      service.accept({ employerId: EMPLOYER, applicationId: id }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.INVALID_TRANSITION });
  });
});

describe('listForEmployer', () => {
  it("should return the applicants of the employer's own job post", async () => {
    const { service } = makeService(openPost(), {
      [APPLICANT]: { name: '김구직', ratingAsWorker: null, ratingCount: 0 },
    });
    await seedApplied(service);

    const list = await service.listForEmployer({
      employerId: EMPLOYER,
      jobPostId: JOB_POST,
    });

    expect(list.applicants).toHaveLength(1);
    expect(list.applicants[0]?.applicantId).toBe(APPLICANT);
  });

  // 화면이 "3 / 6"을 그린다. 목록만 주면 정원이 남았는지 알 수 없다.
  it("should return the job post's headcount and acceptedCount alongside the applicants", async () => {
    const { service } = makeService(
      openPost({ headcount: 6, acceptedCount: 3 }),
    );

    const list = await service.listForEmployer({
      employerId: EMPLOYER,
      jobPostId: JOB_POST,
    });

    expect(list).toMatchObject({ headcount: 6, acceptedCount: 3 });
  });

  it('should order applicants by createdAt ascending', async () => {
    const { service } = makeService(openPost(), {
      usr_a: { name: '가', ratingAsWorker: null, ratingCount: 0 },
      usr_b: { name: '나', ratingAsWorker: null, ratingCount: 0 },
    });
    await service.apply({ applicantId: 'usr_a', jobPostId: JOB_POST });
    await service.apply({ applicantId: 'usr_b', jobPostId: JOB_POST });

    const list = await service.listForEmployer({
      employerId: EMPLOYER,
      jobPostId: JOB_POST,
    });

    expect(list.applicants.map((a) => a.applicantId)).toEqual([
      'usr_a',
      'usr_b',
    ]);
  });

  it("should include each applicant's name and rating sample count", async () => {
    const { service } = makeService(openPost(), {
      [APPLICANT]: { name: '김구직', ratingAsWorker: 4.5, ratingCount: 4 },
    });
    await seedApplied(service);

    const list = await service.listForEmployer({
      employerId: EMPLOYER,
      jobPostId: JOB_POST,
    });

    expect(list.applicants[0]).toMatchObject({
      applicantName: '김구직',
      ratingAsWorker: 4.5,
      ratingCount: 4,
    });
  });

  it('should return an empty applicants array when nobody has applied', async () => {
    const { service } = makeService();

    const list = await service.listForEmployer({
      employerId: EMPLOYER,
      jobPostId: JOB_POST,
    });

    expect(list.applicants).toEqual([]);
  });

  // 철회한 사람이 목록에 남으면 구인자가 없는 사람을 수락하려 한다.
  it('should exclude WITHDRAWN applications from the list', async () => {
    const { service } = makeService(openPost(), {
      [APPLICANT]: { name: '김구직', ratingAsWorker: null, ratingCount: 0 },
    });
    const { id } = await seedApplied(service);
    await service.withdraw({ applicantId: APPLICANT, applicationId: id });

    const list = await service.listForEmployer({
      employerId: EMPLOYER,
      jobPostId: JOB_POST,
    });

    expect(list.applicants).toEqual([]);
  });

  it('should throw APPLICATION_NOT_EMPLOYER when the caller does not own the job post', async () => {
    const { service } = makeService();

    await expect(
      service.listForEmployer({
        employerId: 'usr_남',
        jobPostId: JOB_POST,
      }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.NOT_EMPLOYER });
  });

  it('should throw JOB_POST_NOT_FOUND when the job post does not exist', async () => {
    const { service } = makeService(null);

    await expect(
      service.listForEmployer({
        employerId: EMPLOYER,
        jobPostId: JOB_POST,
      }),
    ).rejects.toMatchObject({ code: APPLICATION_ERRORS.JOB_POST_NOT_FOUND });
  });
});
