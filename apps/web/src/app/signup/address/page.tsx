'use client';

import {
  registerAddressRequestSchema,
  registeredAddressSchema,
  type AddressSelection,
} from '@fixer/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SignupSteps } from '../SignupSteps';
import { openPostcodePopup } from './kakao-postcode';
import styles from './page.module.css';

/**
 * 이슈 #3의 화면. 우편번호 팝업으로 주소를 고르고 저장한다.
 *
 * 가입 흐름 4단계(`spec-fixed.md` §2.2)이고, 마이페이지의 "주소 등록하기"도
 * 여기로 온다. 회원은 화면이 들고 다니지 않는다 — 가입이 연 세션이 말한다
 * (ADR-AUTH-5, #82). 저장하면 동의서 화면으로 넘어간다.
 */
export default function SignupAddressPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<AddressSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** 세션이 없다. 가입 직후가 아니라 주소창으로 바로 들어온 경우다 */
  const [needsLogin, setNeedsLogin] = useState(false);

  /**
   * 팝업을 띄워 주소 한 건을 받는다. 고르지 않고 닫으면 `null`이 오고,
   * 그때는 폼을 그대로 둔다 — 이전에 고른 값을 지우지 않는다.
   */
  async function search() {
    setError(null);

    // 스크립트를 못 내려받거나 카카오가 모르는 모양을 주면 여기로 온다.
    // 잡지 않으면 처리되지 않은 예외가 되고 화면은 아무 반응도 하지 않는다.
    let chosen: AddressSelection | null;
    try {
      chosen = await openPostcodePopup();
    } catch {
      setError('주소 검색을 열지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }

    if (chosen === null) {
      return;
    }

    setSelected(chosen);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // 고른 주소가 없으면 보낼 것이 없다. 요청을 만들지 않는다.
    if (selected === null) {
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
      const res = await fetch('/api/members/me/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (res.status === 401) {
        setNeedsLogin(true);
        return;
      }
      const json: unknown = await res.json();
      if (!res.ok) {
        setError(messageOf(json));
        return;
      }
      registeredAddressSchema.parse(json);
      router.replace('/signup/agreement');
    } catch {
      setError('요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  if (needsLogin) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>로그인이 필요합니다</h1>
        <p className={styles.lead}>
          로그인하면 마이페이지에서 주소를 등록할 수 있습니다.
        </p>
        <Link className={styles.secondary} href="/login">
          로그인하러 가기
        </Link>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <SignupSteps current={3} />
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
