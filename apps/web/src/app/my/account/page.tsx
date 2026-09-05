'use client';

import {
  BANK_CODES,
  maskedAccountSchema,
  registerAccountRequestSchema,
  type MaskedAccount,
} from '@fixer/shared';
import { useState } from 'react';
import styles from './page.module.css';

/** 검증 상태를 사람 말로 */
const STATUS_LABELS: Record<string, string> = {
  PENDING: '검증 대기',
  VERIFIED: '검증 완료',
  REJECTED: '검증 실패',
};

/**
 * 환전받을 계좌. (이슈 #30)
 *
 * **계좌번호는 등록할 때만 화면에 있고, 저장된 뒤로는 뒤 4자리만 본다.**
 * 서버가 평문을 내려보내지 않으므로 화면이 그것을 다시 보여줄 방법도 없다.
 */
export default function ExchangeAccountPage() {
  // #4가 머지되면 토큰 주체로 바뀐다. 지금은 화면에서 받는다.
  const [userId, setUserId] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [holderName, setHolderName] = useState('');

  const [account, setAccount] = useState<MaskedAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /** 회원 id가 바뀌면 그 회원의 계좌를 읽는다 */
  async function changeUserId(next: string) {
    setUserId(next);
    setAccount(null);
    setError(null);
    if (next === '') return;

    try {
      const res = await fetch(
        `/api/exchange-accounts/me?userId=${encodeURIComponent(next)}`,
      );
      const json: unknown = await res.json();
      // 404는 오류가 아니다. 아직 등록을 안 한 것뿐이다.
      if (res.status === 404) return;
      if (!res.ok) throw new Error('조회 실패');
      setAccount(maskedAccountSchema.parse(json));
    } catch {
      setError('계좌를 불러오지 못했습니다.');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // 하이픈은 화면에서 지워 보낸다. 서버도 지우지만 둘 다 하는 편이 싸다.
    const request = {
      bankCode,
      accountNumber: accountNumber.replace(/[\s-]/g, ''),
      holderName,
    };
    const parsed = registerAccountRequestSchema.safeParse(request);
    if (!parsed.success) {
      setError('은행·계좌번호·예금주를 모두 입력해 주세요.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/exchange-accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...parsed.data }),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        setError(messageOf(json));
        return;
      }
      setAccount(maskedAccountSchema.parse(json));
      // 등록한 뒤로는 화면에 평문을 남기지 않는다.
      setAccountNumber('');
    } catch {
      setError('요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>환전 계좌</h1>
      <p className={styles.note}>
        환전받을 계좌를 등록합니다. 계좌번호는 암호화되어 저장되고, 화면에는 뒤
        4자리만 보입니다.
      </p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="userId">
          회원 id
        </label>
        <input
          id="userId"
          className={styles.input}
          value={userId}
          onChange={(e) => void changeUserId(e.target.value)}
          placeholder="로그인이 붙기 전까지 직접 입력합니다"
        />
      </div>

      {account && (
        <dl className={styles.registered}>
          <div className={styles.row}>
            <dt>은행</dt>
            <dd>{account.bankName}</dd>
          </div>
          <div className={styles.row}>
            <dt>계좌번호</dt>
            <dd className={styles.numbers}>{account.maskedAccountNumber}</dd>
          </div>
          <div className={styles.row}>
            <dt>예금주</dt>
            <dd>{account.holderName}</dd>
          </div>
          <div className={styles.row}>
            <dt>상태</dt>
            <dd>
              {STATUS_LABELS[account.verificationStatus] ??
                account.verificationStatus}
              {account.rejectedReason && (
                <span className={styles.reason}>
                  {' '}
                  — {account.rejectedReason}
                </span>
              )}
            </dd>
          </div>
        </dl>
      )}

      <form className={styles.form} onSubmit={submit} noValidate>
        <h2 className={styles.subtitle}>
          {account ? '계좌 바꾸기' : '계좌 등록'}
        </h2>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="bankCode">
            은행
          </label>
          <select
            id="bankCode"
            className={styles.input}
            value={bankCode}
            onChange={(e) => setBankCode(e.target.value)}
          >
            <option value="">선택해 주세요</option>
            {Object.entries(BANK_CODES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="accountNumber">
            계좌번호
          </label>
          <input
            id="accountNumber"
            className={styles.input}
            inputMode="numeric"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="숫자만 입력 (하이픈은 자동으로 지웁니다)"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="holderName">
            예금주
          </label>
          <input
            id="holderName"
            className={styles.input}
            value={holderName}
            onChange={(e) => setHolderName(e.target.value)}
          />
        </div>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <button
          className={styles.submit}
          type="submit"
          disabled={loading || userId === ''}
        >
          {loading ? '등록하는 중…' : '계좌 등록'}
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
