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
    issue: 30,
    title: '환전 계좌',
    summary: '계좌를 등록하면 암호화되어 저장되고 뒤 4자리만 보인다.',
    href: '/my/account',
  },
  {
    issue: 12,
    title: '공고 등록·목록',
    summary: '공고를 올리면 예산이 잠기고 목록에 뜬다.',
    href: '/job-posts',
  },
  {
    issue: 11,
    title: '공고 카테고리 안내',
    summary: '카테고리를 고르면 그 업종에서 적어야 할 것이 안내된다.',
    href: '/job-posts/new',
  },
  {
    issue: 4,
    title: '로그인',
    summary: '로그인하면 마이페이지에서 내 정보와 별점을 본다.',
    href: '/login',
  },
  {
    issue: 5,
    title: '보호 페이지',
    summary: '로그아웃하면 뒤로가기로도 마이페이지를 못 본다.',
    href: '/my',
  },
  {
    issue: 6,
    title: '비밀번호 재설정',
    summary: '메일로 받은 링크로 비밀번호를 다시 정한다.',
    href: '/password-reset',
  },
  {
    issue: 13,
    title: '공고 목록·검색',
    summary: '카테고리·지역으로 목록을 좁혀 본다.',
    href: '/job-posts',
  },
  {
    issue: 17,
    title: '지원과 수락',
    summary: '공고에 지원하고, 구인자가 수락하면 계약이 된다.',
    href: '/job-posts',
  },
  {
    issue: 26,
    title: '별점',
    summary: '거래가 끝나면 서로 1~5점을 남긴다. 마이페이지에 쌓인다.',
    href: '/my',
  },
  {
    issue: 36,
    title: '알림',
    summary: '중요한 일이 생기면 벨에 쌓이고, 눌러 읽으면 그 화면으로 간다.',
    href: '/notifications',
  },
  {
    issue: 32,
    title: '관리자 · 회원',
    summary: '회원을 검색해 상세와 제재 이력을 본다.',
    href: '/admin/members',
  },
  {
    issue: 35,
    title: '관리자 · 공고',
    summary: '공고를 검색해 사유를 남기고 강제 취소한다.',
    href: '/admin/job-posts',
  },
  {
    issue: 34,
    title: '관리자 · 환전',
    summary: '환전 요청을 승인하고 이체 완료를 찍는다.',
    href: '/admin/exchange-requests',
  },
  {
    issue: 33,
    title: '관리자 · 제재',
    summary: '제재를 사유와 함께 조기 해제한다.',
    href: '/admin/suspensions',
  },
];

/**
 * 화면과 서버는 다 됐는데 **외부 키가 없어 절반만 도는 것.**
 * 이 화면이 "무엇이 안 되는지"까지 말하게 한다.
 */
const PLANNED: Feature[] = [
  {
    issue: 28,
    title: '결제창',
    summary:
      '포트원 채널키가 없어 결제창이 뜨지 않는다. 서버가 결제 건을 만들고 바로 확정한다.',
  },
  {
    issue: 37,
    title: '알림 이메일',
    summary:
      '인앱 알림은 쌓이지만 메일은 나가지 않는다. 인증 코드와 함께 서버 로그에만 찍힌다.',
  },
  {
    issue: 30,
    title: '계좌 실명 확인',
    summary: '형식만 보고 통과시킨다. 실명 대조는 포트원을 붙일 때 켜진다.',
  },
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
        <h2 className={styles.heading}>아직 반쪽인 것</h2>
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
