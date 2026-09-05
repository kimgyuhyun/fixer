'use client';

import type { AdminJobPostFilter, AdminJobPostSummary } from '@fixer/shared';

export interface AdminJobPostListProps {
  items: AdminJobPostSummary[];
  total: number;
  page: number;
  pageSize: number;
  filter: AdminJobPostFilter;
  /** 403을 받았다. 표 대신 안내를 그린다 */
  forbidden?: boolean;
}

/**
 * 관리자 공고 목록과 강제 취소. (이슈 #35, `spec-fixed.md` §11.6)
 *
 * 필터 상태의 진실은 URL 하나다 (ADR-JOB-4).
 */
export function AdminJobPostList(_props: AdminJobPostListProps) {
  throw new Error('not implemented');
}
