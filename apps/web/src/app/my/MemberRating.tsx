'use client';

import {
  formatRating,
  ratingSummarySchema,
  type RatingSummary,
} from '@fixer/shared';
import { useEffect, useState } from 'react';
import styles from './MemberRating.module.css';

/**
 * 내 평점 두 개를 나란히 보여준다. (이슈 #26, `spec-fixed.md` §7)
 *
 * 구인자로서와 구직자로서의 신뢰도는 별개라 **한 줄로 합치지 않는다** (§2.1).
 * 표시 규칙은 `formatRating` 하나뿐이다 — 표본 3건 미만이면 "신규"다.
 *
 * 못 불러오면 **아무것도 그리지 않는다.** 평점은 부가 정보라 마이페이지
 * 전체를 실패로 만들 이유가 없다.
 */
export function MemberRating({
  userId,
}: {
  userId: string;
}): React.JSX.Element | null {
  const [summary, setSummary] = useState<RatingSummary | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const res = await fetch(`/api/ratings/${userId}`);
        const parsed = ratingSummarySchema.parse(await res.json());
        if (!cancelled) setSummary(parsed);
      } catch {
        // 평점을 못 불러온 것뿐이다. 화면의 나머지는 그대로 둔다.
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (summary === null) return null;

  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>내 평점</h2>
      <dl className={styles.list}>
        <div className={styles.row}>
          <dt className={styles.label}>구인자 평점</dt>
          <dd className={styles.value}>
            {formatRating(summary.asPoster.average, summary.asPoster.count)}
            <span className={styles.count}>{summary.asPoster.count}건</span>
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>구직자 평점</dt>
          <dd className={styles.value}>
            {formatRating(summary.asWorker.average, summary.asWorker.count)}
            <span className={styles.count}>{summary.asWorker.count}건</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}
