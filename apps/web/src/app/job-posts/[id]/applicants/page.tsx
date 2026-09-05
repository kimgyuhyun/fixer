'use client';

import { use } from 'react';
import { ApplicantList } from './ApplicantList';

/**
 * 지원자 목록 페이지. (이슈 #18)
 *
 * `[id]/page.tsx`와 같은 이유로 본체를 따로 둔다 — `use()`가 프라미스를
 * 기다리며 렌더를 멈추므로, 그 상태로는 테스트가 화면을 못 본다.
 */
export default function ApplicantsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <ApplicantList jobPostId={id} />;
}
