'use client';

import { Suspense } from 'react';
import { JobPostList } from './JobPostList';
import styles from './page.module.css';

/**
 * 공고 목록 페이지. (이슈 #12 · #13)
 *
 * **`Suspense`가 필요한 이유:** 필터를 `useSearchParams()`로 읽는데(ADR-JOB-4),
 * 그 훅은 프리렌더 시점에 값을 알 수 없어 Next가 경계를 요구한다. 경계가
 * 없으면 빌드가 이 페이지에서 멈춘다.
 */
export default function JobPostListPage() {
  return (
    <Suspense
      fallback={
        <main className={styles.page}>
          <p className={styles.total}>불러오는 중…</p>
        </main>
      }
    >
      <JobPostList />
    </Suspense>
  );
}
