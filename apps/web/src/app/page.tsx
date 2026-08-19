'use client';

import { useEffect, useState } from 'react';
import { healthResponseSchema, type HealthResponse } from '@fixer/shared';
import styles from './page.module.css';

type Probe =
  | { state: 'loading' }
  | { state: 'ok'; health: HealthResponse }
  | { state: 'error'; message: string };

export default function Home() {
  const [probe, setProbe] = useState<Probe>({ state: 'loading' });

  useEffect(() => {
    // 절대주소가 아니라 /api로 부른다. Next의 rewrites가 Nest로 넘겨주므로
    // 브라우저 입장에서는 같은 출처다.
    fetch('/api/health')
      .then((response) => response.json())
      .then((body) => healthResponseSchema.parse(body))
      .then((health) => setProbe({ state: 'ok', health }))
      .catch((error: unknown) =>
        setProbe({
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
  }, []);

  return (
    <main className={styles.page}>
      <div>
        <h1 className={styles.title}>fixer</h1>
        <p className={styles.subtitle}>개발 환경 연결 상태</p>
      </div>

      <section className={styles.card}>
        {probe.state === 'loading' && <p className={styles.label}>확인 중…</p>}

        {probe.state === 'error' && (
          <p className={styles.fail}>API 응답 없음: {probe.message}</p>
        )}

        {probe.state === 'ok' && (
          <>
            <div className={styles.row}>
              <span className={styles.label}>API 서버</span>
              <span className={`${styles.value} ${styles.ok}`}>연결됨</span>
            </div>
            <div className={styles.row}>
              <span className={styles.label}>PostgreSQL</span>
              <span
                className={`${styles.value} ${
                  probe.health.database === 'connected'
                    ? styles.ok
                    : styles.fail
                }`}
              >
                {probe.health.database === 'connected' ? '연결됨' : '끊김'}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.label}>확인 시각</span>
              <span className={styles.value}>{probe.health.checkedAt}</span>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
