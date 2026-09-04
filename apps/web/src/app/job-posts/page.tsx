'use client';

import { jobPostListSchema, type JobPostSummary } from '@fixer/shared';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './page.module.css';

/**
 * 공고 목록. (이슈 #12)
 *
 * **`OPEN`만 보인다.** `DRAFT`는 예산이 잠기기 전이라 잠깐 스쳐가는
 * 상태이고, 취소·만료된 공고는 지원할 수 없다. 검색·필터·페이징은 #13이
 * 붙인다 — 그때 이 화면이 `FilterableList`를 쓴다.
 */
export default function JobPostListPage() {
  const [items, setItems] = useState<JobPostSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/job-posts');
        const json: unknown = await res.json();
        if (cancelled) return;
        // 상태를 먼저 본다. 스키마 파싱이 우연히 실패해 주는 것에 기대면,
        // 서버가 500과 함께 그럴듯한 모양을 주는 날 조용히 통과한다.
        if (!res.ok) throw new Error('목록 요청이 실패했습니다.');
        const list = jobPostListSchema.parse(json);
        setItems(list.items);
        setTotal(list.total);
      } catch {
        if (!cancelled) setError('공고를 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>일거리</h1>
        <Link className={styles.newLink} href="/job-posts/new">
          공고 올리기
        </Link>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {/* 총 건수는 #13의 페이징이 쓸 값이지만, 지금도 "몇 건 중 몇 건을
          보고 있나"를 사람이 알아야 한다. */}
      {loaded && !error && <p className={styles.total}>총 {total}건</p>}

      {loaded && !error && items.length === 0 ? (
        <p className={styles.empty}>아직 올라온 일거리가 없습니다.</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id} className={styles.card}>
              <h2 className={styles.cardTitle}>{item.title}</h2>
              <p className={styles.address}>{item.workAddress}</p>
              <dl className={styles.meta}>
                <div className={styles.metaRow}>
                  <dt>근무</dt>
                  <dd>
                    <time dateTime={item.workStartAt}>
                      {formatDateTime(item.workStartAt)}
                    </time>
                    {' ~ '}
                    <time dateTime={item.workEndAt}>
                      {formatDateTime(item.workEndAt)}
                    </time>
                  </dd>
                </div>
                <div className={styles.metaRow}>
                  <dt>모집</dt>
                  <dd>{item.headcount}명</dd>
                </div>
                <div className={styles.metaRow}>
                  <dt>1인당</dt>
                  <dd className={styles.reward}>
                    {item.rewardPerPerson.toLocaleString()}포인트
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/** 화면에 보일 일시. 서버가 준 ISO를 그대로 `dateTime`에 남긴다 */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
