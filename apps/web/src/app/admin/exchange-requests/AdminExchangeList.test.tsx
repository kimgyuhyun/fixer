import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminExchangeRequestSummary } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import { AdminExchangeList } from './AdminExchangeList';

/** 필터의 진실은 URL 하나다. 관리자 공고 목록(#35)과 같은 대역을 쓴다 */
let currentQuery = '';
const push = vi.fn();
const replace = vi.fn((href: string) => {
  currentQuery = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
});
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, refresh }),
  useSearchParams: () => new URLSearchParams(currentQuery),
}));

const ROW: AdminExchangeRequestSummary = {
  id: 'exr_1',
  requesterName: '김구직',
  amount: 10_000,
  status: 'REQUESTED',
  requestedAt: '2026-09-01T00:00:00.000Z',
  account: {
    bankName: '신한은행',
    maskedAccountNumber: '****5678',
    holderName: '김구직',
    verificationStatus: 'VERIFIED',
  },
};

function renderList(overrides: Record<string, unknown> = {}) {
  return render(
    <AdminExchangeList
      items={[ROW]}
      total={1}
      page={1}
      pageSize={20}
      filter={{ page: 1 }}
      {...overrides}
    />,
  );
}

describe('AdminExchangeList', () => {
  it('should render the requester, amount, masked account and verification status of each row', () => {
    renderList();

    const row = screen.getByRole('row', { name: /김구직/ });
    expect(row).toHaveTextContent('김구직');
    expect(row).toHaveTextContent('10,000');
    expect(row).toHaveTextContent('****5678');
    // 검증 상태는 코드가 아니라 사람이 읽는 말로 보여야 한다.
    expect(row).toHaveTextContent('검증됨');
  });

  // 평문 계좌번호가 목록에 그냥 떠 있으면 열람 기록이 의미를 잃는다 (§11.5).
  it('should keep the account number masked until the reveal button is pressed', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ accountNumber: '11012345678' }),
        }),
      ),
    );
    renderList();

    expect(screen.queryByText('11012345678')).toBeNull();

    await user.click(
      screen.getByRole('button', { name: '계좌번호 전체 보기' }),
    );

    expect(await screen.findByText('11012345678')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
