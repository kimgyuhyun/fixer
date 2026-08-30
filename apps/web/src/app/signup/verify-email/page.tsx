'use client';

import {
  EMAIL_VERIFICATION_RULES,
  emailVerificationSentSchema,
  emailVerifiedSchema,
} from '@fixer/shared';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './page.module.css';

type Step = 'request' | 'verify' | 'done';

/**
 * 이슈 #1의 화면. 이메일을 넣어 코드를 받고, 그 코드를 넣어 인증을 마친다.
 *
 * 개발 환경에서는 메일이 실제로 나가지 않는다. 코드는 API 서버 로그에
 * `[개발용] {이메일} 인증 코드: 123456` 형태로 찍힌다. (ConsoleMailProvider)
 */
export default function VerifyEmailPage() {
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);

  // 쿨다운 남은 초를 1초마다 다시 계산한다. 서버가 준 시각이 기준이므로
  // 화면을 새로 열어도 남은 시간이 어긋나지 않는다.
  useEffect(() => {
    if (resendAt === null) return;
    const tick = () =>
      setRemaining(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [resendAt]);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/email-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        setError(messageOf(json));
        return;
      }
      const sent = emailVerificationSentSchema.parse(json);
      setResendAt(new Date(sent.resendAvailableAt).getTime());
      setStep('verify');
    } catch {
      setError('요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/email-verification/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        setError(messageOf(json));
        return;
      }
      emailVerifiedSchema.parse(json);
      setStep('done');
    } catch {
      setError('요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'done') {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>인증되었습니다</h1>
        <p className={styles.lead}>
          <strong>{email}</strong> 주소가 확인되었습니다.
        </p>
        <p className={styles.note}>
          다음 단계(비밀번호 설정)는 이슈 #2에서 만듭니다.
        </p>
        <Link className={styles.secondary} href="/">
          처음으로
        </Link>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>이메일 인증</h1>

      {step === 'request' ? (
        <form className={styles.form} onSubmit={requestCode} noValidate>
          <p className={styles.lead}>
            가입에 쓸 이메일을 입력하면 {EMAIL_VERIFICATION_RULES.codeLength}
            자리 인증 코드를 보냅니다.
          </p>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              이메일
            </label>
            <input
              id="email"
              className={styles.input}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <button className={styles.submit} type="submit" disabled={loading}>
            {loading ? '보내는 중…' : '인증 코드 받기'}
          </button>
        </form>
      ) : (
        <form className={styles.form} onSubmit={verifyCode} noValidate>
          <p className={styles.lead}>
            <strong>{email}</strong> 로 코드를 보냈습니다.
            {EMAIL_VERIFICATION_RULES.expiryMinutes}분 안에 입력해 주세요.
          </p>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="code">
              인증 코드
            </label>
            <input
              id="code"
              className={`${styles.input} ${styles.codeInput}`}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={EMAIL_VERIFICATION_RULES.codeLength}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
            />
            <p className={styles.hint}>
              틀릴 수 있는 횟수는 {EMAIL_VERIFICATION_RULES.maxAttempts}
              회입니다.
            </p>
          </div>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <button className={styles.submit} type="submit" disabled={loading}>
            {loading ? '확인 중…' : '확인'}
          </button>

          <button
            className={styles.secondary}
            type="button"
            disabled={loading || remaining > 0}
            onClick={(e) => requestCode(e as unknown as React.FormEvent)}
          >
            {remaining > 0 ? `${remaining}초 후 재발송` : '코드 다시 받기'}
          </button>
        </form>
      )}
    </main>
  );
}

/** 서버가 준 문구를 그대로 쓴다. 화면에서 다시 만들지 않는다. */
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
