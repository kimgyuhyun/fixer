'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  adminSuspensionFilterSchema,
  type AdminSuspensionList as AdminSuspensionListData,
} from '@fixer/shared';
import { AdminSuspensionList } from './AdminSuspensionList';
import styles from './page.module.css';

/**
 * 관리자 블랙리스트 페이지. (이슈 #33, `spec-fixed.md` §11.4)
 *
 * **`Suspense`가 필요한 이유:** 필터를 `useSearchParams()`로 읽는데(ADR-JOB-4),
 * 그 훅은 프리렌더 시점에 값을 알 수 없어 Next가 경계를 요구한다. 경계가
 * 없으면 빌드가 이 페이지에서 멈춘다 — 관리자 공고 목록(#35)과 같은 이유다.
 */
export default function AdminSuspensionsPage() {
  return (
    <Suspense
      fallback={
        <main className={styles.page}>
          <p className={styles.total}>불러오는 중…</p>
        </main>
      }
    >
      <AdminSuspensions />
    </Suspense>
  );
}

const EMPTY: AdminSuspensionListData = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
};

function AdminSuspensions() {
  const params = useSearchParams();
  const query = params.toString();
  const [data, setData] = useState<AdminSuspensionListData>(EMPTY);
  // 관리자인지는 API가 판정한다. middleware는 로그인 여부까지만 본다.
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/admin/suspensions?${query}`);
      if (cancelled) return;
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (res.ok) setData((await res.json()) as AdminSuspensionListData);
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <AdminSuspensionList
      items={data.items}
      total={data.total}
      page={data.page}
      pageSize={data.pageSize}
      filter={adminSuspensionFilterSchema.parse(
        Object.fromEntries(params.entries()),
      )}
      forbidden={forbidden}
    />
  );
}
