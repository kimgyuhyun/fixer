import { Injectable } from '@nestjs/common';
import {
  ADMIN_ERRORS,
  JOB_POST_ERRORS,
  JOB_POST_PAGE_SIZE,
  cancelIdempotencyKey,
  type AdminErrorCode,
  type AdminJobPostFilter,
  type AdminJobPostList,
  type AdminJobPostSummary,
  type CancelJobPostResult,
} from '@fixer/shared';
import {
  JobPostError,
  transition,
  type AcceptedCounter,
  type JobPostRecord,
  type JobPostStore,
} from '../job-post/job-post.service';

/** 관리자 계층이 던지는 도메인 에러 */
export class AdminError extends Error {
  constructor(readonly code: AdminErrorCode) {
    super(code);
    this.name = 'AdminError';
  }
}

/** 목록 한 줄에 필요한 이름들. 조인해서 함께 온다 */
export type AdminJobPostRow = JobPostRecord & {
  employerName: string;
  categoryName: string;
};

/**
 * 관리자 공고 목록 저장소.
 *
 * 일반 목록(`JobPostStore.listOpen`)과 나눈 이유가 둘이다. 관리자는 `OPEN`이
 * 아닌 공고도 보고, 검색어가 제목뿐 아니라 **구인자 이름**에도 걸린다.
 */
export interface AdminJobPostStore {
  /**
   * 상태 무관 한 페이지. 구인자 이름과 카테고리 이름을 **함께 조인해서** 준다.
   *
   * 목록을 그린 뒤 화면이 이름을 따로 불러오면 한 페이지에 20번을 더 부른다.
   */
  listAll(
    filter: AdminJobPostFilter,
    pageSize: number,
  ): Promise<{ items: AdminJobPostRow[]; total: number }>;
}

/**
 * 관리자의 공고 관리. (이슈 #35, `spec-fixed.md` §11.6)
 *
 * 강제 취소는 #16의 `cancelAndRelease`를 그대로 탄다 — 유일한 차이는
 * **소유자 확인을 하지 않는 것**이고, 대신 사유와 감사 로그가 필수다.
 */
@Injectable()
export class AdminJobPostService {
  constructor(
    private readonly admins: AdminJobPostStore,
    private readonly posts: JobPostStore,
    private readonly accepted: AcceptedCounter,
  ) {}

  async list(filter: AdminJobPostFilter): Promise<AdminJobPostList> {
    const { items, total } = await this.admins.listAll(
      filter,
      JOB_POST_PAGE_SIZE,
    );
    return {
      items: items.map(toAdminSummary),
      total,
      page: filter.page,
      pageSize: JOB_POST_PAGE_SIZE,
    };
  }

  /**
   * 사유를 남기고 강제 취소한다. 잠긴 포인트는 전액 되돌아간다 (AC3).
   *
   * #16의 본인 취소와 다른 점은 **소유자 확인을 하지 않는 것** 하나다.
   * 대신 사유가 필수이고, 감사 로그가 취소와 같은 트랜잭션에 실린다 (AC4).
   */
  async forceCancel(input: {
    adminId: string;
    jobPostId: string;
    reason: string;
  }): Promise<CancelJobPostResult> {
    const reason = input.reason.trim();
    // 사유 검증이 가장 먼저다. 사유 없는 조치는 저장소도 원장도 안 건드린다.
    if (reason === '') {
      throw new AdminError(ADMIN_ERRORS.REASON_REQUIRED);
    }

    const current = await this.posts.findById(input.jobPostId);
    if (current === null) {
      throw new JobPostError(JOB_POST_ERRORS.NOT_FOUND);
    }

    // 표에 없는 전이는 거부된다 (ADR-JOB-3). 이미 취소된 공고도 여기서 걸린다.
    // 저장소를 부르기 전에 걸리므로 **조치가 없었는데 로그만 남는 일이 없다.**
    transition(current.status, 'CANCELLED');

    // 아무도 수락되지 않았으면 피해자가 없다. 누가 눌렀든 규칙은 #16과 같다 —
    // 일하기로 한 사람 입장에서는 똑같이 약속이 깨진 것이다.
    const penalize = (await this.accepted.countAccepted(current.id)) > 0;

    const result = await this.posts.cancelAndRelease({
      jobPostId: current.id,
      employerId: current.employerId,
      expectedStatus: current.status,
      penalize,
      // **#16과 같은 키다.** 본인이 취소하든 관리자가 취소하든 그 공고의
      // 잠긴 돈은 한 번만 풀려야 한다.
      idempotencyKey: cancelIdempotencyKey(current.id),
      audit: { adminId: input.adminId, reason },
    });

    if (result === 'STALE') {
      // 우리가 읽은 뒤 누군가 상태를 바꿨다. 덮어쓰지 않고 거절한다.
      throw new JobPostError(JOB_POST_ERRORS.INVALID_TRANSITION, {
        from: current.status,
        to: 'CANCELLED',
      });
    }

    return {
      id: current.id,
      status: 'CANCELLED',
      released: result.released,
      penalized: penalize,
    };
  }
}

function toAdminSummary(row: AdminJobPostRow): AdminJobPostSummary {
  return {
    id: row.id,
    title: row.title,
    employerName: row.employerName,
    categoryName: row.categoryName,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}
