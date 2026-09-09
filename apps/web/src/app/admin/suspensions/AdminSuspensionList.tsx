'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import type {
  AdminSuspensionFilter,
  AdminSuspensionSummary,
  PenaltyReason,
} from '@fixer/shared';
import styles from './page.module.css';

export interface AdminSuspensionListProps {
  items: AdminSuspensionSummary[];
  total: number;
  page: number;
  pageSize: number;
  filter: AdminSuspensionFilter;
  /** 403을 받았다. 표 대신 안내를 그린다 */
  forbidden?: boolean;
}

/** 사유 코드를 사람이 읽는 말로. 화면에 `NO_SHOW`가 그대로 뜨면 안 된다 */
const REASON_LABELS: Record<PenaltyReason, string> = {
  NO_SHOW: '무단 불참',
  LATE_CANCEL: '지각 취소',
  SAME_DAY_CANCEL: '당일 취소',
  POSTER_CANCEL: '구인자 취소',
};

/**
 * 블랙리스트와 제재 조기 해제. (이슈 #33, `spec-fixed.md` §11.4)
 *
 * **필터 상태의 진실은 URL 하나다** (ADR-JOB-4). 컴포넌트가 따로 들고 있으면
 * 뒤로가기에서 둘이 어긋난다.
 */
export function AdminSuspensionList({
  items,
  total,
  forbidden,
}: AdminSuspensionListProps): ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const [target, setTarget] = useState<AdminSuspensionSummary | null>(null);
  const [reason, setReason] = useState('');

  if (forbidden) {
    return (
      <main className={styles.page}>
        <p className={styles.notice}>권한이 없습니다.</p>
      </main>
    );
  }

  function submitFilter(next: Record<string, string>): void {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === '') query.delete(key);
      else query.set(key, value);
    }
    // 필터를 바꾸면 첫 페이지로 돌아간다. 3페이지에서 좁히면 빈 화면이 된다.
    query.delete('page');
    router.replace(`?${query.toString()}`);
  }

  async function confirmRelease(): Promise<void> {
    if (target === null) return;
    await fetch(`/api/admin/suspensions/${target.id}/release`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    setTarget(null);
    setReason('');
    router.refresh();
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>블랙리스트</h1>

      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          submitFilter({ q: String(form.get('q') ?? '') });
        }}
      >
        <label className={styles.field}>
          검색
          <input
            name="q"
            type="search"
            defaultValue={params.get('q') ?? ''}
            placeholder="회원 이름"
          />
        </label>
        <button type="submit">검색</button>
      </form>

      <p className={styles.total}>총 {total}건</p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">이름</th>
              <th scope="col">제재 시작</th>
              <th scope="col">제재 종료</th>
              <th scope="col">사유 요약</th>
              <th scope="col">누적 경고</th>
              <th scope="col">조치</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.userName}</td>
                <td className={styles.center}>{item.startAt.slice(0, 10)}</td>
                <td className={styles.center}>{item.endAt.slice(0, 10)}</td>
                <td>
                  {item.reasons.map((code) => REASON_LABELS[code]).join(', ')}
                </td>
                <td className={styles.number}>{item.penaltyCount}</td>
                <td className={styles.center}>
                  <button type="button" onClick={() => setTarget(item)}>
                    제재 해제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {target !== null && (
        <div className={styles.dialog} role="dialog" aria-label="제재 해제">
          <p>
            <strong>{target.userName}</strong>님의 제재를 해제합니다. 원본 경고
            이력은 그대로 남습니다.
          </p>
          <label className={styles.field}>
            해제 사유
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className={styles.actions}>
            <button type="button" onClick={() => setTarget(null)}>
              닫기
            </button>
            {/* 사유 없는 조치는 감사 로그의 "왜"가 빈 채로 남는다 (§11.4) */}
            <button
              type="button"
              disabled={reason.trim() === ''}
              onClick={() => void confirmRelease()}
            >
              해제 확정
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
