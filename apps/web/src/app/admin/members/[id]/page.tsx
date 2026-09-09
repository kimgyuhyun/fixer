'use client';

import { use, useEffect, useState } from 'react';
import type { AdminMemberDetail as AdminMemberDetailData } from '@fixer/shared';
import { AdminMemberDetail } from './AdminMemberDetail';

/**
 * 관리자 회원 상세 페이지. (이슈 #32, `spec-fixed.md` §11.3)
 *
 * Next 16의 `params`는 Promise라 `use()`로 푼다. 본체를 따로 두는 이유는
 * `use()`가 프라미스를 기다리며 렌더를 멈추기 때문이다 (#14와 같다).
 */
export default function AdminMemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <AdminMemberFetcher id={id} />;
}

function AdminMemberFetcher({ id }: { id: string }) {
  const [member, setMember] = useState<AdminMemberDetailData | null>(null);
  // 관리자인지는 API가 판정한다. middleware는 로그인 여부까지만 본다.
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/admin/members/${id}`);
      if (cancelled) return;
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (res.ok) setMember((await res.json()) as AdminMemberDetailData);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return <AdminMemberDetail member={member} forbidden={forbidden} />;
}
