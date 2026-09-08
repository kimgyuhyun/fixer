'use client';

import type { ApplicationSummary } from '@fixer/shared';

export interface ReacceptPanelProps {
  applicationId: string;
  applicantId: string;
  /** 재동의·거절이 끝나면 바뀐 신청을 위로 올린다. 화면이 다시 그려진다 */
  onSettled: (application: ApplicationSummary) => void;
}

/**
 * 바뀐 조건을 보고 재동의하거나 거절한다. (이슈 #22)
 *
 * `ApplyPanel`이 내 신청이 `PENDING_REACCEPT`일 때 그린다.
 */
export function ReacceptPanel(_props: ReacceptPanelProps): React.JSX.Element {
  throw new Error('not implemented');
}
