'use client';

import {
  SIGNUP_ERRORS,
  signupRequestSchema,
  signedUpSchema,
} from '@fixer/shared';
import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ZodError } from 'zod';
import styles from './page.module.css';

/**
 * 인증을 마친 이메일은 #1 화면이 sessionStorage에 남긴다.
 *
 * 주소창(query string)에 싣지 않는 이유는 이메일이 개인정보이기 때문이다.
 * 링크를 공유하거나 브라우저 이력에 남으면 그대로 새어나간다.
 */
const VERIFIED_EMAIL_KEY = 'fixer.signup.email';

/**
 * sessionStorage는 이 화면이 떠 있는 동안 바뀌지 않으므로 구독할 것이 없다.
 * `useSyncExternalStore`가 구독 함수를 요구하기 때문에 두는 빈 구현이다.
 */
function subscribeToNothing(): () => void {
  return () => {};
}

/** 브라우저에서 읽는 값 */
function readVerifiedEmail(): string | null {
  return sessionStorage.getItem(VERIFIED_EMAIL_KEY);
}

/**
 * 서버 렌더 시점의 값. sessionStorage가 없으므로 "아직 모른다"는 뜻의 null이다.
 *
 * 이 자리에 서버용 스냅샷을 주는 것이 `useSyncExternalStore`를 쓰는 이유다.
 * 효과(useEffect)에서 setState로 채우면 React가 그것을 렌더 중 상태 변경으로
 * 보고(react-hooks/set-state-in-effect), 지연 초기화로 읽으면 서버 HTML과
 * 클라이언트 첫 렌더가 어긋나 hydration 불일치가 난다.
 */
function readNothingOnServer(): null {
  return null;
}

/** 칸별 오류 문구. 키는 zod 스키마의 필드명과 같다 */
type FieldErrors = Partial<Record<'name' | 'password', string>>;

/**
 * 이슈 #2의 화면. 인증을 마친 이메일에 이름과 비밀번호를 붙여 가입한다.
 *
 * 주소(#3)와 동의서(#7)는 다음 이슈들이 이 뒤에 붙인다.
 */
export default function SignupAccountPage() {
  const email = useSyncExternalStore(
    subscribeToNothing,
    readVerifiedEmail,
    readNothingOnServer,
  );
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  /**
   * 탈퇴한 계정의 이메일로 가입을 시도했다. (#10)
   *
   * 새 계정을 만들지 않는다 — 만들면 경고 이력이 끊겨 세탁이 성공한다.
   * 대신 되살릴지 물어보고, 동의하면 같은 행을 되살린다.
   */
  const [reactivating, setReactivating] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    // 서버와 같은 스키마로 먼저 검사한다. 8자 미만이면 요청을 보내지 않고
    // 그 칸 아래에 문구를 띄운다 — "저장되지 않는다"가 이 뜻이다.
    const parsed = signupRequestSchema.safeParse({ email, password, name });
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        if (codeOf(json) === SIGNUP_ERRORS.REACTIVATION_AVAILABLE) {
          setReactivating(true);
          return;
        }
        setError(messageOf(json));
        return;
      }
      signedUpSchema.parse(json);
      setDone(true);
    } catch {
      setError('요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  /** 되살리기에 동의했다. 방금 입력한 비밀번호가 새 비밀번호가 된다 */
  async function confirmReactivation() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        setError(messageOf(json));
        return;
      }
      signedUpSchema.parse(json);
      setReactivating(false);
      setDone(true);
    } catch {
      setError('요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  if (reactivating) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>재활성화하시겠습니까?</h1>
        <p className={styles.lead}>
          <strong>{email}</strong> 은 탈퇴한 계정입니다. 되살리면 탈퇴 전 평점과
          이력이 그대로 이어집니다.
        </p>
        <p className={styles.note}>
          방금 입력한 비밀번호가 새 비밀번호가 됩니다.
        </p>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <button
          className={styles.submit}
          type="button"
          onClick={() => void confirmReactivation()}
          disabled={loading}
        >
          {loading ? '재활성화하는 중…' : '재활성화하기'}
        </button>
        <button
          className={styles.secondary}
          type="button"
          onClick={() => setReactivating(false)}
          disabled={loading}
        >
          취소
        </button>
      </main>
    );
  }

  if (done) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>가입이 완료되었습니다</h1>
        <p className={styles.lead}>
          <strong>{email}</strong> 으로 가입되었습니다.
        </p>
        <p className={styles.note}>
          다음 단계(주소 등록)는 이슈 #3에서 만듭니다.
        </p>
        <Link className={styles.secondary} href="/">
          처음으로
        </Link>
      </main>
    );
  }

  // 인증을 마치지 않고 이 주소로 바로 들어온 경우다. 되돌려 보낸다.
  if (email === null) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>이메일 인증이 필요합니다</h1>
        <p className={styles.lead}>가입에 쓸 이메일을 먼저 인증해 주세요.</p>
        <Link className={styles.secondary} href="/signup/verify-email">
          이메일 인증하러 가기
        </Link>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>가입 정보 입력</h1>

      <form className={styles.form} onSubmit={submit} noValidate>
        <p className={styles.lead}>
          인증을 마친 주소는 <strong>{email}</strong> 입니다.
        </p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="name">
            이름
          </label>
          <input
            id="name"
            className={styles.input}
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          {fieldErrors.name && (
            <p className={styles.fieldError} role="alert">
              {fieldErrors.name}
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
            autoComplete="new-password"
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
          {loading ? '가입하는 중…' : '가입하기'}
        </button>
      </form>
    </main>
  );
}

/** zod 오류에서 칸별 첫 문구만 뽑는다. 한 칸에 여러 개를 쌓아 보여주지 않는다 */
function toFieldErrors(error: ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field === 'name' || field === 'password') {
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

/** 서버가 준 errorCode. 문구가 아니라 이걸로 분기한다 */
function codeOf(json: unknown): string | null {
  if (
    typeof json === 'object' &&
    json !== null &&
    'errorCode' in json &&
    typeof (json as { errorCode: unknown }).errorCode === 'string'
  ) {
    return (json as { errorCode: string }).errorCode;
  }
  return null;
}
