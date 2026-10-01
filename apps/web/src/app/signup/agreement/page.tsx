'use client';

import { signedAgreementSchema } from '@fixer/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SignupSteps } from '../SignupSteps';
import { SignaturePad } from './SignaturePad';
import styles from './page.module.css';

/**
 * 들어왔을 때 무엇을 보여줄지. `GET /api/agreements/mine`이 정한다.
 *
 * - `checking` — 아직 묻는 중
 * - `form` — 서명한 적이 없다 (204)
 * - `signed` — 이미 서명했다 (200). 마이페이지에서 주소만 등록하러 왔다가
 *   넘어온 경우다. 다시 서명시키지 않는다
 * - `needsLogin` — 세션이 없다 (401)
 * - `done` — 방금 서명을 마쳤다
 */
type Stage = 'checking' | 'form' | 'signed' | 'needsLogin' | 'done';

/**
 * 동의서 화면. (이슈 #7)
 *
 * 템플릿 PDF는 **서버가 준 것을 그대로** 보여준다. 확대·페이지 이동은
 * 브라우저의 PDF 뷰어에 맡긴다 — 우리가 만들 이유가 없다.
 *
 * 가입 흐름의 마지막 단계다. 회원은 가입이 연 세션이 말한다 (ADR-AUTH-5, #82).
 */
export default function AgreementPage() {
  const [stage, setStage] = useState<Stage>('checking');
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch('/api/agreements/mine');
        if (cancelled) return;
        // 204에는 본문이 없다. 상태 코드만 보고 가른다.
        if (res.status === 401) setStage('needsLogin');
        else if (res.status === 200) setStage('signed');
        else setStage('form');
      } catch {
        if (!cancelled) setStage('form');
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // AC4. 그리지 않았으면 요청 자체를 만들지 않는다.
    if (signature === null) {
      setError('서명을 그려 주세요.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/agreements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 회원 id도 ip·userAgent도 보내지 않는다. 서버가 세션과 요청에서 읽는다.
        body: JSON.stringify({ signaturePngBase64: signature }),
      });
      if (res.status === 401) {
        setStage('needsLogin');
        return;
      }
      const json: unknown = await res.json();
      if (!res.ok) {
        setError(messageOf(json));
        return;
      }
      signedAgreementSchema.parse(json);
      setStage('done');
    } catch {
      setError('요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  if (stage === 'done') {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>가입이 끝났습니다</h1>
        <p className={styles.lead}>
          서명하신 동의서는 마이페이지에서 다시 보실 수 있습니다.
        </p>
        <Link className={styles.secondary} href="/my">
          마이페이지로
        </Link>
        <Link className={styles.secondary} href="/">
          처음으로
        </Link>
      </main>
    );
  }

  if (stage === 'signed') {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>이미 서명한 동의서가 있습니다</h1>
        <p className={styles.lead}>
          서명하신 동의서는 마이페이지에서 다시 보실 수 있습니다.
        </p>
        <Link className={styles.secondary} href="/my">
          마이페이지로
        </Link>
      </main>
    );
  }

  if (stage === 'needsLogin') {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>로그인이 필요합니다</h1>
        <p className={styles.lead}>
          로그인하면 마이페이지에서 동의서에 서명할 수 있습니다.
        </p>
        <Link className={styles.secondary} href="/login">
          로그인하러 가기
        </Link>
      </main>
    );
  }

  if (stage === 'checking') {
    return (
      <main className={styles.page}>
        <SignupSteps current={4} />
        <h1 className={styles.title}>동의서</h1>
        <p className={styles.lead}>불러오는 중…</p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <SignupSteps current={4} />
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
