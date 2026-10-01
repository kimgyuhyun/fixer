import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MyProfile } from '@fixer/shared';
import MyPage from './page';

/** 로그아웃 뒤에 어디로 보냈는지만 본다. 실제 라우팅은 Next의 몫이다 */
const replace = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: replace, refresh }),
}));

const EMAIL = 'worker@example.com';
const NAME = '김구직';

/** fetch 한 번에 대한 응답을 정한다. 실제 서버가 주는 모양 그대로 쓴다 */
function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function profile(): MyProfile {
  return {
    id: 'usr_1',
    email: EMAIL,
    name: NAME,
    address: null,
    role: 'USER',
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('MyPage', () => {
  it('should show my email and name', async () => {
    mockFetchOnce(200, profile());
    render(<MyPage />);

    expect(await screen.findByText(EMAIL)).toBeInTheDocument();
    expect(await screen.findByText(NAME)).toBeInTheDocument();
  });

  it('should show that no address is registered yet', async () => {
    mockFetchOnce(200, profile());
    render(<MyPage />);

    // 주소 등록은 #3의 몫이다. 지금은 비어 있음을 자연스럽게 알린다.
    expect(
      await screen.findByText('아직 등록하지 않았습니다'),
    ).toBeInTheDocument();
  });
});

/**
 * 마이페이지는 요청을 셋 보낸다 — 내 정보, 내 동의서, 평점. 주소로 갈라 답한다.
 * 204에는 본문이 없으므로 `json()`이 실패하게 둔다 (진짜 fetch처럼).
 */
function mockServer(replies: {
  profile: ReturnType<typeof profile>;
  agreement: { status: number; body?: unknown };
}) {
  const fetchMock = vi.fn((url: string) => {
    const reply =
      url === '/api/auth/me'
        ? { status: 200, body: replies.profile as unknown }
        : url === '/api/agreements/mine'
          ? replies.agreement
          : { status: 200, body: { asPoster: null, asWorker: null } };
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

const SIGNED = {
  status: 200,
  body: {
    id: 'agr_1',
    templateVersion: 3,
    agreedAt: '2026-09-03T00:00:00.000Z',
  },
};
const NOT_SIGNED = { status: 204 };

/** 가입을 중간에 멈춘 회원이 이어서 할 길 (#82 AC7) */
describe('MyPage 이어서 하기', () => {
  it('should show the registered address when the profile carries one', async () => {
    mockServer({
      profile: { ...profile(), address: '서울 강남구 테헤란로 152' },
      agreement: SIGNED,
    });
    render(<MyPage />);

    expect(
      await screen.findByText('서울 강남구 테헤란로 152'),
    ).toBeInTheDocument();
  });

  it('should show a link to /signup/address when the profile address is null', async () => {
    mockServer({ profile: profile(), agreement: SIGNED });
    render(<MyPage />);

    expect(
      await screen.findByRole('link', { name: '주소 등록하기' }),
    ).toHaveAttribute('href', '/signup/address');
  });

  it('should show a link to /signup/agreement when /api/agreements/mine answers 204', async () => {
    mockServer({ profile: profile(), agreement: NOT_SIGNED });
    render(<MyPage />);

    expect(
      await screen.findByRole('link', { name: '동의서 서명하기' }),
    ).toHaveAttribute('href', '/signup/agreement');
  });

  it('should show a link to /my/agreement when /api/agreements/mine answers 200', async () => {
    mockServer({ profile: profile(), agreement: SIGNED });
    render(<MyPage />);

    expect(
      await screen.findByRole('link', { name: '내 동의서 보기' }),
    ).toHaveAttribute('href', '/my/agreement');
  });

  it('should not show the old note about issue #3', async () => {
    mockServer({ profile: profile(), agreement: SIGNED });
    render(<MyPage />);
    await screen.findByText(EMAIL);

    expect(screen.queryByText(/이슈 #3/)).not.toBeInTheDocument();
  });
});

describe('MyPage 로그아웃', () => {
  it('should call the logout endpoint and move to /login when 로그아웃 is pressed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(profile()),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MyPage />);
    await screen.findByText(EMAIL);

    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('should invalidate the client router cache so a back navigation cannot replay /my', async () => {
    // spec-fixed §2.5의 세 번째 방어. bfcache는 no-store로 막히지만 Next의
    // 클라이언트 Router Cache는 별개 메커니즘이라 명시적으로 지워야 한다.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(profile()),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MyPage />);
    await screen.findByText(EMAIL);

    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }));

    expect(refresh).toHaveBeenCalled();
  });

  it('should still move to /login when the logout request fails', async () => {
    // 서버가 실패해도 이 브라우저는 로그인 화면으로 보낸다. 남아 있으면
    // 로그아웃한 줄 알았는데 보호 페이지가 그대로 보인다.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(profile()),
      })
      .mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    render(<MyPage />);
    await screen.findByText(EMAIL);

    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }));

    expect(replace).toHaveBeenCalledWith('/login');
  });
});

/**
 * 미들웨어는 Refresh 쿠키만 있어도 통과시킨다 (#83). 그 Refresh가 서버에서
 * 폐기됐으면(비밀번호 재설정 등) 여기서 처음으로 401을 받는다.
 */
describe('MyPage 로그인 만료', () => {
  it('should replace the location with /login without showing an error when /api/auth/me answers 401', async () => {
    mockFetchOnce(401, {
      errorCode: 'AUTH_UNAUTHENTICATED',
      message: '로그인이 필요합니다.',
    });
    render(<MyPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should keep the server message and not move when /api/auth/me answers 403', async () => {
    // 401만 로그인 화면으로 보낸다. 탈퇴 안내까지 지우면 재활성화로 갈 길을 잃는다.
    mockFetchOnce(403, {
      errorCode: 'AUTH_ACCOUNT_DEACTIVATED',
      message: '탈퇴한 계정입니다. 재활성화 후 이용해 주세요.',
    });
    render(<MyPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '탈퇴한 계정입니다. 재활성화 후 이용해 주세요.',
    );
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('MyPage 비밀번호', () => {
  it('should not offer a 비밀번호 변경 menu', async () => {
    // spec-fixed §2.4 — 마이페이지 변경은 아예 만들지 않는다. 재설정만 연다.
    mockFetchOnce(200, profile());
    render(<MyPage />);
    await screen.findByText(EMAIL);

    expect(screen.queryByText(/비밀번호 변경/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /비밀번호 변경/ }),
    ).not.toBeInTheDocument();
  });
});
