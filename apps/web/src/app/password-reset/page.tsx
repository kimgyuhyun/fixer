'use client';

import { passwordResetRequestSchema } from '@fixer/shared';
import Link from 'next/link';
import { useState } from 'react';
import styles from './page.module.css';

/**
 * 비밀번호 찾기. (이슈 #6, `spec-fixed.md` §2.4)
 *
 * **결과를 가입 여부로 나누지 않는다.** 없는 이메일에도 같은 안내를 보여준다 —
 * 다르게 보여주면 이메일만 넣어보고 가입 여부를 알아낼 수 있다. 서버가 회원이
 * 없어도 204를 주는 것과 같은 이유다.
 */
export default function PasswordResetPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = passwordResetRequestSchema.safeParse({ email });
    if (!parsed.success) {
      setError('이메일 형식이 올바르지 않습니다.');
      return;
    }

    setLoading(true);
    try {
      await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      setSent(true);
    } catch {
      setError('요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>비밀번호 찾기</h1>

      {sent ? (
        <>
          <p className={styles.notice} role="status">
            메일을 보냈습니다. 30분 안에 링크를 열어 새 비밀번호를 정해 주세요.
          </p>
          <Link className={styles.secondary} href="/login">
            로그인으로
          </Link>
        </>
      ) : (
        <form className={styles.form} onSubmit={submit} noValidate>
          <p className={styles.lead}>
            가입한 이메일을 넣으면 재설정 링크를 보내드립니다.
          </p>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              이메일
            </label>
            <input
              id="email"
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <button className={styles.submit} type="submit" disabled={loading}>
            {loading ? '보내는 중…' : '재설정 메일 받기'}
          </button>
        </form>
      )}
    </main>
  );
}
