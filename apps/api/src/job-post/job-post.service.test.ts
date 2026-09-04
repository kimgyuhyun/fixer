import {
  JOB_POST_ERRORS,
  JOB_POST_TRANSITIONS,
  canTransition,
  holdIdempotencyKey,
  type CreateJobPostRequest,
  type JobPostStatus,
} from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  JobPostError,
  JobPostService,
  transition,
  type BalanceReader,
  type JobPostRecord,
  type JobPostStore,
  type MemberAddressReader,
} from './job-post.service';

const EMPLOYER = 'usr_employer';
const HOME = '서울 강남구 테헤란로 1';

const VALID: CreateJobPostRequest = {
  categoryId: 'cat_cleaning',
  title: '사무실 청소',
  workAddress: undefined,
  workStartAt: '2026-10-01T09:00:00.000Z',
  workEndAt: '2026-10-01T18:00:00.000Z',
  headcount: 3,
  rewardPerPerson: 50_000,
  requiredDescription: '30평 사무실 바닥과 창문을 닦습니다.',
};

/**
 * 가짜 저장소.
 *
 * **공고 저장과 잠금을 함께 한다.** 진짜 저장소가 한 트랜잭션으로 하는
 * 일이라 가짜도 한 메서드로 둔다 — 나눠 두면 "따로 해도 통과하는" 테스트가
 * 되어 이 이슈가 막으려는 것을 못 막는다.
 */
class FakeStore implements JobPostStore {
  readonly posts: JobPostRecord[] = [];
  readonly holds: { key: string; amount: number; jobPostId: string }[] = [];
  readonly snapshots: { jobPostId: string; version: number }[] = [];
  private seq = 0;

  constructor(private balance: number) {}

  createOpenWithHold(input: {
    employerId: string;
    categoryId: string;
    title: string;
    workAddress: string;
    workStartAt: Date;
    workEndAt: Date;
    headcount: number;
    rewardPerPerson: number;
    requiredDescription: string;
    budget: number;
  }): Promise<JobPostRecord | 'INSUFFICIENT'> {
    if (input.budget > this.balance) {
      // 아무것도 남기지 않는다. 트랜잭션이 통째로 되돌아간 것과 같다.
      return Promise.resolve('INSUFFICIENT');
    }

    const id = `job_${++this.seq}`;
    // DRAFT로 만들고 전이표를 거쳐 OPEN으로 올린다 (ADR-JOB-3).
    const status = transition('DRAFT', 'OPEN');
    const row: JobPostRecord = {
      id,
      employerId: input.employerId,
      categoryId: input.categoryId,
      title: input.title,
      status,
      version: 1,
      workAddress: input.workAddress,
      workStartAt: input.workStartAt,
      workEndAt: input.workEndAt,
      headcount: input.headcount,
      rewardPerPerson: input.rewardPerPerson,
      requiredDescription: input.requiredDescription,
      createdAt: new Date('2026-09-05T00:00:00.000Z'),
    };

    this.posts.push(row);
    this.snapshots.push({ jobPostId: id, version: 1 });
    this.holds.push({
      key: holdIdempotencyKey(id, 1),
      amount: -input.budget,
      jobPostId: id,
    });
    this.balance -= input.budget;
    return Promise.resolve(row);
  }

  listOpen(): Promise<{ items: JobPostRecord[]; total: number }> {
    const items = this.posts.filter((p) => p.status === 'OPEN');
    return Promise.resolve({ items, total: items.length });
  }

  /** 목록에 안 뜨는 것을 보려고 DRAFT 하나를 직접 넣는다 */
  seedDraft(): void {
    this.posts.push({
      ...this.posts[0],
      id: 'job_draft',
      status: 'DRAFT',
    });
  }

  currentBalance(): number {
    return this.balance;
  }
}

function addresses(home: string | null): MemberAddressReader {
  return { defaultAddressOf: () => Promise.resolve(home) };
}

function setup(opts: { balance?: number; home?: string | null } = {}): {
  service: JobPostService;
  store: FakeStore;
} {
  const store = new FakeStore(opts.balance ?? 1_000_000);
  const balances: BalanceReader = {
    balanceOf: () => Promise.resolve(store.currentBalance()),
  };
  const service = new JobPostService(
    store,
    addresses(opts.home === undefined ? HOME : opts.home),
    balances,
  );
  return { service, store };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

function codeOf(error: unknown): unknown {
  expect(error).toBeInstanceOf(JobPostError);
  return (error as JobPostError).code;
}

/** zod 오류에서 그 필드의 문구를 꺼낸다 */
function fieldErrorOf(error: unknown, field: string): string | undefined {
  expect(error).toBeInstanceOf(ZodError);
  return (error as ZodError).issues.find((i) => i.path[0] === field)?.message;
}

describe('create — 등록하면 OPEN으로 저장된다 (AC1)', () => {
  it('should save the job post as OPEN', async () => {
    const { service } = setup();

    const created = await service.create(EMPLOYER, VALID);

    expect(created.status).toBe('OPEN');
  });

  it('should start version at 1', async () => {
    const { service } = setup();

    const created = await service.create(EMPLOYER, VALID);

    expect(created.version).toBe(1);
  });

  it('should write the v1 snapshot so a contract can be restored', async () => {
    // 등록 시점에 v1을 안 만들면 첫 수정 전까지 복원할 스냅샷이 없다.
    const { service, store } = setup();

    const created = await service.create(EMPLOYER, VALID);

    expect(store.snapshots).toEqual([{ jobPostId: created.id, version: 1 }]);
  });
});

describe('transition — 표에 없으면 거부한다 (ADR-JOB-3)', () => {
  it('should refuse a transition that is not in the table', () => {
    // DRAFT에서 바로 COMPLETED로 가면 돈이 잠기지도 않고 지급이 나간다.
    expect(() => transition('DRAFT', 'COMPLETED')).toThrow(JobPostError);
  });

  it('should refuse to move out of a final state', () => {
    expect(() => transition('CANCELLED', 'OPEN')).toThrow(JobPostError);
  });

  it('should allow every transition the table lists', () => {
    for (const t of JOB_POST_TRANSITIONS) {
      expect(transition(t.from, t.to)).toBe(t.to);
    }
  });

  it('should refuse every transition the table does not list', () => {
    const statuses: JobPostStatus[] = [
      'DRAFT',
      'OPEN',
      'CLOSED',
      'COMPLETED',
      'CANCELLED',
      'EXPIRED',
    ];
    // 36개 조합 전부를 표와 대조한다. 표에 없으면 예외여야 한다.
    for (const from of statuses) {
      for (const to of statuses) {
        if (canTransition(from, to)) continue;
        expect(() => transition(from, to)).toThrow(JobPostError);
      }
    }
  });
});

describe('create — 인원 × 보상금만큼 잠긴다 (AC2)', () => {
  it('should hold headcount times rewardPerPerson', async () => {
    const { service, store } = setup();

    await service.create(EMPLOYER, VALID);

    expect(store.holds).toHaveLength(1);
    expect(store.holds[0].amount).toBe(-150_000);
  });

  it('should report the budget on the created post', async () => {
    const { service } = setup();

    const created = await service.create(EMPLOYER, VALID);

    expect(created.budget).toBe(150_000);
  });

  it('should point the HOLD row at the job post', async () => {
    const { service, store } = setup();

    const created = await service.create(EMPLOYER, VALID);

    expect(store.holds[0].jobPostId).toBe(created.id);
    expect(store.holds[0].key).toBe(holdIdempotencyKey(created.id, 1));
  });
});

describe('create — 잔액이 부족하면 막힌다 (AC3)', () => {
  it('should reject with POINT_INSUFFICIENT_BALANCE', async () => {
    const { service } = setup({ balance: 100_000 });

    const error = await rejectionOf(service.create(EMPLOYER, VALID));

    expect(codeOf(error)).toBe(JOB_POST_ERRORS.INSUFFICIENT_BALANCE);
  });

  it('should say how much more is needed', async () => {
    // "부족합니다"만 주면 얼마를 더 넣어야 하는지 모른다.
    const { service } = setup({ balance: 100_000 });

    const error = await rejectionOf(service.create(EMPLOYER, VALID));

    expect((error as JobPostError).detail).toEqual({
      required: 150_000,
      balance: 100_000,
      shortfall: 50_000,
    });
  });

  it('should not save the job post when the balance is short', async () => {
    const { service, store } = setup({ balance: 100_000 });

    await rejectionOf(service.create(EMPLOYER, VALID));

    expect(store.posts).toHaveLength(0);
    expect(store.holds).toHaveLength(0);
  });

  it('should allow a budget that spends the balance exactly', async () => {
    const { service, store } = setup({ balance: 150_000 });

    await service.create(EMPLOYER, VALID);

    expect(store.currentBalance()).toBe(0);
  });
});

describe('create — 필수항목이 비면 저장되지 않는다 (AC4)', () => {
  it('should reject an empty required field with a field error', async () => {
    const { service } = setup();

    const error = await rejectionOf(
      service.create(EMPLOYER, { ...VALID, requiredDescription: '   ' }),
    );

    expect(fieldErrorOf(error, 'requiredDescription')).toBe(
      '상세 내용을 입력해 주세요.',
    );
  });

  it('should not touch the ledger when validation fails', async () => {
    const { service, store } = setup();

    await rejectionOf(service.create(EMPLOYER, { ...VALID, title: '' }));

    expect(store.posts).toHaveLength(0);
    expect(store.holds).toHaveLength(0);
  });

  it('should reject a headcount below one', async () => {
    const { service } = setup();

    const error = await rejectionOf(
      service.create(EMPLOYER, { ...VALID, headcount: 0 }),
    );

    expect(fieldErrorOf(error, 'headcount')).toBe(
      '한 명 이상 모집해야 합니다.',
    );
  });

  it('should reject a reward that is not a multiple of 1000', async () => {
    // 잔돈이 섞이면 환불 lot 소진에서 나머지가 남는다 (ADR-PAY-7).
    const { service } = setup();

    const error = await rejectionOf(
      service.create(EMPLOYER, { ...VALID, rewardPerPerson: 1_500 }),
    );

    expect(fieldErrorOf(error, 'rewardPerPerson')).toBe(
      '보상금은 1,000원 단위로 정해 주세요.',
    );
  });

  it('should reject a reward that is zero or negative', async () => {
    // 1,000 배수 검사만 있으면 0은 통과한다 — 0 % 1000 === 0이기 때문이다.
    const { service } = setup();

    expect(
      fieldErrorOf(
        await rejectionOf(
          service.create(EMPLOYER, { ...VALID, rewardPerPerson: 0 }),
        ),
        'rewardPerPerson',
      ),
    ).toBe('보상금을 입력해 주세요.');
    expect(
      fieldErrorOf(
        await rejectionOf(
          service.create(EMPLOYER, { ...VALID, rewardPerPerson: -1_000 }),
        ),
        'rewardPerPerson',
      ),
    ).toBe('보상금을 입력해 주세요.');
  });

  it('should reject a work period that ends before it starts', async () => {
    const { service } = setup();

    const error = await rejectionOf(
      service.create(EMPLOYER, {
        ...VALID,
        workStartAt: '2026-10-01T18:00:00.000Z',
        workEndAt: '2026-10-01T09:00:00.000Z',
      }),
    );

    expect(fieldErrorOf(error, 'workEndAt')).toBe(
      '근무 종료는 시작보다 뒤여야 합니다.',
    );
  });

  it('should reject a work period of zero length', async () => {
    const { service } = setup();

    const error = await rejectionOf(
      service.create(EMPLOYER, {
        ...VALID,
        workEndAt: VALID.workStartAt,
      }),
    );

    expect(fieldErrorOf(error, 'workEndAt')).toBeDefined();
  });
});

describe('list — 목록에 뜬다 (AC5)', () => {
  it('should include the job post that was just created', async () => {
    const { service } = setup();
    const created = await service.create(EMPLOYER, VALID);

    const list = await service.list();

    expect(list.items.map((i) => i.id)).toEqual([created.id]);
  });

  it('should not include a job post that is still DRAFT', async () => {
    // DRAFT는 잠깐 스쳐가는 상태다. 예산이 안 잠긴 공고가 목록에 뜨면 안 된다.
    const { service, store } = setup();
    await service.create(EMPLOYER, VALID);
    store.seedDraft();

    const list = await service.list();

    expect(list.items).toHaveLength(1);
    expect(list.items[0].status).toBe('OPEN');
  });

  it('should report the total count', async () => {
    const { service } = setup();
    await service.create(EMPLOYER, VALID);
    await service.create(EMPLOYER, { ...VALID, title: '창고 정리' });

    const list = await service.list();

    expect(list.total).toBe(2);
  });
});

describe('create — 근무 주소 기본값 (AC6)', () => {
  it('should fill the work address from the member address when it is blank', async () => {
    const { service } = setup();

    const created = await service.create(EMPLOYER, {
      ...VALID,
      workAddress: undefined,
    });

    expect(created.workAddress).toBe(HOME);
  });

  it('should keep the given work address when one is provided', async () => {
    const { service } = setup();

    const created = await service.create(EMPLOYER, {
      ...VALID,
      workAddress: '서울 마포구 월드컵북로 1',
    });

    expect(created.workAddress).toBe('서울 마포구 월드컵북로 1');
  });

  it('should treat a whitespace-only address as blank', async () => {
    const { service } = setup();

    const created = await service.create(EMPLOYER, {
      ...VALID,
      workAddress: '   ',
    });

    expect(created.workAddress).toBe(HOME);
  });

  it('should reject when the address is blank and the member has none', async () => {
    const { service, store } = setup({ home: null });

    const error = await rejectionOf(
      service.create(EMPLOYER, { ...VALID, workAddress: undefined }),
    );

    expect(codeOf(error)).toBe(JOB_POST_ERRORS.NO_DEFAULT_ADDRESS);
    expect(store.posts).toHaveLength(0);
  });
});
