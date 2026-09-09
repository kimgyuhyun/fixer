'use client';

import type { ReactElement } from 'react';
import type {
  AdminExchangeFilter,
  AdminExchangeRequestSummary,
} from '@fixer/shared';

export interface AdminExchangeListProps {
  items: AdminExchangeRequestSummary[];
  total: number;
  page: number;
  pageSize: number;
  filter: AdminExchangeFilter;
  /** 403을 받았다. 표 대신 안내를 그린다 (#35와 같다) */
  forbidden?: boolean;
}

/**
 * 관리자 환전 요청 목록. (이슈 #34, `spec-fixed.md` §11.5)
 *
 * **계좌번호는 기본이 마스킹이다.** 전체는 별도 버튼으로만 열리고, 그
 * 열람은 서버에 감사 로그로 남는다.
 */
export function AdminExchangeList(props: AdminExchangeListProps): ReactElement {
  throw new Error('not implemented');
}
