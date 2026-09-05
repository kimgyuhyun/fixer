'use client';

import { notificationListSchema } from '@fixer/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './NotificationBell.module.css';

/**
 * 헤더의 알림 벨. (이슈 #36 AC1·AC3)
 *
 * 스스로 목록을 부른다 — 어느 화면에 얹혀도 회원 id를 넘겨받을 필요가 없다.
 * 미읽음이 0이면 **숫자를 아예 그리지 않는다** (AC3). 0을 그리면 "알림이
 * 0건 있다"처럼 보인다.
 */
export default function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/notifications/me');
        if (!res.ok) return;
        const json: unknown = await res.json();
        if (cancelled) return;
        setUnreadCount(notificationListSchema.parse(json).unreadCount);
      } catch {
        // 로그인 전이거나 API가 죽었다. 헤더는 그대로 두고 숫자만 안 그린다 —
        // 벨 때문에 화면 전체가 깨지면 안 된다.
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Link className={styles.bell} href="/notifications" aria-label="알림">
      알림
      {unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
    </Link>
  );
}
