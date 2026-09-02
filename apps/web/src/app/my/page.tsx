'use client';

import { myProfileSchema, type MyProfile } from '@fixer/shared';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './page.module.css';

/**
 * 이슈 #4의 마이페이지.
 *
 * 주소는 #3(주소 등록)이 채운다. 그전까지는 "아직 등록하지 않았습니다"로 둔다.
 */
export default function MyPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * 로그아웃. 서버가 쿠키와 Refresh 행을 지운다.
   *
   * 서버가 실패해도 로그인 화면으로 보낸다 — 여기 남아 있으면 로그아웃한 줄
   * 알았는데 보호 페이지가 그대로 보인다. 사용자가 보기에 그게 더 나쁘다.
   *
   * `spec-fixed.md` §2.5가 요구하는 뒤로가기 방어 셋 중 세 번째가
   * `router.refresh()`다. 미들웨어 검사와 `no-store`는 브라우저의 HTTP 캐시를
   * 막지만, Next의 **클라이언트 Router Cache는 별개 메커니즘**이라 여기서
   * 명시적으로 지우지 않으면 뒤로가기가 이 화면을 그대로 되살린다.
   */
  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // 무시하고 아래로 간다
    }
    router.refresh();
    router.replace('/login');
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // 토큰은 httpOnly 쿠키라 브라우저가 알아서 싣는다. Access가 만료됐어도
        // 서버가 Refresh로 갱신하고 그대로 응답한다.
        const res = await fetch('/api/auth/me');
        const json: unknown = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          setError(messageOf(json));
          return;
        }
        setProfile(myProfileSchema.parse(json));
      } catch {
        if (!cancelled) setError('내 정보를 불러오지 못했습니다.');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>마이페이지</h1>
        <p className={styles.error} role="alert">
          {error}
        </p>
        <Link className={styles.secondary} href="/login">
          로그인하러 가기
        </Link>
      </main>
    );
  }

  if (profile === null) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>마이페이지</h1>
        <p className={styles.lead}>내 정보를 불러오는 중…</p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>마이페이지</h1>

      <dl className={styles.list}>
        <div className={styles.row}>
          <dt className={styles.label}>이메일</dt>
          <dd className={styles.value}>{profile.email}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>이름</dt>
          <dd className={styles.value}>{profile.name}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>주소</dt>
          <dd
            className={profile.address === null ? styles.empty : styles.value}
          >
            {profile.address ?? '아직 등록하지 않았습니다'}
          </dd>
        </div>
      </dl>

      <p className={styles.note}>주소 등록은 이슈 #3에서 만듭니다.</p>

      <button className={styles.secondary} type="button" onClick={logout}>
        로그아웃
      </button>
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
  return '내 정보를 불러오지 못했습니다.';
}
