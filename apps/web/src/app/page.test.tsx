import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MyProfile } from '@fixer/shared';
import Home from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));

const NAME = '김구직';

function profile(overrides: Partial<MyProfile> = {}): MyProfile {
  return {
    id: 'usr_1',
    email: 'worker@example.com',
    name: NAME,
    address: '서울 마포구 월드컵북로 1',
    role: 'USER',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

type Reply = { status: number; body?: unknown } | 'pending';

/**
 * 홈은 요청을 둘 보낸다 — 내 정보, 내 동의서. 주소로 갈라 답한다.
 * 204에는 본문이 없으므로 `json()`이 실패하게 둔다 (진짜 fetch처럼).
 */
function mockServer(replies: { me: Reply; agreement?: Reply }) {
  const fetchMock = vi.fn((url: string) => {
    const reply =
      url === '/api/auth/me'
        ? replies.me
        : url === '/api/agreements/mine'
          ? (replies.agreement ?? SIGNED)
          : { status: 404, body: {} };
    if (reply === 'pending') return new Promise(() => {});
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
const SIGNED: Reply = { status: 200, body: { id: 'agr_1' } };
const UNSIGNED: Reply = { status: 204 };

/** 로그인한 회원 화면이 다 그려질 때까지 기다린다 */
async function memberScreen() {
  await screen.findByText(`${NAME}님`);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Home', () => {
  it('should show login and signup links when /api/auth/me answers 401', async () => {
    mockServer({ me: UNAUTHENTICATED });
    render(<Home />);

    expect(await screen.findByRole('link', { name: '로그인' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.getByRole('link', { name: '가입하기' })).toHaveAttribute(
      'href',
      '/signup/verify-email',
    );
  });

  it('should show neither the developer feature list nor the connection status when logged out', async () => {
    const fetchMock = mockServer({ me: UNAUTHENTICATED });
    render(<Home />);
    await screen.findByRole('link', { name: '로그인' });

    expect(screen.queryByText('지금 써볼 수 있는 것')).not.toBeInTheDocument();
    expect(screen.queryByText('개발 환경 연결 상태')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/health');
  });

  it('should show the member name and the main menu links when /api/auth/me answers 200', async () => {
    mockServer({ me: { status: 200, body: profile() } });
    render(<Home />);
    await memberScreen();

    const menu = Object.fromEntries(
      ['공고 목록', '공고 등록', '포인트', '환전 계좌', '마이페이지'].map(
        (name) => [
          name,
          screen.getByRole('link', { name }).getAttribute('href'),
        ],
      ),
    );
    expect(menu).toEqual({
      '공고 목록': '/job-posts',
      '공고 등록': '/job-posts/new',
      포인트: '/points',
      '환전 계좌': '/my/account',
      마이페이지: '/my',
    });
  });

  it('should show a to-do link to /signup/address when the address is null', async () => {
    mockServer({ me: { status: 200, body: profile({ address: null }) } });
    render(<Home />);

    expect(
      await screen.findByRole('link', { name: '주소 등록하기' }),
    ).toHaveAttribute('href', '/signup/address');
  });

  it('should show a to-do link to /signup/agreement when /api/agreements/mine answers 204', async () => {
    mockServer({ me: { status: 200, body: profile() }, agreement: UNSIGNED });
    render(<Home />);

    expect(
      await screen.findByRole('link', { name: '동의서 서명하기' }),
    ).toHaveAttribute('href', '/signup/agreement');
  });

  /** 보이는 것은 편의일 뿐이다. 권한은 AdminGuard가 판정한다 */
  it('should show the admin menu links when the role is ADMIN', async () => {
    mockServer({ me: { status: 200, body: profile({ role: 'ADMIN' }) } });
    render(<Home />);
    await memberScreen();

    const menu = Object.fromEntries(
      ['회원 관리', '공고 관리', '환전 관리', '제재 관리'].map((name) => [
        name,
        screen.getByRole('link', { name }).getAttribute('href'),
      ]),
    );
    expect(menu).toEqual({
      '회원 관리': '/admin/members',
      '공고 관리': '/admin/job-posts',
      '환전 관리': '/admin/exchange-requests',
      '제재 관리': '/admin/suspensions',
    });
  });

  it('should show no to-do section when the address exists and the agreement is signed', async () => {
    mockServer({ me: { status: 200, body: profile() }, agreement: SIGNED });
    render(<Home />);
    await memberScreen();
    // 동의서 응답까지 받은 뒤에 본다. 그전에 보면 "아직 없다"가 우연히 맞는다.
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/agreements/mine');
    });

    expect(screen.queryByText('남은 할 일')).not.toBeInTheDocument();
  });

  it('should show no agreement to-do when /api/agreements/mine answers neither 200 nor 204', async () => {
    mockServer({
      me: { status: 200, body: profile() },
      agreement: { status: 500, body: {} },
    });
    render(<Home />);
    await memberScreen();
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/agreements/mine');
    });

    expect(
      screen.queryByRole('link', { name: '동의서 서명하기' }),
    ).not.toBeInTheDocument();
  });

  /** 로그인한 사람에게 "가입하기"가 깜빡이면 안 된다 */
  it('should show neither login links nor the menu while /api/auth/me is pending', async () => {
    const fetchMock = mockServer({ me: 'pending' });
    render(<Home />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/me');
    });
    expect(
      screen.queryByRole('link', { name: '가입하기' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: '마이페이지' }),
    ).not.toBeInTheDocument();
  });

  it('should not show the admin menu when the role is USER', async () => {
    mockServer({ me: { status: 200, body: profile({ role: 'USER' }) } });
    render(<Home />);
    await memberScreen();

    expect(
      screen.queryByRole('link', { name: '회원 관리' }),
    ).not.toBeInTheDocument();
  });

  it('should show login and signup links when /api/auth/me fails with 500', async () => {
    mockServer({ me: { status: 500, body: {} } });
    render(<Home />);

    expect(await screen.findByRole('link', { name: '로그인' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.getByRole('link', { name: '가입하기' })).toBeInTheDocument();
  });
});
