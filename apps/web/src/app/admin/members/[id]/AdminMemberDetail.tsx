'use client';

import type { ReactElement } from 'react';
import type { AdminMemberDetail as AdminMemberDetailData } from '@fixer/shared';

export interface AdminMemberDetailProps {
  member: AdminMemberDetailData | null;
  /** 403을 받았다. 상세 대신 안내를 그린다 */
  forbidden?: boolean;
}

/**
 * 관리자 회원 상세. (이슈 #32, `spec-fixed.md` §11.3)
 *
 * AC5가 요구하는 다섯 덩이(평점·리뷰·거래 이력·포인트·제재 이력)를 한 화면에
 * 그린다. 서버가 한 번에 주므로 여기서 덩이마다 부르지 않는다.
 */
export function AdminMemberDetail(
  _props: AdminMemberDetailProps,
): ReactElement {
  throw new Error('not implemented');
}
