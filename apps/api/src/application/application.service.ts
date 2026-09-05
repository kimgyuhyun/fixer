import { Injectable } from '@nestjs/common';
import {
  APPLICATION_ERRORS,
  applyRequestSchema,
  canApplicationTransition,
  type ApplicationErrorCode,
  type ApplicationStatus,
  type ApplicationSummary,
  type ApplyRequest,
  type JobPostStatus,
} from '@fixer/shared';

/** 신청이 던지는 도메인 에러 */
export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    /** 어떤 상태에서 막혔는지 같은 안내에 필요한 값 */
    readonly detail?: Record<string, number | string>,
  ) {
    super(code);
    this.name = 'ApplicationError';
  }
}

/** 저장된 신청 한 건 */
export interface ApplicationRecord {
  id: string;
  jobPostId: string;
  applicantId: string;
  status: ApplicationStatus;
  appliedVersion: number;
  createdAt: Date;
}

export interface ApplicationStore {
  /**
   * 신청을 `APPLIED`로 만든다.
   *
   * 유니크 제약에 걸리면 `'DUPLICATE'`다 — 예외로 던지지 않는 이유는
   * **이것이 경합의 정상적인 결과**이기 때문이다. 지원 버튼을 연타하면
   * 서비스의 사전 조회는 둘 다 통과하고, 실제로 한 건만 살아남는 것은
   * 여기다 (§4.5).
   */
  create(input: {
    jobPostId: string;
    applicantId: string;
    appliedVersion: number;
  }): Promise<ApplicationRecord | 'DUPLICATE'>;

  findById(applicationId: string): Promise<ApplicationRecord | null>;

  /** 그 사람이 그 공고에 낸 신청. 없으면 null */
  findByApplicant(
    jobPostId: string,
    applicantId: string,
  ): Promise<ApplicationRecord | null>;

  /**
   * 상태를 옮긴다.
   *
   * **`expectedStatus`를 `WHERE`에 걸어 다시 확인한다.** 서비스의 조회와
   * 이 쓰기는 다른 트랜잭션이라, 그 사이에 구인자가 수락했을 수 있다.
   * 어긋나면 `'STALE'`이고 덮어쓰지 않는다 (#16과 같은 이유).
   */
  updateStatus(input: {
    applicationId: string;
    expectedStatus: ApplicationStatus;
    nextStatus: ApplicationStatus;
  }): Promise<ApplicationRecord | 'STALE'>;

  /**
   * 철회한 신청을 되살린다. `WITHDRAWN → APPLIED` (§4.2 개정).
   *
   * **`updateStatus`로 갈음할 수 없다.** 되살리면서 `appliedVersion`을
   * 지금 버전으로 다시 찍어야 하기 때문이다 — 철회한 뒤 공고가 바뀌었는데
   * 옛 버전이 남으면, 그 사람은 본 적 없는 조건에 동의한 것이 된다.
   * 상태와 버전이 **한 문장 안에서** 함께 바뀌어야 그 창이 안 생긴다.
   *
   * `WHERE status = 'WITHDRAWN'`이라 동시 재지원 2건 중 하나는 `'STALE'`이다.
   */
  reapply(input: {
    applicationId: string;
    appliedVersion: number;
  }): Promise<ApplicationRecord | 'STALE'>;
}

/**
 * 공고를 읽는 포트. **셋만 필요하다** — 상태·버전·주인.
 *
 * `JobPostService`를 통째로 주입하지 않는 이유는, 그러면 신청 도메인이
 * 공고의 등록·수정·취소에까지 닿게 되기 때문이다.
 */
export interface JobPostReader {
  /** 소프트 삭제된 공고는 **못 찾은 것으로 다룬다** (#14) */
  findForApplication(jobPostId: string): Promise<{
    id: string;
    employerId: string;
    status: JobPostStatus;
    version: number;
  } | null>;
}

/**
 * 지원과 철회. (이슈 #17, `spec-fixed.md` §4)
 *
 * 이 도메인이 "누가 누구와 무엇을 약속했는가"의 진실을 갖는다. #17은 그중
 * **약속이 생기는 순간과 수락 전에 무르는 순간**까지만 다룬다.
 */
@Injectable()
export class ApplicationService {
  constructor(
    private readonly store: ApplicationStore,
    private readonly jobPosts: JobPostReader,
  ) {}

  async apply(input: ApplyRequest): Promise<ApplicationSummary> {
    // 검증이 가장 먼저다. 형식이 틀린 요청은 저장소를 건드리지 않는다.
    const parsed = applyRequestSchema.parse(input);

    const post = await this.jobPosts.findForApplication(parsed.jobPostId);
    if (post === null) {
      throw new ApplicationError(APPLICATION_ERRORS.JOB_POST_NOT_FOUND);
    }
    // 본인 공고 확인이 상태 확인보다 먼저다. 마감된 자기 공고에 지원했을 때
    // "모집이 끝났다"고 하면 다시 열면 되는 줄 알게 된다.
    if (post.employerId === parsed.applicantId) {
      throw new ApplicationError(APPLICATION_ERRORS.OWN_JOB_POST);
    }
    if (post.status !== 'OPEN') {
      throw new ApplicationError(APPLICATION_ERRORS.JOB_POST_NOT_OPEN, {
        status: post.status,
      });
    }

    const existing = await this.store.findByApplicant(
      post.id,
      parsed.applicantId,
    );

    if (existing !== null) {
      return this.reviveOrReject(existing, post.version);
    }

    const created = await this.store.create({
      jobPostId: post.id,
      applicantId: parsed.applicantId,
      appliedVersion: post.version,
    });

    if (created === 'DUPLICATE') {
      // 우리가 "없음"을 본 뒤 같은 사람의 다른 요청이 먼저 넣었다.
      // **유니크 제약이 이긴 것이고, 그게 정상이다** (§4.5).
      throw new ApplicationError(APPLICATION_ERRORS.ALREADY_APPLIED);
    }

    return toSummary(created);
  }

  /** 수락 전 철회. **경고가 쌓이지 않는다** (AC4) */
  async withdraw(input: {
    applicantId: string;
    applicationId: string;
  }): Promise<ApplicationSummary> {
    const current = await this.store.findById(input.applicationId);
    if (current === null) {
      throw new ApplicationError(APPLICATION_ERRORS.NOT_FOUND);
    }
    // 없다고 하지 않는다. 본인 것이 아니라는 사실만 말한다.
    if (current.applicantId !== input.applicantId) {
      throw new ApplicationError(APPLICATION_ERRORS.NOT_OWNED);
    }

    // 표에 없는 전이는 거부된다. AC5의 `ACCEPTED`가 여기서 걸린다.
    transition(current.status, 'WITHDRAWN');

    const updated = await this.store.updateStatus({
      applicationId: current.id,
      expectedStatus: current.status,
      nextStatus: 'WITHDRAWN',
    });

    if (updated === 'STALE') {
      // 우리가 읽은 뒤 구인자가 수락했다. 덮어쓰면 체결된 계약이 사라진다.
      throw new ApplicationError(APPLICATION_ERRORS.INVALID_TRANSITION, {
        from: current.status,
        to: 'WITHDRAWN',
      });
    }

    return toSummary(updated);
  }

  /** 화면이 지원/철회/없음 중 무엇을 그릴지 정하는 데 쓴다 (AC5) */
  async findMine(
    jobPostId: string,
    applicantId: string,
  ): Promise<ApplicationSummary | null> {
    const row = await this.store.findByApplicant(jobPostId, applicantId);
    return row === null ? null : toSummary(row);
  }

  /**
   * 이미 행이 있을 때. 철회한 것이면 되살리고, 아니면 중복 지원이다.
   *
   * 되살리면서 `appliedVersion`을 **지금 버전으로 다시 찍는다** — 철회한 뒤
   * 공고가 바뀌었는데 옛 버전이 남으면 본 적 없는 조건에 동의한 것이 된다.
   */
  private async reviveOrReject(
    existing: ApplicationRecord,
    version: number,
  ): Promise<ApplicationSummary> {
    if (existing.status !== 'WITHDRAWN') {
      throw new ApplicationError(APPLICATION_ERRORS.ALREADY_APPLIED, {
        status: existing.status,
      });
    }

    const revived = await this.store.reapply({
      applicationId: existing.id,
      appliedVersion: version,
    });

    if (revived === 'STALE') {
      // 동시 재지원 2건 중 진 쪽이다. 이미 살아난 신청이 있다.
      throw new ApplicationError(APPLICATION_ERRORS.ALREADY_APPLIED);
    }

    return toSummary(revived);
  }
}

/** 상태를 옮긴다. **표에 없으면 거부한다** */
export function transition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): ApplicationStatus {
  if (!canApplicationTransition(from, to)) {
    throw new ApplicationError(APPLICATION_ERRORS.INVALID_TRANSITION, {
      from,
      to,
    });
  }
  return to;
}

function toSummary(row: ApplicationRecord): ApplicationSummary {
  return {
    id: row.id,
    jobPostId: row.jobPostId,
    applicantId: row.applicantId,
    status: row.status,
    appliedVersion: row.appliedVersion,
    createdAt: row.createdAt.toISOString(),
  };
}
