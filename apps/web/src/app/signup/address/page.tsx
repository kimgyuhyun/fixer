'use client';

import {
  registerAddressRequestSchema,
  registeredAddressSchema,
  type AddressSelection,
} from '@fixer/shared';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { openPostcodePopup } from './kakao-postcode';
import styles from './page.module.css';

/**
 * 가입한 회원의 id는 #2 화면이 sessionStorage에 남긴다.
 *
 * 주소창(query string)에 싣지 않는 이유는 #2가 이메일을 싣지 않은 것과 같다 —
 * 링크를 공유하거나 브라우저 이력에 남으면 그대로 새어나간다.
 */
const SIGNED_UP_USER_ID_KEY = 'fixer.signup.userId';

/**
 * sessionStorage는 이 화면이 떠 있는 동안 바뀌지 않으므로 구독할 것이 없다.
 * `useSyncExternalStore`가 구독 함수를 요구하기 때문에 두는 빈 구현이다.
 */
function subscribeToNothing(): () => void {
  return () => {};
}

/** 브라우저에서 읽는 값 */
function readSignedUpUserId(): string | null {
  return sessionStorage.getItem(SIGNED_UP_USER_ID_KEY);
}

/**
 * 서버 렌더 시점의 값. sessionStorage가 없으므로 "아직 모른다"는 뜻의 null이다.
 * (#2 화면과 같은 이유 — 효과에서 채우면 hydration이 어긋난다)
 */
function readNothingOnServer(): null {
  return null;
}

/**
 * 이슈 #3의 화면. 우편번호 팝업으로 주소를 고르고 저장한다.
 *
 * 가입 흐름 4단계(`spec-fixed.md` §2.2)다. 동의서(#7)는 이 뒤에 붙는다.
 */
export default function SignupAddressPage() {
  const userId = useSyncExternalStore(
    subscribeToNothing,
    readSignedUpUserId,
    readNothingOnServer,
  );
  const [selected, setSelected] = useState<AddressSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  /**
   * 팝업을 띄워 주소 한 건을 받는다. 고르지 않고 닫으면 `null`이 오고,
   * 그때는 폼을 그대로 둔다 — 이전에 고른 값을 지우지 않는다.
   */
  async function search() {
    setError(null);

    const chosen = await openPostcodePopup();
    if (chosen === null) {
      return;
    }

    setSelected(chosen);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // 고른 주소가 없으면 보낼 것이 없다. 요청을 만들지 않는다.
    if (selected === null || userId === null) {
      setError('먼저 주소를 검색해 주세요.');
      return;
    }

    // 서버와 같은 스키마로 먼저 검사한다. 라벨은 이 화면에서 받지 않으므로
    // 붙이지 않고, 서버가 기본 라벨을 채운다.
    const parsed = registerAddressRequestSchema.safeParse(selected);
    if (!parsed.success) {
      setError('주소를 다시 선택해 주세요.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/members/${userId}/addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        setError(messageOf(json));
        return;
      }
      registeredAddressSchema.parse(json);
      setDone(true);
    } catch {
      setError('요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>주소가 등록되었습니다</h1>
        <p className={styles.lead}>
          <strong>{selected?.roadAddress || selected?.jibunAddress}</strong> 로
          등록되었습니다.
        </p>
        <Link className={styles.secondary} href="/">
          처음으로
        </Link>
      </main>
    );
  }

  // 가입을 마치지 않고 이 주소로 바로 들어온 경우다. 되돌려 보낸다.
  if (userId === null) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>가입이 필요합니다</h1>
        <p className={styles.lead}>주소는 가입을 마친 뒤에 등록합니다.</p>
        <Link className={styles.secondary} href="/signup/account">
          가입하러 가기
        </Link>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>주소 등록</h1>

      <form className={styles.form} onSubmit={submit} noValidate>
        <p className={styles.lead}>
          우편번호를 검색해 주소를 고르면 아래 칸이 채워집니다.
        </p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="postalCode">
            우편번호
          </label>
          {/* 주소는 팝업이 준 값만 저장한다. 손으로 고치면 시/도·시/군/구와
              어긋나므로 읽기 전용이다. */}
          <input
            id="postalCode"
            className={styles.input}
            type="text"
            value={selected?.postalCode ?? ''}
            readOnly
          />
        </div>

        <button className={styles.secondary} type="button" onClick={search}>
          주소 검색
        </button>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="roadAddress">
            도로명주소
          </label>
          <input
            id="roadAddress"
            className={styles.input}
            type="text"
            value={selected?.roadAddress ?? ''}
            readOnly
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="jibunAddress">
            지번주소
          </label>
          <input
            id="jibunAddress"
            className={styles.input}
            type="text"
            value={selected?.jibunAddress ?? ''}
            readOnly
          />
        </div>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <button className={styles.submit} type="submit" disabled={loading}>
          {loading ? '저장하는 중…' : '저장하기'}
        </button>
      </form>
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
  return '요청을 처리하지 못했습니다.';
}
