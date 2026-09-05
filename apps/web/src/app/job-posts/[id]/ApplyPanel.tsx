'use client';

import {
  applicationSummarySchema,
  type ApplicationStatus,
  type ApplicationSummary,
} from '@fixer/shared';
import { useEffect, useState } from 'react';
import styles from './ApplyPanel.module.css';

/** 상태를 사람 말로. 코드가 그대로 보이면 무슨 뜻인지 알 수 없다 */
const STATUS_LABELS: Record<ApplicationStatus, string> = {
  APPLIED: '지원함',
  ACCEPTED: '수락됨',
  REJECTED: '거절됨',
  WITHDRAWN: '철회함',
  PENDING_REACCEPT: '재동의 대기',
  COMPLETED: '완료',
  CANCELLED_FREE: '취소됨',
  CANCELLED_PENALTY: '취소됨',
  CANCELLED_BY_VERSION_CHANGE: '조건 변경으로 취소됨',
  NO_SHOW: '불참',
};

/**
 * 지원과 철회. (이슈 #17)
 *
 * 내 신청 상태에 따라 셋 중 하나를 그린다.
 *
 * | 상태                | 그리는 것                        |
 * | ------------------- | -------------------------------- |
 * | 없음 / `WITHDRAWN`  | **지원하기** 버튼                |
 * | `APPLIED`           | **지원 철회** 버튼               |
 * | 그 외 (`ACCEPTED`…) | 상태 문구만. **버튼 없음** (AC5) |
 *
 * `ACCEPTED`에 철회 버튼이 없는 것은 취소가 #20의 규칙(무상 취소 창)을
 * 따르기 때문이다. 여기서 철회로 처리하면 그 판정을 건너뛴다.
 */
export function ApplyPanel({
  jobPostId,
}: {
  jobPostId: string;
}): React.JSX.Element {
  // #4의 토큰 주체로 바꾸기 전까지는 손으로 받는다 (job-posts/new와 같다)
  const [applicantId, setApplicantId] = useState('');
  const [mine, setMine] = useState<ApplicationSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const query = new URLSearchParams({ jobPostId, applicantId });
        const res = await fetch(`/api/applications/me?${query.toString()}`);
        if (cancelled) return;

        if (res.status === 404) {
          // 아직 지원한 적이 없다. 오류가 아니다.
          setMine(null);
        } else if (!res.ok) {
          throw new Error('내 신청을 불러오지 못했습니다.');
        } else {
          setMine(applicationSummarySchema.parse(await res.json()));
        }
      } catch {
        if (!cancelled) setError('내 신청을 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [jobPostId, applicantId]);

  async function send(path: string, body: unknown) {
    setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        setError(messageOf(json));
        return;
      }
      setMine(applicationSummarySchema.parse(json));
    } catch {
      setError('요청을 처리하지 못했습니다.');
    }
  }

  const status = mine?.status ?? null;
  // 철회한 신청은 되살릴 수 있다 (§4.2 개정). 화면은 "없음"과 같아 보이지만
  // 서버는 새 행을 만드는 대신 있던 행을 되살린다.
  const canApply = loaded && (status === null || status === 'WITHDRAWN');
  const canWithdraw = status === 'APPLIED';

  return (
    <section className={styles.panel}>
      <label className={styles.label} htmlFor="applicantId">
        내 회원 id
      </label>
      <input
        className={styles.input}
        id="applicantId"
        value={applicantId}
        onChange={(e) => setApplicantId(e.target.value)}
      />

      {status !== null && (
        <p className={styles.status}>{STATUS_LABELS[status]}</p>
      )}

      {canApply && (
        <button
          className={styles.apply}
          type="button"
          onClick={() =>
            void send('/api/applications', { applicantId, jobPostId })
          }
        >
          지원하기
        </button>
      )}

      {canWithdraw && (
        <button
          className={styles.withdraw}
          type="button"
          onClick={() =>
            void send(`/api/applications/${mine?.id ?? ''}/withdraw`, {
              applicantId,
            })
          }
        >
          지원 철회
        </button>
      )}

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function messageOf(json: unknown): string {
  const message = (json as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : '요청을 처리하지 못했습니다.';
}
