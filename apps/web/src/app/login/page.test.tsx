import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './page';

const EMAIL = 'worker@example.com';
const PASSWORD = 'good-password';

/** 로그인에 성공하면 마이페이지로 옮겨간다. 그 이동을 지켜보려고 라우터를 가로챈다 */
const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
}));

interface Reply {
  status: number;
  body: unknown;
}

const NOT_SIGNED_IN: Reply = {
  status: 401,
  body: { errorCode: 'AUTH_UNAUTHENTICATED', message: '로그인이 필요합니다.' },
};

/**
 * 로그인 화면은 요청을 둘 보낸다 — 들어올 때 `/api/auth/me`(이미 로그인했나),
 * 제출할 때 `/api/auth/login`. 주소로 갈라 답한다.
 */
function mockServer(replies: { me?: Reply; login?: Reply } = {}) {
  const fetchMock = vi.fn((url: string) => {
    const reply =
      url === '/api/auth/me'
        ? (replies.me ?? NOT_SIGNED_IN)
        : (replies.login ?? { status: 500, body: {} });
    return Promise.resolve({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: () => Promise.resolve(reply.body),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function fillAndSubmit(email = EMAIL, password = PASSWORD) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('이메일'), email);
  await user.type(screen.getByLabelText('비밀번호'), password);
  await user.click(screen.getByRole('button', { name: '로그인' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
  replace.mockClear();
});

describe('LoginPage', () => {
  it('should send the email and password and replace the location with /my when login succeeds', async () => {
    // push면 뒤로 가기가 로그인 입력 화면으로 돌아간다. 풀린 것처럼 보인다. (#83)
    const fetchMock = mockServer({
      login: {
        status: 200,
        body: { id: 'usr_1', email: EMAIL, name: '김구직' },
      },
    });
    render(<LoginPage />);

    await fillAndSubmit();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
        }) as unknown,
      );
    });
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/my');
    });
    expect(push).not.toHaveBeenCalled();
  });

  it('should show the server message without telling which field was wrong when the credentials are rejected', async () => {
    mockServer({
      login: {
        status: 401,
        body: {
          errorCode: 'AUTH_INVALID_CREDENTIALS',
          message: '이메일 또는 비밀번호가 올바르지 않습니다.',
        },
      },
    });
    render(<LoginPage />);

    await fillAndSubmit(EMAIL, 'wrong-password');

    // 서버가 준 문구를 그대로 쓴다. 화면이 "비밀번호가 틀렸습니다"처럼
    // 어느 쪽이 틀렸는지 좁혀 말하면 AC2가 깨진다.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      '이메일 또는 비밀번호가 올바르지 않습니다.',
    );
  });
});

/**
 * 로그인 상태는 쿠키가 아니라 `/api/auth/me`로 판단한다 (#83). 쿠키가 남았는데
 * 서버에서 폐기됐으면, 쿠키만 보고 막는 순간 로그인 화면에 영영 못 들어온다.
 */
describe('LoginPage 이미 로그인', () => {
  it('should replace the location with /my without showing the inputs when /api/auth/me answers 200', async () => {
    mockServer({
      me: {
        status: 200,
        body: {
          id: 'usr_1',
          email: EMAIL,
          name: '김구직',
          address: null,
          createdAt: '2026-09-01T00:00:00.000Z',
        },
      },
    });
    render(<LoginPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/my');
    });
    expect(screen.queryByLabelText('이메일')).not.toBeInTheDocument();
  });

  it('should show the login form when /api/auth/me answers 401', async () => {
    mockServer({ me: NOT_SIGNED_IN });
    render(<LoginPage />);

    expect(await screen.findByLabelText('이메일')).toBeInTheDocument();
  });

  it('should not show the inputs while /api/auth/me has not answered yet', () => {
    // 폼을 먼저 띄우고 나중에 옮기면 "입력 칸 대신"이 깜빡임으로 깨진다.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    render(<LoginPage />);

    expect(screen.queryByLabelText('이메일')).not.toBeInTheDocument();
  });

  it('should show the login form when the /api/auth/me request fails', async () => {
    // 확인이 실패했다고 로그인할 길까지 막지 않는다.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down'))),
    );
    render(<LoginPage />);

    expect(await screen.findByLabelText('이메일')).toBeInTheDocument();
  });
});
