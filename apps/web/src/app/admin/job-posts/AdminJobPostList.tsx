'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import {
  JOB_POST_STATUSES,
  type AdminJobPostFilter,
  type AdminJobPostSummary,
  type JobPostStatus,
} from '@fixer/shared';
import styles from './page.module.css';

export interface AdminJobPostListProps {
  items: AdminJobPostSummary[];
  total: number;
  page: number;
  pageSize: number;
  filter: AdminJobPostFilter;
  /** 403을 받았다. 표 대신 안내를 그린다 */
  forbidden?: boolean;
}

/** 상태 코드를 사람이 읽는 말로. 화면에 `CANCELLED`가 그대로 뜨면 안 된다 */
const STATUS_LABELS: Record<JobPostStatus, string> = {
  DRAFT: '작성 중',
  OPEN: '모집 중',
  CLOSED: '모집 마감',
  COMPLETED: '완료',
  CANCELLED: '취소됨',
  EXPIRED: '기간 만료',
};

/**
 * 관리자 공고 목록과 강제 취소. (이슈 #35, `spec-fixed.md` §11.6)
 *
 * **필터 상태의 진실은 URL 하나다** (ADR-JOB-4). 컴포넌트가 따로 들고 있으면
 * 뒤로가기에서 둘이 어긋난다.
 */
export function AdminJobPostList({
  items,
  total,
  forbidden,
}: AdminJobPostListProps): ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const [target, setTarget] = useState<AdminJobPostSummary | null>(null);
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

  async function confirmCancel(): Promise<void> {
    if (target === null) return;
    await fetch(`/api/admin/job-posts/${target.id}/cancel`, {
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
      <h1 className={styles.title}>공고 관리</h1>

      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          submitFilter({
            q: String(form.get('q') ?? ''),
            status: String(form.get('status') ?? ''),
          });
        }}
      >
        <label className={styles.field}>
          검색
          <input
            name="q"
            type="search"
            defaultValue={params.get('q') ?? ''}
            placeholder="제목 또는 구인자 이름"
          />
        </label>
        <label className={styles.field}>
          상태
          <select name="status" defaultValue={params.get('status') ?? ''}>
            <option value="">전체</option>
            {JOB_POST_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">검색</button>
      </form>

      <p className={styles.total}>총 {total}건</p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">제목</th>
              <th scope="col">구인자</th>
              <th scope="col">카테고리</th>
              <th scope="col">상태</th>
              <th scope="col">등록일</th>
              <th scope="col">조치</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.title}</td>
                <td>{item.employerName}</td>
                <td>{item.categoryName}</td>
                <td className={styles.center}>{STATUS_LABELS[item.status]}</td>
                <td className={styles.center}>{item.createdAt.slice(0, 10)}</td>
                <td className={styles.center}>
                  <button type="button" onClick={() => setTarget(item)}>
                    강제 취소
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {target !== null && (
        <div className={styles.dialog} role="dialog" aria-label="강제 취소">
          <p>
            <strong>{target.title}</strong>을(를) 취소합니다. 잠긴 포인트는 전액
            되돌아갑니다.
          </p>
          <label className={styles.field}>
            취소 사유
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className={styles.actions}>
            <button type="button" onClick={() => setTarget(null)}>
              닫기
            </button>
            {/* 사유 없는 조치는 감사 로그의 "왜"가 빈 채로 남는다 (§11.6) */}
            <button
              type="button"
              disabled={reason.trim() === ''}
              onClick={() => void confirmCancel()}
            >
              취소 확정
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
