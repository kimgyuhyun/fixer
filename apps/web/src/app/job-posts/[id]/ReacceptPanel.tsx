'use client';

import {
  JOB_POST_REQUIRED_FIELD_LABELS,
  applicationSummarySchema,
  reacceptDiffSchema,
  type ApplicationSummary,
  type JobPostRequiredField,
  type ReacceptDiff,
} from '@fixer/shared';
import { useEffect, useState } from 'react';
import styles from './ReacceptPanel.module.css';

export interface ReacceptPanelProps {
  applicationId: string;
  applicantId: string;
  /** 재동의·거절이 끝나면 바뀐 신청을 위로 올린다. 화면이 다시 그려진다 */
  onSettled: (application: ApplicationSummary) => void;
}

/**
 * 바뀐 조건을 보고 재동의하거나 거절한다. (이슈 #22)
 *
 * `ApplyPanel`이 내 신청이 `PENDING_REACCEPT`일 때 그린다. #21의 알림이
 * 공고 상세로 보내므로 **그 화면에서 바로** 변경 전/후가 보여야 한다.
 *
 * **거절에는 경고가 없다** — 조건을 바꾼 것은 구인자이므로 신청자 귀책이
 * 아니다 (`spec-fixed.md` §3.4). 그래서 거절 버튼에 경고 문구를 달지 않는다.
 */
export function ReacceptPanel({
  applicationId,
  applicantId,
  onSettled,
}: ReacceptPanelProps): React.JSX.Element {
  const [diff, setDiff] = useState<ReacceptDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const query = new URLSearchParams({ applicantId });
        const res = await fetch(
          `/api/applications/${applicationId}/version-diff?${query.toString()}`,
        );
        if (cancelled) return;

        if (!res.ok) throw new Error('바뀐 조건을 불러오지 못했습니다.');
        setDiff(reacceptDiffSchema.parse(await res.json()));
      } catch {
        if (!cancelled) setError('바뀐 조건을 불러오지 못했습니다.');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [applicationId, applicantId]);

  async function send(action: 'reaccept' | 'decline') {
    setError(null);
    try {
      const res = await fetch(`/api/applications/${applicationId}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ applicantId }),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        setError(messageOf(json));
        return;
      }
      onSettled(applicationSummarySchema.parse(json));
    } catch {
      setError('요청을 처리하지 못했습니다.');
    }
  }

  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>공고 조건이 바뀌었습니다</h2>

      {diff !== null && (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">항목</th>
                <th scope="col">변경 전</th>
                <th scope="col">변경 후</th>
              </tr>
            </thead>
            <tbody>
              {diff.changedFields.map((field) => (
                <tr key={field}>
                  <th scope="row">{JOB_POST_REQUIRED_FIELD_LABELS[field]}</th>
                  <td>{display(field, diff.before[field])}</td>
                  <td>{display(field, diff.after[field])}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.actions}>
            <button
              className={styles.reaccept}
              type="button"
              onClick={() => void send('reaccept')}
            >
              재동의
            </button>
            <button
              className={styles.decline}
              type="button"
              onClick={() => void send('decline')}
            >
              거절
            </button>
          </div>
        </>
      )}

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** 값을 사람이 읽는 모양으로. 시각은 날짜로, 수는 자릿수를 끊어서 */
function display(field: JobPostRequiredField, value: string | number): string {
  if (field === 'workStartAt' || field === 'workEndAt') {
    return new Date(value).toLocaleString('ko-KR');
  }
  return typeof value === 'number' ? value.toLocaleString('ko-KR') : value;
}

function messageOf(json: unknown): string {
  const message = (json as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : '요청을 처리하지 못했습니다.';
}
