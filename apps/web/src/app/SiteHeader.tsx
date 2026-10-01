'use client';

import { myProfileSchema } from '@fixer/shared';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import NotificationBell from './NotificationBell';
import styles from './SiteHeader.module.css';

/** 묻는 중이면 아무것도 그리지 않는다. 로그인했는데 "로그인"이 깜빡이면 안 된다 */
type Session =
  | { state: 'checking' }
  | { state: 'guest' }
  | { state: 'member'; name: string };

/**
 * 모든 화면의 공통 헤더 — 홈 링크, 로그인 상태, 알림 벨. (이슈 #84)
 *
 * `layout.tsx`는 서버 컴포넌트라 브라우저가 `/api/auth/me`를 불러야 아는
 * 로그인 상태를 그릴 수 없다. 그래서 클라이언트 컴포넌트로 뺐다.
 *
 * 로그인 상태는 쿠키가 아니라 `/api/auth/me`로 판단한다 (#83). 200이 아니면
 * 전부 비로그인이다.
 */
export default function SiteHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session>({ state: 'checking' });

  /**
   * 화면을 옮길 때마다 다시 묻는다. 레이아웃은 화면을 옮겨도 다시 마운트되지
   * 않으므로, 처음 한 번만 물으면 `/login`에서 로그인하고 `/my`로 가도 헤더가
   * 계속 "로그인"을 띄운다.
   */
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/auth/me');
        if (cancelled) return;
        if (!res.ok) {
          setSession({ state: 'guest' });
          return;
        }
        const json: unknown = await res.json();
        if (cancelled) return;
        setSession({ state: 'member', name: myProfileSchema.parse(json).name });
      } catch {
        if (!cancelled) setSession({ state: 'guest' });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  /** 마이페이지 로그아웃과 같다 (`my/page.tsx`의 `logout` 주석 참고) */
  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // 무시하고 아래로 간다
    }
    router.refresh();
    router.replace('/login');
  }

  return (
    <header className={styles.header}>
      <Link className={styles.home} href="/">
        fixer
      </Link>

      <div className={styles.actions}>
        {session.state === 'member' && (
          <>
            <span className={styles.name}>{session.name}</span>
            <button className={styles.action} type="button" onClick={logout}>
              로그아웃
            </button>
          </>
        )}
        {session.state === 'guest' && (
          <Link className={styles.action} href="/login">
            로그인
          </Link>
        )}
        <NotificationBell />
      </div>
    </header>
  );
}
