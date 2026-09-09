'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import {
  EXCHANGE_REQUEST_STATUSES,
  type AccountVerificationStatus,
  type AdminExchangeFilter,
  type AdminExchangeRequestSummary,
  type ExchangeRequestStatus,
  type RevealedAccount,
} from '@fixer/shared';
import styles from './page.module.css';

export interface AdminExchangeListProps {
  items: AdminExchangeRequestSummary[];
  total: number;
  page: number;
  pageSize: number;
  filter: AdminExchangeFilter;
  /** 403을 받았다. 표 대신 안내를 그린다 (#35와 같다) */
  forbidden?: boolean;
}

/** 상태 코드를 사람이 읽는 말로. 화면에 `REQUESTED`가 그대로 뜨면 안 된다 */
const STATUS_LABELS: Record<ExchangeRequestStatus, string> = {
  REQUESTED: '요청됨',
  APPROVED: '승인됨',
  COMPLETED: '이체 완료',
  REJECTED: '반려됨',
};

const VERIFICATION_LABELS: Record<AccountVerificationStatus, string> = {
  PENDING: '검증 대기',
  VERIFIED: '검증됨',
  REJECTED: '검증 실패',
};

/**
 * 관리자 환전 요청 목록. (이슈 #34, `spec-fixed.md` §11.5)
 *
 * **계좌번호는 기본이 마스킹이다.** 전체는 별도 버튼으로만 열리고, 그
 * 열람은 서버에 감사 로그로 남는다.
 */
export function AdminExchangeList({
  items,
  total,
  forbidden,
}: AdminExchangeListProps): ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  /** 이번 화면에서 열어 본 계좌번호. 새로고침하면 다시 마스킹이다 */
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<AdminExchangeRequestSummary | null>(
    null,
  );
  const [reason, setReason] = useState('');

  if (forbidden) {
    return (
      <main className={styles.page}>
        <p className={styles.notice}>권한이 없습니다.</p>
      </main>
    );
  }

  function submitFilter(next: Record<string, string>): void {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === '') query.delete(key);
      else query.set(key, value);
    }
    // 필터를 바꾸면 첫 페이지로 돌아간다. 3페이지에서 좁히면 빈 화면이 된다.
    query.delete('page');
    router.replace(`?${query.toString()}`);
  }

  async function act(id: string, action: string): Promise<void> {
    await fetch(`/api/admin/exchange-requests/${id}/${action}`, {
      method: 'POST',
    });
    router.refresh();
  }

  async function reveal(id: string): Promise<void> {
    const res = await fetch(
      `/api/admin/exchange-requests/${id}/reveal-account`,
      { method: 'POST' },
    );
    if (!res.ok) return;
    const body = (await res.json()) as RevealedAccount;
    setRevealed((current) => ({ ...current, [id]: body.accountNumber }));
  }

  async function confirmReject(): Promise<void> {
    if (target === null) return;
    await fetch(`/api/admin/exchange-requests/${target.id}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    setTarget(null);
    setReason('');
    router.refresh();
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>환전 관리</h1>

      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          submitFilter({ status: String(form.get('status') ?? '') });
        }}
      >
        <label className={styles.field}>
          상태
          <select name="status" defaultValue={params.get('status') ?? ''}>
            <option value="">전체</option>
            {EXCHANGE_REQUEST_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">검색</button>
      </form>

      <p className={styles.total}>총 {total}건</p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">신청자</th>
              <th scope="col">요청 금액</th>
              <th scope="col">은행·계좌</th>
              <th scope="col">예금주</th>
              <th scope="col">검증 상태</th>
              <th scope="col">요청일</th>
              <th scope="col">상태</th>
              <th scope="col">조치</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.requesterName}</td>
                <td className={styles.number}>
                  {item.amount.toLocaleString('ko-KR')}원
                </td>
                <td>
                  {item.account === null ? (
                    '계좌 없음'
                  ) : (
                    <>
                      {item.account.bankName}{' '}
                      {/* 번호를 자기 요소로 둔다. 은행명과 한 문자열이면
                          "전체가 보인다"를 눈으로도 검사로도 가리기 어렵다 */}
                      <span>
                        {revealed[item.id] ?? item.account.maskedAccountNumber}
                      </span>
                    </>
                  )}
                </td>
                <td>{item.account?.holderName ?? '-'}</td>
                <td className={styles.center}>
                  {item.account === null
                    ? '-'
                    : VERIFICATION_LABELS[item.account.verificationStatus]}
                </td>
                <td className={styles.center}>
                  {item.requestedAt.slice(0, 10)}
                </td>
                <td className={styles.center}>{STATUS_LABELS[item.status]}</td>
                <td>
                  <div className={styles.rowActions}>
                    {item.status === 'REQUESTED' && (
                      <button
                        type="button"
                        onClick={() => void act(item.id, 'approve')}
                      >
                        승인
                      </button>
                    )}
                    {item.status === 'APPROVED' && (
                      <button
                        type="button"
                        onClick={() => void act(item.id, 'complete')}
                      >
                        이체 완료
                      </button>
                    )}
                    {/* 열람은 이체할 때만 필요하다. 그래서 별도 버튼이다 */}
                    <button
                      type="button"
                      disabled={item.account === null}
                      onClick={() => void reveal(item.id)}
                    >
                      계좌번호 전체 보기
                    </button>
                    <button type="button" onClick={() => setTarget(item)}>
                      반려
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {target !== null && (
        <div className={styles.dialog} role="dialog" aria-label="환전 반려">
          <p>
            <strong>{target.requesterName}</strong>님의 환전 요청을 반려합니다.
            요청 금액은 포인트로 되돌아갑니다.
          </p>
          <label className={styles.field}>
            반려 사유
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className={styles.actions}>
            <button type="button" onClick={() => setTarget(null)}>
              닫기
            </button>
            {/* 사유 없는 조치는 감사 로그의 "왜"가 빈 채로 남는다 (§11.5) */}
            <button
              type="button"
              disabled={reason.trim() === ''}
              onClick={() => void confirmReject()}
            >
              반려 확정
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
