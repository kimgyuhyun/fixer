'use client';

import { agreementSummarySchema, type AgreementSummary } from '@fixer/shared';
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import styles from './page.module.css';

const SIGNED_UP_USER_ID_KEY = 'fixer.signup.userId';

function subscribeToNothing(): () => void {
  return () => {};
}
function readSignedUpUserId(): string | null {
  return sessionStorage.getItem(SIGNED_UP_USER_ID_KEY);
}
function readNothingOnServer(): null {
  return null;
}

/**
 * 내 동의서. (이슈 #8)
 *
 * PDF를 화면에서 만들지 않는다. **서버가 준 것을 그대로 링크한다** — 서명이
 * 병합된 최종 PDF가 이미 저장돼 있고(#7), 그게 분쟁 시 증거가 되는 문서다.
 *
 * `/my`(마이페이지)는 #4에 있다. 머지되면 거기서 이 화면으로 링크한다.
 */
export default function MyAgreementPage() {
  const userId = useSyncExternalStore(
    subscribeToNothing,
    readSignedUpUserId,
    readNothingOnServer,
  );
  const [agreement, setAgreement] = useState<AgreementSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;

    async function load(id: string) {
      try {
        const res = await fetch(
          `/api/agreements/mine?userId=${encodeURIComponent(id)}`,
        );
        if (cancelled) return;

        // 204는 "아직 서명하지 않았다"는 뜻이지 오류가 아니다.
        if (res.status === 204) {
          setAgreement(null);
          return;
        }
        setAgreement(agreementSummarySchema.parse(await res.json()));
      } catch {
        if (!cancelled) setAgreement(null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }

    void load(userId);
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>내 동의서</h1>

      {agreement === null ? (
        <p className={styles.note}>
          {loaded || userId === null
            ? '아직 서명한 동의서가 없습니다.'
            : '불러오는 중…'}
        </p>
      ) : (
        <>
          <dl className={styles.list}>
            <div className={styles.row}>
              <dt className={styles.label}>서명일</dt>
              <dd className={styles.value}>
                {new Date(agreement.agreedAt).toLocaleDateString('ko-KR')}
              </dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.label}>문서 버전</dt>
              <dd className={styles.value}>v{agreement.templateVersion}</dd>
            </div>
          </dl>

          {/* 서버가 소유자를 확인하고 내려준다. 남의 것은 403이다 */}
          <a
            className={styles.secondary}
            href={`/api/agreements/${agreement.id}?userId=${encodeURIComponent(userId ?? '')}`}
            target="_blank"
            rel="noreferrer"
          >
            서명한 동의서 보기
          </a>
        </>
      )}

      <Link className={styles.secondary} href="/">
        처음으로
      </Link>
    </main>
  );
}
