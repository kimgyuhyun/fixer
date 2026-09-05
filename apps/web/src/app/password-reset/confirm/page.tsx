'use client';

import { passwordResetConfirmSchema } from '@fixer/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import styles from '../page.module.css';

/**
 * 재설정 링크로 들어오는 화면. (이슈 #6)
 *
 * 토큰은 링크 쿼리에 실려 온다. 이메일과 달리 토큰은 그 자체가 1회용 비밀값이고
 * 링크로 전달되는 것이 목적이라 주소창에 있는 것이 맞다.
 */
function ConfirmForm() {
  const token = useSearchParams().get('token') ?? '';
  const [newPassword, setNewPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // 서버와 같은 스키마로 먼저 본다. 규칙이 갈리지 않게 한 곳에서 온다.
    const parsed = passwordResetConfirmSchema.safeParse({ token, newPassword });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '입력값을 확인해 주세요.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const json: unknown = await res.json();
        setError(messageOf(json));
        return;
      }
      setDone(true);
    } catch {
      setError('요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <>
        <p className={styles.notice} role="status">
          비밀번호가 바뀌었습니다. 다른 기기에 남아 있던 로그인도 모두
          끊었습니다.
        </p>
        <Link className={styles.secondary} href="/login">
          로그인하러 가기
        </Link>
      </>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <p className={styles.lead}>새 비밀번호를 정해 주세요. 8자 이상입니다.</p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="newPassword">
          새 비밀번호
        </label>
        <input
          id="newPassword"
          className={styles.input}
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <button className={styles.submit} type="submit" disabled={loading}>
        {loading ? '바꾸는 중…' : '비밀번호 바꾸기'}
      </button>
    </form>
  );
}

export default function PasswordResetConfirmPage() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>새 비밀번호 정하기</h1>
      {/* useSearchParams는 Suspense 경계가 필요하다 */}
      <Suspense fallback={<p className={styles.lead}>불러오는 중…</p>}>
        <ConfirmForm />
      </Suspense>
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
  return '재설정 링크가 유효하지 않습니다. 다시 요청해 주세요.';
}
