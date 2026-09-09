import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminSuspensionSummary } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import { AdminSuspensionList } from './AdminSuspensionList';

/** 필터의 진실은 URL 하나다 (ADR-JOB-4). 관리자 공고 목록과 같은 대역을 쓴다 */
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

const ROW: AdminSuspensionSummary = {
  id: 'sus_1',
  userId: 'usr_penalized',
  userName: '김제재',
  startAt: '2026-09-08T00:00:00.000Z',
  endAt: '2026-09-13T00:00:00.000Z',
  reasons: ['NO_SHOW', 'LATE_CANCEL'],
  penaltyCount: 5,
};

function renderList(overrides: Record<string, unknown> = {}) {
  return render(
    <AdminSuspensionList
      items={[ROW]}
      total={1}
      page={1}
      pageSize={20}
      filter={{ page: 1 }}
      {...overrides}
    />,
  );
}

describe('AdminSuspensionList', () => {
  it('should render name, start, end, reason summary and penalty count columns for each row', () => {
    renderList();

    const row = screen.getByRole('row', { name: /김제재/ });
    expect(row).toHaveTextContent('김제재');
    expect(row).toHaveTextContent('2026-09-08');
    expect(row).toHaveTextContent('2026-09-13');
    // 사유는 코드가 아니라 사람이 읽는 말로 보여야 한다.
    expect(row).toHaveTextContent('무단 불참');
    expect(row).toHaveTextContent('5');
  });

  it('should keep the confirm button disabled until a reason is typed', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole('button', { name: '제재 해제' }));

    const confirm = screen.getByRole('button', { name: '해제 확정' });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('해제 사유'), '이의 인정');
    expect(confirm).toBeEnabled();
  });

  it('should render a "권한이 없습니다" notice instead of the table when forbidden is true', () => {
    renderList({ forbidden: true, items: [], total: 0 });

    expect(screen.getByText(/권한이 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
