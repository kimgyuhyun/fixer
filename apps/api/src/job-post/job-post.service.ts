import { Injectable } from '@nestjs/common';
import {
  JOB_POST_ERRORS,
  budgetOf,
  canTransition,
  createJobPostRequestSchema,
  holdIdempotencyKey,
  type CreateJobPostRequest,
  type JobPostErrorCode,
  type JobPostList,
  type JobPostStatus,
  type JobPostSummary,
} from '@fixer/shared';

/** 공고가 던지는 도메인 에러 */
export class JobPostError extends Error {
  constructor(
    readonly code: JobPostErrorCode,
    /** 부족 금액 같은 안내에 필요한 값 */
    readonly detail?: Record<string, number | string>,
  ) {
    super(code);
    this.name = 'JobPostError';
  }
}

/** 저장된 공고 한 건 */
export interface JobPostRecord {
  id: string;
  employerId: string;
  categoryId: string;
  title: string;
  status: JobPostStatus;
  version: number;
  workAddress: string;
  workStartAt: Date;
  workEndAt: Date;
  headcount: number;
  rewardPerPerson: number;
  requiredDescription: string;
  createdAt: Date;
}

/**
 * 공고 저장소.
 *
 * `createOpenWithHold`가 **한 트랜잭션**이어야 한다는 것이 이 포트의 요점이다.
 * 나뉘면 공고만 남아 예산 없는 공고가 목록에 뜨거나, `HOLD`만 남아
 * **아무도 풀어줄 수 없는 돈**이 된다.
 */
export interface JobPostStore {
  /**
   * 공고를 `DRAFT`로 만들고, v1 스냅샷을 남기고, 예산을 잠그고,
   * `OPEN`으로 올린다. **넷이 함께 되거나 함께 안 된다.**
   *
   * 잔액이 모자라면 `'INSUFFICIENT'`를 돌려준다 — 예외로 던지지 않는
   * 이유는 호출부가 부족 금액을 안내해야 하기 때문이다.
   */
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
  }): Promise<JobPostRecord | 'INSUFFICIENT'>;

  listOpen(): Promise<{ items: JobPostRecord[]; total: number }>;
}

/** 근무 주소 기본값을 물어보는 포트 (#3의 `UserAddress`) */
export interface MemberAddressReader {
  /** 그 회원의 기본 주소. 없으면 null */
  defaultAddressOf(userId: string): Promise<string | null>;
}

/** 잔액을 묻는 포트. 부족 금액 안내에 쓴다 */
export interface BalanceReader {
  balanceOf(userId: string): Promise<number>;
}

/**
 * 공고 등록과 목록. (이슈 #12, `spec-fixed.md` §3)
 *
 * **등록과 예산 잠금이 한 동작이다.** 이 프로젝트의 첫 세로 흐름이고,
 * 어느 하나가 빠지면 "등록했는데 돈이 안 잠겼다"거나 "돈은 잠겼는데
 * 공고가 없다"가 된다.
 */
@Injectable()
export class JobPostService {
  constructor(
    private readonly store: JobPostStore,
    private readonly addresses: MemberAddressReader,
    private readonly balances: BalanceReader,
  ) {}

  async create(
    employerId: string,
    input: CreateJobPostRequest,
  ): Promise<JobPostSummary> {
    // 검증이 가장 먼저다. 형식이 틀린 요청은 저장소도 원장도 건드리지 않는다.
    const parsed = createJobPostRequestSchema.parse(input);

    const workAddress = await this.resolveAddress(employerId, parsed);
    const budget = budgetOf(parsed);

    const created = await this.store.createOpenWithHold({
      employerId,
      categoryId: parsed.categoryId,
      title: parsed.title,
      workAddress,
      workStartAt: new Date(parsed.workStartAt),
      workEndAt: new Date(parsed.workEndAt),
      headcount: parsed.headcount,
      rewardPerPerson: parsed.rewardPerPerson,
      requiredDescription: parsed.requiredDescription,
      budget,
    });

    if (created === 'INSUFFICIENT') {
      // "부족합니다"만 주면 얼마를 더 넣어야 하는지 모른다. 본인 계정의
      // 숫자라 감출 정보가 아니다.
      const balance = await this.balances.balanceOf(employerId);
      throw new JobPostError(JOB_POST_ERRORS.INSUFFICIENT_BALANCE, {
        required: budget,
        balance,
        shortfall: budget - balance,
      });
    }

    return toSummary(created);
  }

  async list(): Promise<JobPostList> {
    const { items, total } = await this.store.listOpen();
    return { items: items.map(toSummary), total };
  }

  /**
   * 근무 주소를 정한다.
   *
   * 비었으면 가입 주소로 채운다. **서버가 채우는 이유**는, 화면이 채우면
   * 주소를 바꾼 사용자가 옛 값을 보낼 수 있고 서버는 그게 기본값인지
   * 사용자가 고른 값인지 구분할 방법이 없기 때문이다.
   */
  private async resolveAddress(
    employerId: string,
    parsed: CreateJobPostRequest,
  ): Promise<string> {
    const given = parsed.workAddress?.trim() ?? '';
    if (given !== '') return given;

    const fallback = await this.addresses.defaultAddressOf(employerId);
    if (fallback === null || fallback.trim() === '') {
      throw new JobPostError(JOB_POST_ERRORS.NO_DEFAULT_ADDRESS);
    }
    return fallback;
  }
}

/**
 * 상태를 옮긴다. **표에 없으면 거부한다** (ADR-JOB-3).
 *
 * 판정만 한다. 포인트·알림 같은 부수 효과는 호출부에 둔다 — 그래야 표가
 * 선언적이라는 인상과 실제 동작이 어긋나지 않는다.
 */
export function transition(
  from: JobPostStatus,
  to: JobPostStatus,
): JobPostStatus {
  if (!canTransition(from, to)) {
    throw new JobPostError(JOB_POST_ERRORS.INVALID_TRANSITION, { from, to });
  }
  return to;
}

/**
 * 잠금 키. **공고 id가 정해진 뒤에야 만들 수 있으므로** 저장소가
 * 트랜잭션 안에서 부른다. 같은 공고는 두 번 잠기지 않는다.
 */
export function holdKeyFor(jobPostId: string, version: number): string {
  return holdIdempotencyKey(jobPostId, version);
}

function toSummary(row: JobPostRecord): JobPostSummary {
  return {
    id: row.id,
    title: row.title,
    categoryId: row.categoryId,
    status: row.status,
    version: row.version,
    workAddress: row.workAddress,
    workStartAt: row.workStartAt.toISOString(),
    workEndAt: row.workEndAt.toISOString(),
    headcount: row.headcount,
    rewardPerPerson: row.rewardPerPerson,
    budget: budgetOf(row),
    createdAt: row.createdAt.toISOString(),
  };
}
