'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  adminExchangeFilterSchema,
  type AdminExchangeList as AdminExchangeListData,
} from '@fixer/shared';
import { AdminExchangeList } from './AdminExchangeList';
import styles from './page.module.css';

/**
 * 관리자 환전 관리 페이지. (이슈 #34)
 *
 * **`Suspense`가 필요한 이유:** 필터를 `useSearchParams()`로 읽는데 그 훅은
 * 프리렌더 시점에 값을 알 수 없어 Next가 경계를 요구한다. 경계가 없으면
 * 빌드가 이 페이지에서 멈춘다 — #35·#13과 같은 이유다.
 */
export default function AdminExchangeRequestsPage() {
  return (
    <Suspense
      fallback={
        <main className={styles.page}>
          <p className={styles.total}>불러오는 중…</p>
        </main>
      }
    >
      <AdminExchangeRequests />
    </Suspense>
  );
}

const EMPTY: AdminExchangeListData = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
};

function AdminExchangeRequests() {
  const params = useSearchParams();
  const query = params.toString();
  const [data, setData] = useState<AdminExchangeListData>(EMPTY);
  // 관리자인지는 API가 판정한다. middleware는 로그인 여부까지만 본다.
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/admin/exchange-requests?${query}`);
      if (cancelled) return;
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (res.ok) setData((await res.json()) as AdminExchangeListData);
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <AdminExchangeList
      items={data.items}
      total={data.total}
      page={data.page}
      pageSize={data.pageSize}
      filter={adminExchangeFilterSchema.parse(
        Object.fromEntries(params.entries()),
      )}
      forbidden={forbidden}
    />
  );
}
