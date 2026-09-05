'use client';

import {
  applicantListSchema,
  formatRating,
  type ApplicantList as ApplicantListData,
  type ApplicationStatus,
} from '@fixer/shared';
import { useCallback, useEffect, useState } from 'react';
import styles from './ApplicantList.module.css';

/** 상태를 사람 말로. 코드가 그대로 보이면 무슨 뜻인지 알 수 없다 */
const STATUS_LABELS: Partial<Record<ApplicationStatus, string>> = {
  APPLIED: '지원함',
  ACCEPTED: '수락됨',
};

/**
 * 구인자가 보는 지원자 목록. (이슈 #18)
 *
 * 지원자마다 이름 · 평점 · 상태를 보여주고, 수락할 수 있는 사람에게만
 * **수락** 버튼을 그린다.
 *
 * | 조건                           | 수락 버튼   |
 * | ------------------------------ | ----------- |
 * | 상태가 `APPLIED`이고 자리 있음 | 있음        |
 * | 상태가 `ACCEPTED`              | 없음        |
 * | `acceptedCount === headcount`  | 없음 (전원) |
 *
 * 버튼을 감추는 것은 편의지 방어가 아니다. **정원 판정은 서버가 한다** —
 * 화면에서 막아도 탭 두 개로 동시에 누르면 그대로 요청이 나간다 (§4.4).
 */
export function ApplicantList({
  jobPostId,
}: {
  jobPostId: string;
}): React.JSX.Element {
  // #4의 토큰 주체로 바꾸기 전까지는 손으로 받는다 (ApplyPanel과 같다)
  const [employerId, setEmployerId] = useState('');
  const [list, setList] = useState<ApplicantListData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const query = new URLSearchParams({ jobPostId, employerId });
    const res = await fetch(`/api/applications?${query.toString()}`);
    if (!res.ok) throw new Error('지원자 목록을 불러오지 못했습니다.');
    setList(applicantListSchema.parse(await res.json()));
  }, [jobPostId, employerId]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        await load();
      } catch {
        if (!cancelled) setError('지원자 목록을 불러오지 못했습니다.');
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function accept(applicationId: string): Promise<void> {
    setError(null);
    try {
      const res = await fetch(`/api/applications/${applicationId}/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ employerId }),
      });
      if (!res.ok) {
        setError(messageOf(await res.json()));
        return;
      }
      // 수락은 목록의 상태와 확정 인원을 함께 바꾼다. 한 건만 갈아끼우면
      // "3 / 6"이 옛 숫자로 남는다.
      await load();
    } catch {
      setError('요청을 처리하지 못했습니다.');
    }
  }

  /**
   * 업무 완료를 확인한다 (#23). 확정 인원분이 지급되고 나머지는 돌아온다.
   *
   * **시스템은 일이 끝났는지 알 방법이 없다** — 출퇴근 체크도 GPS도 없어서
   * 구인자의 확인이 유일한 신호다 (`ADR-APP-5`).
   */
  async function complete(): Promise<void> {
    setError(null);
    try {
      const res = await fetch('/api/applications/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobPostId, employerId }),
      });
      if (!res.ok) {
        setError(messageOf(await res.json()));
        return;
      }
      // 완료 확인은 신청 상태를 통째로 바꾼다. 다시 읽지 않으면 화면에
      // "수락됨"이 남는다.
      await load();
    } catch {
      setError('요청을 처리하지 못했습니다.');
    }
  }

  const full = list !== null && list.acceptedCount >= list.headcount;

  return (
    <section className={styles.panel}>
      <label className={styles.label} htmlFor="employerId">
        내 회원 id
      </label>
      <input
        className={styles.input}
        id="employerId"
        value={employerId}
        onChange={(e) => setEmployerId(e.target.value)}
      />

      {list !== null && (
        <p className={styles.seats}>
          {list.acceptedCount} / {list.headcount}
        </p>
      )}

      <ul className={styles.list}>
        {list?.applicants.map((applicant) => (
          <li className={styles.row} key={applicant.applicationId}>
            <span className={styles.name}>{applicant.applicantName}</span>
            <span className={styles.rating}>
              {formatRating(applicant.ratingAsWorker, applicant.ratingCount)}
            </span>
            <span className={styles.status}>
              {STATUS_LABELS[applicant.status] ?? applicant.status}
            </span>
            {applicant.status === 'APPLIED' && !full && (
              <button
                className={styles.accept}
                type="button"
                onClick={() => void accept(applicant.applicationId)}
              >
                수락
              </button>
            )}
          </li>
        ))}
      </ul>

      {list !== null && (
        <button
          className={styles.complete}
          type="button"
          onClick={() => void complete()}
        >
          완료 확인
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
