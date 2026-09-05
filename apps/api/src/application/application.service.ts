import { Injectable } from '@nestjs/common';
import {
  APPLICATION_ERRORS,
  EMPLOYER_VISIBLE_STATUSES,
  applyRequestSchema,
  canApplicationTransition,
  canTransition,
  completeJobPostRequestSchema,
  type ApplicantItem,
  type ApplicantList,
  type ApplicationErrorCode,
  type ApplicationStatus,
  type ApplicationSummary,
  type ApplyRequest,
  type CompleteJobPostRequest,
  type CompletionSummary,
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
  /** 수락 시각 (#18 AC1). 아직 수락 전이면 null */
  acceptedAt: Date | null;
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

  /**
   * 수락을 **한 트랜잭션으로** 확정한다 (#18, `ADR-APP-1`).
   *
   * 두 문장이 모두 1행을 갱신했을 때만 커밋한다 (§4.4).
   *
   * 1. `Application SET ACCEPTED, acceptedAt WHERE id=? AND status='APPLIED'`
   * 2. `JobPost SET acceptedCount+1 WHERE id=? AND acceptedCount < headcount`
   *
   * **신청 갱신이 먼저다.** 카운터를 먼저 올리면, 정원이 찬 공고에서 이미
   * 수락된 신청을 또 수락했을 때 "정원이 찼다"고 답하게 된다 — 실제 이유는
   * 중복 수락인데. 순서를 바꾸면 두 실패가 서로 구분된다.
   *
   * `'STALE'` = `APPLIED`가 아니다 (중복 수락·철회됨).
   * `'FULL'` = 정원이 찼다. **둘 다 아무것도 커밋하지 않는다.**
   */
  accept(input: {
    applicationId: string;
    jobPostId: string;
    acceptedAt: Date;
  }): Promise<ApplicationRecord | 'STALE' | 'FULL'>;

  /**
   * 완료 확인을 **한 트랜잭션으로** 확정한다 (#23, `ADR-PAY-4`).
   *
   * 1. `JobPost SET COMPLETED WHERE id=? AND status=?` → 0행이면 `'STALE'`
   * 2. `Application SET COMPLETED WHERE jobPostId=? AND status='ACCEPTED'`
   * 3. 확정 인원마다 구직자 `PAYOUT +rewardPerPerson`
   * 4. 남은 잠금액을 구인자에게 `RELEASE`
   *
   * **구인자의 `−` 행은 쓰지 않는다.** `HOLD`가 공고 `OPEN` 시점에 이미
   * 뺐다. 여기서 또 쓰면 같은 돈이 두 번 빠져 원장 합이 음수가 된다.
   *
   * 반환할 잠금액을 예산에서 다시 계산하지 않고 **그 공고를 참조하는 원장
   * 행의 합**을 쓴다 — #15가 예산을 고친 공고는 예산과 실제 잠금이 다르다
   * (`cancelAndRelease`와 같은 판단).
   *
   * `'STALE'` = 우리가 읽은 뒤 상태가 바뀌었다. **아무것도 커밋하지 않는다.**
   */
  completeAndSettle(input: {
    jobPostId: string;
    employerId: string;
    expectedStatus: JobPostStatus;
    rewardPerPerson: number;
  }): Promise<SettlementResult | 'STALE'>;

  /** 구인자의 지원자 목록. 오래 지원한 순 (선착순 표시지 선착순 수락은 아니다) */
  listByJobPost(
    jobPostId: string,
    statuses: readonly ApplicationStatus[],
  ): Promise<ApplicationRecord[]>;
}

/**
 * 지원자의 이름과 평점을 묻는 포트.
 *
 * `Rating`(#26)이 아직 없다. #12의 `AcceptedCounter`와 같은 방식으로 포트를
 * 지금 만들고, 어댑터는 이름만 진짜로 읽고 평점은 표본 0으로 돌려준다 —
 * **전원 "신규"가 보이는 것이 화면이 안 나오는 것보다 낫다.** #26이 어댑터만 채운다.
 */
export interface ApplicantProfileReader {
  profilesOf(
    applicantIds: readonly string[],
  ): Promise<Map<string, ApplicantProfile>>;
}

/** 완료 확인이 실제로 옮긴 돈 (#23) */
export interface SettlementResult {
  /** 지급받은 사람 수 */
  paidCount: number;
  /** 지급 총액 */
  paidTotal: number;
  /** 구인자에게 돌아간 미체결분 */
  releasedTotal: number;
}

/** 지원자 한 명의 표시용 정보 */
export interface ApplicantProfile {
  name: string;
  /** 구직자 평점 평균. 표본이 없으면 null */
  ratingAsWorker: number | null;
  /** 표본 수. 3건 미만이면 화면이 "신규"로 그린다 (§7) */
  ratingCount: number;
}

/**
 * 공고를 읽는 포트. **셋만 필요하다** — 상태·버전·주인.
 *
 * `JobPostService`를 통째로 주입하지 않는 이유는, 그러면 신청 도메인이
 * 공고의 등록·수정·취소에까지 닿게 되기 때문이다.
 */
export interface JobPostReader {
  /** 소프트 삭제된 공고는 **못 찾은 것으로 다룬다** (#14) */
  findForApplication(jobPostId: string): Promise<JobPostForApplication | null>;
}

/** 신청 판정에 필요한 공고 정보. #17의 셋에 #18이 둘을 더했다 */
export interface JobPostForApplication {
  id: string;
  employerId: string;
  status: JobPostStatus;
  version: number;
  /** 정원 (#18). 목록이 "3 / 6"을 그리는 데도 쓴다 */
  headcount: number;
  /** 확정 인원 (#18). 정원이 찼는지는 저장소의 조건부 UPDATE가 최종 판정한다 */
  acceptedCount: number;
  /** 1인당 보상금 (#23). 완료 확인이 확정 인원마다 이 금액을 지급한다 */
  rewardPerPerson: number;
}

/**
 * 지원·철회와 수락. (이슈 #17·#18, `spec-fixed.md` §4)
 *
 * 이 도메인이 "누가 누구와 무엇을 약속했는가"의 진실을 갖는다. 지금 다루는
 * 것은 **약속이 생기는 순간(#17), 수락 전에 무르는 순간(#17), 그리고 약속이
 * 체결되는 순간(#18)**까지다. 취소는 #20이 무상 취소 창을 정한 뒤에 온다.
 */
@Injectable()
export class ApplicationService {
  constructor(
    private readonly store: ApplicationStore,
    private readonly jobPosts: JobPostReader,
    private readonly profiles: ApplicantProfileReader,
  ) {}

  /** 구인자가 지원자 한 명을 수락한다. **이 순간이 계약 체결** (#18) */
  async accept(input: {
    employerId: string;
    applicationId: string;
  }): Promise<ApplicationSummary> {
    const current = await this.store.findById(input.applicationId);
    if (current === null) {
      throw new ApplicationError(APPLICATION_ERRORS.NOT_FOUND);
    }

    const post = await this.mustOwn(current.jobPostId, input.employerId);
    if (post.status !== 'OPEN') {
      // 취소된 공고는 RELEASE로 돈이 이미 풀렸다. 지급할 돈이 없는 계약이 된다.
      throw new ApplicationError(APPLICATION_ERRORS.JOB_POST_NOT_OPEN, {
        status: post.status,
      });
    }

    // 표에 없는 전이는 거부된다. 중복 수락(`ACCEPTED → ACCEPTED`)이 여기서 걸린다.
    transition(current.status, 'ACCEPTED');

    const accepted = await this.store.accept({
      applicationId: current.id,
      jobPostId: post.id,
      acceptedAt: new Date(),
    });

    if (accepted === 'STALE') {
      // 우리가 읽은 뒤 상태가 바뀌었다. 같은 신청을 동시에 수락한 쪽이 이겼다.
      throw new ApplicationError(APPLICATION_ERRORS.INVALID_TRANSITION, {
        from: current.status,
        to: 'ACCEPTED',
      });
    }
    if (accepted === 'FULL') {
      // 조건부 UPDATE가 0행을 셌다. **정원 판정의 진실은 여기다** (§4.4) —
      // 위에서 읽은 acceptedCount는 그 사이 이미 낡았을 수 있다.
      throw new ApplicationError(APPLICATION_ERRORS.HEADCOUNT_FULL, {
        headcount: post.headcount,
      });
    }

    return toSummary(accepted);
  }

  /**
   * 구인자가 업무 완료를 확인한다 (#23, `ADR-APP-5`).
   *
   * 확정 인원분은 구직자에게 `PAYOUT`되고 남은 잠금은 `RELEASE`된다.
   * **시스템은 일이 끝났는지 알 방법이 없다** — 출퇴근 체크도 GPS도 없으므로
   * 구인자의 확인이 유일한 신호다.
   */
  async complete(input: CompleteJobPostRequest): Promise<CompletionSummary> {
    const parsed = completeJobPostRequestSchema.parse(input);
    const post = await this.mustOwn(parsed.jobPostId, parsed.employerId);

    // 표에 없는 전이는 거부된다. 이미 완료된 공고를 또 확인하는 것이 여기서
    // 걸린다 — **1차 방어다.** 우리가 읽은 뒤 바뀐 경우는 저장소가 잡는다.
    if (!canTransition(post.status, 'COMPLETED')) {
      throw new ApplicationError(
        APPLICATION_ERRORS.JOB_POST_INVALID_TRANSITION,
        { from: post.status, to: 'COMPLETED' },
      );
    }

    const settled = await this.store.completeAndSettle({
      jobPostId: post.id,
      employerId: post.employerId,
      expectedStatus: post.status,
      rewardPerPerson: post.rewardPerPerson,
    });

    if (settled === 'STALE') {
      // 조건부 UPDATE가 0행을 셌다. 우리가 읽은 뒤 다른 경로가 상태를 바꿨고,
      // **아무것도 커밋되지 않았다.**
      throw new ApplicationError(
        APPLICATION_ERRORS.JOB_POST_INVALID_TRANSITION,
        { from: post.status, to: 'COMPLETED' },
      );
    }

    return { jobPostId: post.id, status: 'COMPLETED', ...settled };
  }

  /** 구인자가 보는 지원자 목록 (#18 AC1·AC2) */
  async listForEmployer(input: {
    employerId: string;
    jobPostId: string;
  }): Promise<ApplicantList> {
    const post = await this.mustOwn(input.jobPostId, input.employerId);

    const rows = await this.store.listByJobPost(
      post.id,
      EMPLOYER_VISIBLE_STATUSES,
    );
    const profiles = await this.profiles.profilesOf(
      rows.map((row) => row.applicantId),
    );

    return {
      jobPostId: post.id,
      headcount: post.headcount,
      acceptedCount: post.acceptedCount,
      applicants: rows.map((row) => toApplicantItem(row, profiles)),
    };
  }

  /**
   * 그 공고를 이 사람이 올렸는지 확인하고 공고를 돌려준다.
   *
   * 수락과 목록이 같은 확인을 한다. 없으면 **id만 알면 남의 공고에 사람을
   * 확정시킬 수 있다** — 돈이 잠긴 쪽은 그 공고 주인이다.
   */
  private async mustOwn(
    jobPostId: string,
    employerId: string,
  ): Promise<JobPostForApplication> {
    const post = await this.jobPosts.findForApplication(jobPostId);
    if (post === null) {
      throw new ApplicationError(APPLICATION_ERRORS.JOB_POST_NOT_FOUND);
    }
    if (post.employerId !== employerId) {
      throw new ApplicationError(APPLICATION_ERRORS.NOT_EMPLOYER);
    }
    return post;
  }

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

/**
 * 신청 한 건을 목록 항목으로. 이름과 평점이 프로필에서 온다.
 *
 * 프로필이 없는 경우는 `Application.applicantId`가 `onDelete: Cascade`라
 * 실제로는 생기지 않지만, 없을 때 화면이 안 나오는 것보다 빈 이름이 낫다.
 */
function toApplicantItem(
  row: ApplicationRecord,
  profiles: Map<string, ApplicantProfile>,
): ApplicantItem {
  const profile = profiles.get(row.applicantId);
  return {
    applicationId: row.id,
    applicantId: row.applicantId,
    applicantName: profile?.name ?? '',
    status: row.status,
    appliedVersion: row.appliedVersion,
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    ratingAsWorker: profile?.ratingAsWorker ?? null,
    ratingCount: profile?.ratingCount ?? 0,
  };
}

function toSummary(row: ApplicationRecord): ApplicationSummary {
  return {
    id: row.id,
    jobPostId: row.jobPostId,
    applicantId: row.applicantId,
    status: row.status,
    appliedVersion: row.appliedVersion,
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
  };
}
