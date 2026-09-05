'use client';

import {
  notificationItemSchema,
  notificationListSchema,
  type NotificationItem,
} from '@fixer/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import styles from './page.module.css';

/**
 * 알림 목록. (이슈 #36 AC2·AC3)
 *
 * 알림을 누르면 읽음 처리하고 응답의 `linkUrl`로 이동한다. 이동 경로를
 * 화면에서 조립하지 않고 서버가 준 것을 그대로 쓰는 이유는, 알림 종류가
 * 늘 때마다 화면에 분기를 더하지 않기 위해서다.
 */
export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/notifications/me');
        const json: unknown = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          setError('알림을 불러오지 못했습니다.');
          return;
        }
        setItems(notificationListSchema.parse(json).items);
      } catch {
        if (!cancelled) setError('알림을 불러오지 못했습니다.');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function open(item: NotificationItem) {
    try {
      const res = await fetch(`/api/notifications/${item.id}/read`, {
        method: 'POST',
      });
      const json: unknown = await res.json();
      // 읽음 처리가 실패해도 이동은 막지 않는다. 사용자가 보려던 것은
      // 읽음 표시가 아니라 그 화면이다.
      router.push(
        res.ok ? notificationItemSchema.parse(json).linkUrl : item.linkUrl,
      );
    } catch {
      router.push(item.linkUrl);
    }
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>알림</h1>

      {error !== null && <p className={styles.error}>{error}</p>}

      {items !== null && items.length === 0 && (
        <p className={styles.empty}>받은 알림이 없습니다.</p>
      )}

      {items !== null && items.length > 0 && (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <button
                className={item.read ? styles.item : styles.itemUnread}
                type="button"
                onClick={() => void open(item)}
              >
                <span className={styles.itemTitle}>{item.title}</span>
                <span className={styles.itemBody}>{item.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
