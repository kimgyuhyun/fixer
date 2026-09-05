import { Injectable } from '@nestjs/common';
import type {
  AdminErrorCode,
  AdminJobPostFilter,
  AdminJobPostList,
  CancelJobPostResult,
} from '@fixer/shared';
import type {
  AcceptedCounter,
  JobPostRecord,
  JobPostStore,
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

  list(_filter: AdminJobPostFilter): Promise<AdminJobPostList> {
    throw new Error('not implemented');
  }

  forceCancel(_input: {
    adminId: string;
    jobPostId: string;
    reason: string;
  }): Promise<CancelJobPostResult> {
    throw new Error('not implemented');
  }
}
