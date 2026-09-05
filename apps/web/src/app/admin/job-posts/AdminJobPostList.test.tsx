import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminJobPostSummary } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import { AdminJobPostList } from './AdminJobPostList';

/** 필터의 진실은 URL 하나다 (ADR-JOB-4). 목록 화면과 같은 대역을 쓴다 */
let currentQuery = '';
const push = vi.fn();
const replace = vi.fn((href: string) => {
  currentQuery = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(currentQuery),
}));

const ROW: AdminJobPostSummary = {
  id: 'job_1',
  title: '사무실 청소',
  employerName: '박구인',
  categoryName: '청소',
  status: 'OPEN',
  createdAt: '2026-09-01T00:00:00.000Z',
};

function renderList(overrides: Record<string, unknown> = {}) {
  return render(
    <AdminJobPostList
      items={[ROW]}
      total={1}
      page={1}
      pageSize={20}
      filter={{ page: 1 }}
      {...overrides}
    />,
  );
}

describe('AdminJobPostList', () => {
  it('should render title, employer, category, status and createdAt columns for each row', () => {
    renderList();

    const row = screen.getByRole('row', { name: /사무실 청소/ });
    expect(row).toHaveTextContent('사무실 청소');
    expect(row).toHaveTextContent('박구인');
    expect(row).toHaveTextContent('청소');
    // 상태는 코드가 아니라 사람이 읽는 말로 보여야 한다.
    expect(row).toHaveTextContent('모집 중');
    expect(row).toHaveTextContent('2026-09-01');
  });

  it('should keep the confirm button disabled until a reason is typed', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole('button', { name: '강제 취소' }));

    const confirm = screen.getByRole('button', { name: '취소 확정' });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('취소 사유'), '허위 공고');
    expect(confirm).toBeEnabled();
  });

  it('should render a "권한이 없습니다" notice instead of the table when forbidden is true', () => {
    renderList({ forbidden: true, items: [], total: 0 });

    expect(screen.getByText(/권한이 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
