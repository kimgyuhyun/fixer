'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { healthResponseSchema, type HealthResponse } from '@fixer/shared';
import styles from './page.module.css';

type Probe =
  | { state: 'loading' }
  | { state: 'ok'; health: HealthResponse }
  | { state: 'error'; message: string };

type Feature = {
  issue: number;
  title: string;
  summary: string;
  href?: string;
};

/**
 * 지금 화면까지 만들어져 눌러볼 수 있는 것.
 * 이슈를 끝낼 때마다 여기에 href와 함께 한 줄 추가한다.
 */
const READY: Feature[] = [
  {
    issue: 1,
    title: '이메일 인증',
    summary: '이메일로 6자리 코드를 받아 10분 안에 검증한다.',
    href: '/signup/verify-email',
  },
  {
    issue: 2,
    title: '가입',
    summary: '인증된 이메일에 비밀번호와 이름을 붙여 계정을 만든다.',
    href: '/signup/account',
  },
  {
    issue: 3,
    title: '주소 등록',
    summary: '우편번호 팝업으로 주소를 고르고 좌표까지 저장한다.',
    href: '/signup/address',
  },
  {
    issue: 7,
    title: '동의서 서명',
    summary: '동의서를 읽고 서명하면 서명이 병합된 PDF가 저장된다.',
    href: '/signup/agreement',
  },
  {
    issue: 8,
    title: '내 동의서 보기',
    summary: '서명한 동의서를 다시 열어 본다. 남의 것은 못 본다.',
    href: '/my/agreement',
  },
  {
    issue: 28,
    title: '포인트 충전',
    summary: '금액을 고르면 서버가 금액을 대조하고 원장에 충전을 남긴다.',
    href: '/points',
  },
  {
    issue: 11,
    title: '공고 카테고리 안내',
    summary: '카테고리를 고르면 그 업종에서 적어야 할 것이 안내된다.',
    href: '/job-posts/new',
  },
];

/** 아직 만들지 않은 것. 이 화면이 "무엇이 없는지"까지 말하게 한다. */
const PLANNED: Feature[] = [
  { issue: 4, title: '로그인', summary: '로그인하고 내 정보를 본다.' },
  { issue: 6, title: '비밀번호 재설정', summary: '비밀번호를 다시 정한다.' },
  { issue: 12, title: '공고 등록', summary: '공고를 올리면 목록에 뜬다.' },
];

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
      <header>
        <h1 className={styles.title}>fixer</h1>
        <p className={styles.subtitle}>동네 일거리 중개 · 개발 중</p>
      </header>

      <section className={styles.section}>
        <h2 className={styles.heading}>지금 써볼 수 있는 것</h2>
        <ul className={styles.list}>
          {READY.map((feature) => (
            <li key={feature.issue}>
              <Link className={styles.item} href={feature.href ?? '#'}>
                <span className={styles.itemHead}>
                  <span className={styles.itemTitle}>{feature.title}</span>
                  <span className={styles.badge}>#{feature.issue}</span>
                </span>
                <span className={styles.itemSummary}>{feature.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className={styles.note}>
          개발 환경에서는 메일이 실제로 나가지 않습니다. 인증 코드는 API 서버
          로그에{' '}
          <code className={styles.code}>[개발용] … 인증 코드: 123456</code>{' '}
          형태로 찍힙니다.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>아직 만들지 않은 것</h2>
        <ul className={styles.list}>
          {PLANNED.map((feature) => (
            <li key={feature.issue}>
              <div className={`${styles.item} ${styles.itemDisabled}`}>
                <span className={styles.itemHead}>
                  <span className={styles.itemTitle}>{feature.title}</span>
                  <span className={styles.badge}>#{feature.issue}</span>
                </span>
                <span className={styles.itemSummary}>{feature.summary}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.card}>
        <h2 className={styles.heading}>개발 환경 연결 상태</h2>

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
