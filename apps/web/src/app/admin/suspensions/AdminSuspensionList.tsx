'use client';

import type { ReactElement } from 'react';
import type {
  AdminSuspensionFilter,
  AdminSuspensionSummary,
} from '@fixer/shared';

export interface AdminSuspensionListProps {
  items: AdminSuspensionSummary[];
  total: number;
  page: number;
  pageSize: number;
  filter: AdminSuspensionFilter;
  /** 403을 받았다. 표 대신 안내를 그린다 */
  forbidden?: boolean;
}

/**
 * 블랙리스트와 제재 조기 해제. (이슈 #33, `spec-fixed.md` §11.4)
 *
 * **필터 상태의 진실은 URL 하나다** (ADR-JOB-4).
 */
export function AdminSuspensionList(
  props: AdminSuspensionListProps,
): ReactElement {
  throw new Error('not implemented');
}
