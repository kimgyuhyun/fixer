'use client';

import { signedAgreementSchema } from '@fixer/shared';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { SignaturePad } from './SignaturePad';
import styles from './page.module.css';

/** 가입한 회원의 id는 #2 화면이 sessionStorage에 남긴다 */
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
 * 동의서 화면. (이슈 #7)
 *
 * 템플릿 PDF는 **서버가 준 것을 그대로** 보여준다. 확대·페이지 이동은
 * 브라우저의 PDF 뷰어에 맡긴다 — 우리가 만들 이유가 없다.
 */
export default function AgreementPage() {
  const userId = useSyncExternalStore(
    subscribeToNothing,
    readSignedUpUserId,
    readNothingOnServer,
  );
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // AC4. 그리지 않았으면 요청 자체를 만들지 않는다.
    if (signature === null || userId === null) {
      setError('서명을 그려 주세요.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/agreements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ip·userAgent는 보내지 않는다. 서버가 요청에서 직접 읽는다.
        body: JSON.stringify({ userId, signaturePngBase64: signature }),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        setError(messageOf(json));
        return;
      }
      signedAgreementSchema.parse(json);
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
        <h1 className={styles.title}>동의서 서명이 끝났습니다</h1>
        <p className={styles.lead}>
          서명하신 동의서는 마이페이지에서 다시 보실 수 있습니다.
        </p>
        <Link className={styles.secondary} href="/">
          처음으로
        </Link>
      </main>
    );
  }

  if (userId === null) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>가입이 필요합니다</h1>
        <p className={styles.lead}>동의서는 가입을 마친 뒤에 서명합니다.</p>
        <Link className={styles.secondary} href="/signup/account">
          가입하러 가기
        </Link>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>동의서</h1>

      <form className={styles.form} onSubmit={submit} noValidate>
        <p className={styles.lead}>
          아래 내용을 읽고 동의하시면 서명해 주세요.
        </p>

        {/* 서버가 준 PDF를 그대로 보여준다. 뷰어는 브라우저 몫이다 */}
        <object
          className={styles.viewer}
          data="/api/agreements/template"
          type="application/pdf"
          aria-label="동의서 내용"
        >
          <a href="/api/agreements/template">동의서 내려받기</a>
        </object>

        <SignaturePad onChange={setSignature} />

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <button
          className={styles.submit}
          type="submit"
          disabled={loading || signature === null}
        >
          {loading ? '제출하는 중…' : '동의합니다'}
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
  return '동의서를 제출하지 못했습니다.';
}
