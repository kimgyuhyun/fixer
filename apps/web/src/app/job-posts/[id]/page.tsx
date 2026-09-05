'use client';

import { use } from 'react';
import { JobPostDetail } from './JobPostDetail';

/**
 * 공고 상세 페이지. (이슈 #14)
 *
 * Next 16의 `params`는 Promise라 `use()`로 푼다. **본체를 따로 둔 이유**는
 * `use()`가 프라미스를 기다리며 렌더를 멈추기 때문이다 — 그 상태로는
 * 테스트가 화면을 못 본다. 껍데기만 기다리고 본체는 id를 받는다.
 */
export default function JobPostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <JobPostDetail id={id} />;
}
