'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ReactElement } from 'react';
import {
  formatRating,
  type AdminMemberFilter,
  type AdminMemberStatus,
  type AdminMemberSummary,
} from '@fixer/shared';
import styles from './page.module.css';

export interface AdminMemberListProps {
  items: AdminMemberSummary[];
  total: number;
  page: number;
  pageSize: number;
  filter: AdminMemberFilter;
  /** 403을 받았다. 표 대신 안내를 그린다 (#33과 같다) */
  forbidden?: boolean;
}

/** 상태 코드를 사람이 읽는 말로. 화면에 `DEACTIVATED`가 그대로 뜨면 안 된다 */
const STATUS_LABELS: Record<AdminMemberStatus, string> = {
  ACTIVE: '정상',
  SUSPENDED: '제재중',
  DEACTIVATED: '비활성화',
};

/**
 * 관리자 회원 목록. (이슈 #32, `spec-fixed.md` §11.3)
 *
 * **필터 상태의 진실은 URL 하나다** (`ADR-JOB-4`). 컴포넌트가 따로 들고
 * 있으면 뒤로가기에서 둘이 어긋난다.
 */
export function AdminMemberList({
  items,
  total,
  forbidden,
}: AdminMemberListProps): ReactElement {
  const router = useRouter();
  const params = useSearchParams();

  if (forbidden === true) {
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

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>회원 관리</h1>

      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          submitFilter({
            q: String(form.get('q') ?? ''),
            // 시/도·시/군/구는 자유 입력이다. 지역 마스터 목록이 저장소에
            // 없어 #13이 이미 같은 판단을 했다.
            sido: String(form.get('sido') ?? ''),
            sigungu: String(form.get('sigungu') ?? ''),
          });
        }}
      >
        <label className={styles.field}>
          검색
          <input
            name="q"
            type="search"
            defaultValue={params.get('q') ?? ''}
            placeholder="이름 또는 이메일"
          />
        </label>
        <label className={styles.field}>
          시/도
          <input name="sido" defaultValue={params.get('sido') ?? ''} />
        </label>
        <label className={styles.field}>
          시/군/구
          <input name="sigungu" defaultValue={params.get('sigungu') ?? ''} />
        </label>
        <button type="submit">검색</button>
      </form>

      <p className={styles.total}>총 {total}건</p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">이름</th>
              <th scope="col">이메일</th>
              <th scope="col">가입일</th>
              <th scope="col">구인자 평점</th>
              <th scope="col">구직자 평점</th>
              <th scope="col">경고 수</th>
              <th scope="col">상태</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  {/* 행을 클릭하면 상세로 간다 (AC5) */}
                  <Link href={`/admin/members/${item.id}`}>{item.name}</Link>
                </td>
                <td>{item.email}</td>
                <td className={styles.center}>{item.joinedAt.slice(0, 10)}</td>
                <td className={styles.center}>
                  {formatRating(item.asPoster.average, item.asPoster.count)}
                </td>
                <td className={styles.center}>
                  {formatRating(item.asWorker.average, item.asWorker.count)}
                </td>
                <td className={styles.number}>{item.penaltyCount}</td>
                <td className={styles.center}>
                  {/* 비활성화 회원은 사라지지 않고 배지로 남는다 (§2.6, AC4) */}
                  <span
                    className={
                      item.status === 'ACTIVE' ? styles.badge : styles.badgeWarn
                    }
                  >
                    {STATUS_LABELS[item.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
