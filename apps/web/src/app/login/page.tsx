'use client';

import { loginRequestSchema, signedInSchema } from '@fixer/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { ZodError } from 'zod';
import styles from './page.module.css';

/** 칸별 오류 문구. 키는 zod 스키마의 필드명과 같다 */
type FieldErrors = Partial<Record<'email' | 'password', string>>;

/**
 * 이슈 #4의 로그인 화면.
 *
 * 토큰은 서버가 httpOnly 쿠키로 내려주므로 이 화면이 저장할 것이 없다.
 * 성공하면 마이페이지로 옮겨가는 것이 전부다.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    // 서버와 같은 스키마로 형식만 먼저 본다. 자격 대조는 서버의 몫이다.
    const parsed = loginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        // 서버가 준 문구를 그대로 쓴다. 화면이 어느 쪽이 틀렸는지 좁혀
        // 말하면 "알려주지 않는다"는 요구가 깨진다.
        setError(messageOf(json));
        return;
      }
      signedInSchema.parse(json);
      router.push('/my');
    } catch {
      setError('요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>로그인</h1>

      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            이메일
          </label>
          <input
            id="email"
            className={styles.input}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {fieldErrors.email && (
            <p className={styles.fieldError} role="alert">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            비밀번호
          </label>
          <input
            id="password"
            className={styles.input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {fieldErrors.password && (
            <p className={styles.fieldError} role="alert">
              {fieldErrors.password}
            </p>
          )}
        </div>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <button className={styles.submit} type="submit" disabled={loading}>
          {loading ? '로그인하는 중…' : '로그인'}
        </button>
      </form>

      <Link className={styles.secondary} href="/signup/verify-email">
        아직 회원이 아니신가요? 가입하기
      </Link>
    </main>
  );
}

/** zod 오류에서 칸별 첫 문구만 뽑는다. 한 칸에 여러 개를 쌓아 보여주지 않는다 */
function toFieldErrors(error: ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field === 'email' || field === 'password') {
      fieldErrors[field] ??= issue.message;
    }
  }

  return fieldErrors;
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
