import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminMemberSummary } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import { AdminMemberList } from './AdminMemberList';

/** 필터의 진실은 URL 하나다 (ADR-JOB-4). 관리자 목록 셋과 같은 대역을 쓴다 */
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

const ROW: AdminMemberSummary = {
  id: 'usr_1',
  name: '김회원',
  email: 'member@example.com',
  joinedAt: '2026-03-01T00:00:00.000Z',
  asPoster: { average: 4.5, count: 4 },
  asWorker: { average: 3.5, count: 6 },
  penaltyCount: 2,
  status: 'ACTIVE',
};

function renderList(overrides: Record<string, unknown> = {}) {
  currentQuery = '';
  return render(
    <AdminMemberList
      items={[ROW]}
      total={1}
      page={1}
      pageSize={20}
      filter={{ page: 1 }}
      {...overrides}
    />,
  );
}

describe('AdminMemberList', () => {
  it('should render name, email, joined date, both ratings, penalty count and status for each row', () => {
    renderList();

    const row = screen.getByRole('row', { name: /김회원/ });
    expect(row).toHaveTextContent('김회원');
    expect(row).toHaveTextContent('member@example.com');
    expect(row).toHaveTextContent('2026-03-01');
    expect(row).toHaveTextContent('4.5');
    expect(row).toHaveTextContent('3.5');
    expect(row).toHaveTextContent('2');
  });

  // AC4: 사라지지 않고 배지가 붙어 보인다 (§2.6 분쟁·환전 이력 추적).
  it('should show a "비활성화" badge on a deactivated row', () => {
    renderList({
      items: [{ ...ROW, id: 'usr_2', name: '정탈퇴', status: 'DEACTIVATED' }],
    });

    const row = screen.getByRole('row', { name: /정탈퇴/ });
    expect(row).toHaveTextContent('비활성화');
  });

  it('should put the applied search word and region into the URL', async () => {
    const user = userEvent.setup();
    renderList();

    await user.type(screen.getByLabelText('검색'), '김회원');
    // 시/도는 자유 입력이다. 지역 마스터 목록이 저장소에 없어 #13이 이미
    // 같은 판단을 했다 — 여기서 목록을 새로 만들지 않는다.
    await user.type(screen.getByLabelText('시/도'), '서울특별시');
    await user.click(screen.getByRole('button', { name: '검색' }));

    const query = new URLSearchParams(currentQuery);
    expect(query.get('q')).toBe('김회원');
    expect(query.get('sido')).toBe('서울특별시');
  });

  // AC5: 행을 클릭하면 상세로 간다.
  it('should link each row to that member detail page', () => {
    renderList();

    expect(screen.getByRole('link', { name: '김회원' })).toHaveAttribute(
      'href',
      '/admin/members/usr_1',
    );
  });

  it('should render a "권한이 없습니다" notice instead of the table when forbidden is true', () => {
    renderList({ forbidden: true, items: [], total: 0 });

    expect(screen.getByText(/권한이 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
