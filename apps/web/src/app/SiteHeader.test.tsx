import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MyProfile } from '@fixer/shared';
import SiteHeader from './SiteHeader';

/** 로그아웃 뒤에 어디로 보냈는지만 본다. 실제 라우팅은 Next의 몫이다 */
const replace = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
/** 테스트가 바꿔 끼운다. 레이아웃은 화면을 옮겨도 다시 마운트되지 않는다 */
const path = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: replace, refresh }),
  usePathname: () => path.current,
}));

const NAME = '김구직';

function profile(): MyProfile {
  return {
    id: 'usr_1',
    email: 'worker@example.com',
    name: NAME,
    address: null,
    role: 'USER',
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

type Reply = { status: number; body?: unknown } | 'pending' | 'network-error';

/**
 * 헤더는 요청을 셋 보낸다 — 내 정보, 알림(벨), 로그아웃. 주소로 갈라 답한다.
 * 알림은 이 테스트의 관심이 아니므로 빈 목록으로 둔다.
 */
function mockServer(replies: { me: Reply; logout?: Reply }) {
  const fetchMock = vi.fn((url: string) => {
    const reply =
      url === '/api/auth/me'
        ? replies.me
        : url === '/api/auth/logout'
          ? (replies.logout ?? { status: 204 })
          : { status: 200, body: { items: [], unreadCount: 0 } };
    if (reply === 'pending') return new Promise(() => {});
    if (reply === 'network-error')
      return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: () =>
        reply.body === undefined
          ? Promise.reject(new SyntaxError('Unexpected end of JSON input'))
          : Promise.resolve(reply.body),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const UNAUTHENTICATED: Reply = {
  status: 401,
  body: { errorCode: 'AUTH_UNAUTHENTICATED', message: '로그인이 필요합니다.' },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  path.current = '/';
});

describe('SiteHeader', () => {
  it('should link fixer to the home page', async () => {
    mockServer({ me: UNAUTHENTICATED });
    render(<SiteHeader />);

    expect(await screen.findByRole('link', { name: 'fixer' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('should show the member name and a logout button when /api/auth/me answers 200', async () => {
    mockServer({ me: { status: 200, body: profile() } });
    render(<SiteHeader />);

    expect(await screen.findByText(NAME)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '로그아웃' }),
    ).toBeInTheDocument();
  });

  it('should show a login link to /login when /api/auth/me answers 401', async () => {
    mockServer({ me: UNAUTHENTICATED });
    render(<SiteHeader />);

    expect(await screen.findByRole('link', { name: '로그인' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  /**
   * 마이페이지 로그아웃과 같은 순서다 (#5). `refresh()`가 Router Cache를 지우지
   * 않으면 뒤로 가기가 로그아웃 전 화면을 되살린다.
   */
  it('should post /api/auth/logout then refresh then replace to /login when logout is clicked', async () => {
    const fetchMock = mockServer({ me: { status: 200, body: profile() } });
    render(<SiteHeader />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: '로그아웃' }));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });
    const logoutCall = fetchMock.mock.calls.findIndex(
      ([url]) => url === '/api/auth/logout',
    );
    expect(fetchMock.mock.calls[logoutCall]).toEqual([
      '/api/auth/logout',
      { method: 'POST' },
    ]);
    const order = [
      fetchMock.mock.invocationCallOrder[logoutCall] ?? Infinity,
      refresh.mock.invocationCallOrder[0] ?? Infinity,
      replace.mock.invocationCallOrder[0] ?? Infinity,
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  /**
   * 레이아웃은 화면을 옮겨도 다시 그려지지 않는다. 처음 한 번만 물으면
   * `/login`에서 로그인하고 `/my`로 가도 헤더가 계속 "로그인"을 띄운다.
   */
  it('should ask /api/auth/me again when the path changes', async () => {
    const fetchMock = mockServer({ me: UNAUTHENTICATED });
    const { rerender } = render(<SiteHeader />);
    await screen.findByRole('link', { name: '로그인' });

    path.current = '/my';
    rerender(<SiteHeader />);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([url]) => url === '/api/auth/me'),
      ).toHaveLength(2);
    });
  });

  it('should show neither the name nor the login link while /api/auth/me is pending', async () => {
    const fetchMock = mockServer({ me: 'pending' });
    render(<SiteHeader />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/me');
    });
    expect(
      screen.queryByRole('link', { name: '로그인' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '로그아웃' }),
    ).not.toBeInTheDocument();
  });

  it('should show the login link when /api/auth/me fails with a network error', async () => {
    mockServer({ me: 'network-error' });
    render(<SiteHeader />);

    expect(await screen.findByRole('link', { name: '로그인' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  /** 서버가 실패해도 로그인 화면으로 보낸다 — 마이페이지 로그아웃과 같다 */
  it('should still refresh and replace to /login when the logout request fails', async () => {
    mockServer({
      me: { status: 200, body: profile() },
      logout: 'network-error',
    });
    render(<SiteHeader />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: '로그아웃' }));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });
    expect(refresh).toHaveBeenCalled();
  });
});
