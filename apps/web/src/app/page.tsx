'use client';

import { myProfileSchema, type MyProfile } from '@fixer/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './page.module.css';

/** 묻는 중이면 아무것도 그리지 않는다. 로그인했는데 "가입하기"가 깜빡이면 안 된다 */
type Session =
  | { state: 'checking' }
  | { state: 'guest' }
  | { state: 'member'; profile: MyProfile };

const MENU = [
  { label: '공고 목록', href: '/job-posts' },
  { label: '공고 등록', href: '/job-posts/new' },
  { label: '포인트', href: '/points' },
  { label: '환전 계좌', href: '/my/account' },
  { label: '마이페이지', href: '/my' },
];

/** `/admin`에는 첫 화면이 없고 네 화면이 서로 링크하지 않는다. 넷 다 연다 */
const ADMIN_MENU = [
  { label: '회원 관리', href: '/admin/members' },
  { label: '공고 관리', href: '/admin/job-posts' },
  { label: '환전 관리', href: '/admin/exchange-requests' },
  { label: '제재 관리', href: '/admin/suspensions' },
];

/**
 * 첫 화면. (이슈 #84)
 *
 * 로그인 상태는 쿠키가 아니라 `/api/auth/me`로 판단한다 (#83). 200이 아니면
 * 전부 비로그인이다 — 탈퇴 계정(403)에게도 로그인 버튼이 맞는 안내다.
 */
export default function Home() {
  const [session, setSession] = useState<Session>({ state: 'checking' });
  /** 동의서를 서명했는가. 묻는 중이거나 묻지 못했으면 null — 할 일을 띄우지 않는다 */
  const [agreementSigned, setAgreementSigned] = useState<boolean | null>(null);

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
        setSession({ state: 'member', profile: myProfileSchema.parse(json) });
      } catch {
        if (!cancelled) setSession({ state: 'guest' });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const isMember = session.state === 'member';

  useEffect(() => {
    if (!isMember) return;
    let cancelled = false;

    async function loadAgreement() {
      try {
        // 서명하지 않았으면 204다. 본문이 없으므로 상태 코드만 본다. (my/page.tsx와 같다)
        const res = await fetch('/api/agreements/mine');
        if (cancelled) return;
        if (res.status === 200) setAgreementSigned(true);
        else if (res.status === 204) setAgreementSigned(false);
      } catch {
        // 할 일 하나 못 띄울 뿐이다. 화면은 그대로 둔다.
      }
    }

    void loadAgreement();
    return () => {
      cancelled = true;
    };
  }, [isMember]);

  if (session.state === 'checking') {
    return <main className={styles.page} />;
  }

  if (session.state === 'guest') {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>fixer</h1>
        <p className={styles.lead}>
          동네에서 일을 맡기고, 동네에서 일을 찾습니다.
        </p>
        <div className={styles.actions}>
          <Link className={styles.primary} href="/login">
            로그인
          </Link>
          <Link className={styles.secondary} href="/signup/verify-email">
            가입하기
          </Link>
        </div>
      </main>
    );
  }

  const { profile } = session;
  const needsAddress = profile.address === null;
  const needsAgreement = agreementSigned === false;

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{profile.name}님</h1>

      {(needsAddress || needsAgreement) && (
        <section className={styles.section}>
          <h2 className={styles.heading}>남은 할 일</h2>
          <ul className={styles.list}>
            {needsAddress && (
              <li>
                <Link className={styles.item} href="/signup/address">
                  주소 등록하기
                </Link>
              </li>
            )}
            {needsAgreement && (
              <li>
                <Link className={styles.item} href="/signup/agreement">
                  동의서 서명하기
                </Link>
              </li>
            )}
          </ul>
        </section>
      )}

      <Menu title="메뉴" items={MENU} />
      {/* 보이는 것은 편의일 뿐이다. 권한은 AdminGuard가 요청마다 판정한다 */}
      {profile.role === 'ADMIN' && <Menu title="관리자" items={ADMIN_MENU} />}
    </main>
  );
}

function Menu({
  title,
  items,
}: {
  title: string;
  items: { label: string; href: string }[];
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>{title}</h2>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.href}>
            <Link className={styles.item} href={item.href}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
