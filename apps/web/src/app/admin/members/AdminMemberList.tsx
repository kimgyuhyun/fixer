'use client';

import type { ReactElement } from 'react';
import type { AdminMemberFilter, AdminMemberSummary } from '@fixer/shared';

export interface AdminMemberListProps {
  items: AdminMemberSummary[];
  total: number;
  page: number;
  pageSize: number;
  filter: AdminMemberFilter;
  /** 403을 받았다. 표 대신 안내를 그린다 (#33과 같다) */
  forbidden?: boolean;
}

/**
 * 관리자 회원 목록. (이슈 #32, `spec-fixed.md` §11.3)
 *
 * **필터 상태의 진실은 URL 하나다** (`ADR-JOB-4`). 컴포넌트가 따로 들고
 * 있으면 뒤로가기에서 둘이 어긋난다.
 */
export function AdminMemberList(_props: AdminMemberListProps): ReactElement {
  throw new Error('not implemented');
}
