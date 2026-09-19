'use client';

import { agreementSummarySchema, type AgreementSummary } from '@fixer/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './page.module.css';

/**
 * 내 동의서. (이슈 #8)
 *
 * PDF를 화면에서 만들지 않는다. **서버가 준 것을 그대로 링크한다** — 서명이
 * 병합된 최종 PDF가 이미 저장돼 있고(#7), 그게 분쟁 시 증거가 되는 문서다.
 *
 * **회원은 쿠키에서 온다 (#72).** 화면이 회원을 고르지 않으므로 기다릴 것도
 * 없다 — 들어오면 바로 읽는다.
 */
export default function MyAgreementPage() {
  const [agreement, setAgreement] = useState<AgreementSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/agreements/mine');
        if (cancelled) return;

        // 204는 "아직 서명하지 않았다"는 뜻이지 오류가 아니다.
        if (res.status === 204) {
          setAgreement(null);
          return;
        }
        const json: unknown = await res.json();
        if (cancelled) return;
        // 401을 "동의서가 없다"로 덮으면 거짓말이 된다. 서버 문구를 그대로 쓴다.
        if (!res.ok) {
          setError(messageOf(json));
          return;
        }
        setAgreement(agreementSummarySchema.parse(json));
      } catch {
        if (!cancelled) setAgreement(null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>내 동의서</h1>

      {error !== null ? (
        <p className={styles.note} role="alert">
          {error}
        </p>
      ) : agreement === null ? (
        <p className={styles.note}>
          {loaded ? '아직 서명한 동의서가 없습니다.' : '불러오는 중…'}
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

          {/* 서버가 토큰 주체로 소유자를 확인하고 내려준다. 남의 것은 403이다 */}
          <a
            className={styles.secondary}
            href={`/api/agreements/${agreement.id}`}
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

/** 서버가 준 문구를 그대로 쓴다. 화면에서 다시 만들지 않는다 */
function messageOf(json: unknown): string {
  if (
    typeof json === 'object' &&
    json !== null &&
    'message' in json &&
    typeof (json as { message: unknown }).message === 'string'
  ) {
    return (json as { message: string }).message;
  }
  return '동의서를 불러오지 못했습니다.';
}
