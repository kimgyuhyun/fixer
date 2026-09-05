'use client';

import {
  CHARGE_UNIT,
  pointHistorySchema,
  refundResultSchema,
  startedChargeSchema,
  type PointHistory,
} from '@fixer/shared';
import { useCallback, useState } from 'react';
import styles from './page.module.css';

/** 화면에 띄울 금액 버튼. 자주 쓰는 값만 둔다 */
const PRESETS = [10_000, 30_000, 50_000, 100_000];

/**
 * 포인트 충전과 내역. (이슈 #28)
 *
 * **결제창은 아직 뜨지 않는다.** 포트원 채널키가 있어야 열리는데 지금은
 * 테스트 모드 키도 없다(ADR-PAY-5). 그래서 이 화면은 서버가 결제 건을
 * 만들고 곧바로 확정하는 개발 흐름을 탄다 — 실결제 전환 때 이 사이에
 * 결제창 호출 한 줄이 들어간다.
 */
export default function PointsPage() {
  // #4가 머지되면 토큰 주체로 바뀐다. 지금은 화면에서 받는다.
  const [userId, setUserId] = useState('');
  const [history, setHistory] = useState<PointHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** 방금 환불이 어느 결제 건에서 얼마씩 빠졌나 */
  const [refunded, setRefunded] = useState<
    { paymentId: string; amount: number }[] | null
  >(null);

  const load = useCallback(async (id: string) => {
    if (id === '') return;
    try {
      const res = await fetch(
        `/api/points/me?userId=${encodeURIComponent(id)}`,
      );
      const json: unknown = await res.json();
      if (!res.ok) {
        setError(messageOf(json));
        return;
      }
      setHistory(pointHistorySchema.parse(json));
      setError(null);
    } catch {
      setError('내역을 불러오지 못했습니다.');
    }
  }, []);

  /**
   * 회원 id가 바뀔 때 내역을 다시 읽는다.
   *
   * 효과(useEffect)에서 부르지 않는 이유는 그 안의 setState를 React가
   * 연쇄 렌더로 보기 때문이다(react-hooks 규칙). 사용자가 값을 바꾼
   * 사건에 붙이는 것이 사실에도 더 가깝다.
   */
  function changeUserId(next: string) {
    setUserId(next);
    void load(next);
  }

  /**
   * 금액만큼 환불한다. **오래된 결제 건부터 소진된다** (ADR-PAY-7).
   *
   * 어느 결제 건에서 얼마가 빠졌는지를 그대로 보여준다 — 카드 취소는
   * 결제 건마다 따로 나가므로, 묶어서 "5.5만원 환불"이라고만 하면
   * 명세서에 두 줄이 찍힌 이유를 알 수 없다.
   */
  async function refund(amount: number) {
    setError(null);
    setRefunded(null);
    setLoading(true);
    try {
      const res = await fetch('/api/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amount }),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        setError(messageOf(json));
        return;
      }
      setRefunded(refundResultSchema.parse(json).lots);
      await load(userId);
    } catch {
      setError('요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  async function charge(amount: number) {
    setError(null);
    setLoading(true);
    try {
      const startRes = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amount }),
      });
      const startJson: unknown = await startRes.json();
      if (!startRes.ok) {
        setError(messageOf(startJson));
        return;
      }
      const started = startedChargeSchema.parse(startJson);

      // 실결제에서는 여기서 결제창이 뜬다. 지금은 바로 확정으로 넘어간다.
      const confirmRes = await fetch('/api/payments/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, paymentId: started.paymentId }),
      });
      const confirmJson: unknown = await confirmRes.json();
      if (!confirmRes.ok) {
        setError(messageOf(confirmJson));
        return;
      }

      await load(userId);
    } catch {
      setError('요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>포인트</h1>
      <p className={styles.note}>
        포트원 채널키가 아직 없어 결제창 대신 서버가 바로 확정합니다. 실결제
        전환 시 이 자리에 결제창이 뜹니다.
      </p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="userId">
          회원 id
        </label>
        <input
          id="userId"
          className={styles.input}
          value={userId}
          onChange={(e) => changeUserId(e.target.value)}
          placeholder="로그인이 붙기 전까지 직접 입력합니다"
        />
      </div>

      <p className={styles.balance}>
        잔액 <strong>{(history?.balance ?? 0).toLocaleString()}</strong> 포인트
      </p>

      <div className={styles.presets}>
        {PRESETS.map((amount) => (
          <button
            key={amount}
            className={styles.preset}
            type="button"
            disabled={loading || userId === ''}
            onClick={() => void charge(amount)}
          >
            {(amount / CHARGE_UNIT).toLocaleString()}천원
          </button>
        ))}
      </div>

      <h2 className={styles.subtitle}>환불</h2>
      <p className={styles.note}>
        오래된 결제 건부터 취소됩니다. 카드 취소 기한이 그쪽부터 먼저 만료되기
        때문입니다.
      </p>
      <div className={styles.presets}>
        {PRESETS.map((amount) => (
          <button
            key={`refund-${amount}`}
            className={styles.preset}
            type="button"
            disabled={loading || userId === ''}
            onClick={() => void refund(amount)}
          >
            {(amount / CHARGE_UNIT).toLocaleString()}천원 환불
          </button>
        ))}
      </div>

      {refunded && (
        <ul className={styles.list}>
          {refunded.map((lot) => (
            <li key={lot.paymentId} className={styles.row}>
              <span className={styles.type}>{lot.paymentId}</span>
              <span className={styles.amount}>
                -{lot.amount.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <h2 className={styles.subtitle}>내역</h2>
      {history === null || history.transactions.length === 0 ? (
        <p className={styles.empty}>아직 내역이 없습니다.</p>
      ) : (
        <ul className={styles.list}>
          {history.transactions.map((tx) => (
            <li key={tx.id} className={styles.row}>
              <span className={styles.type}>{LABELS[tx.type] ?? tx.type}</span>
              <span className={styles.amount}>
                {tx.amount > 0 ? '+' : ''}
                {tx.amount.toLocaleString()}
              </span>
              <time className={styles.time} dateTime={tx.createdAt}>
                {new Date(tx.createdAt).toLocaleString('ko-KR')}
              </time>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/** 원장 유형을 사람 말로. 코드가 그대로 보이면 무슨 뜻인지 알 수 없다 */
const LABELS: Record<string, string> = {
  CHARGE: '충전',
  HOLD: '예산 잠금',
  RELEASE: '잠금 해제',
  PAYOUT: '지급',
  EXCHANGE_REQUEST: '환전 요청',
  EXCHANGE_REVERT: '환전 반려',
  REFUND: '결제 취소',
};

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
