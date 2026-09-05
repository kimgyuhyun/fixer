import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './page';

const EMAIL = 'worker@example.com';
const PASSWORD = 'good-password';

/** 로그인에 성공하면 마이페이지로 옮겨간다. 그 이동을 지켜보려고 라우터를 가로챈다 */
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

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

async function fillAndSubmit(email = EMAIL, password = PASSWORD) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('이메일'), email);
  await user.type(screen.getByLabelText('비밀번호'), password);
  await user.click(screen.getByRole('button', { name: '로그인' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

describe('LoginPage', () => {
  it('should send the email and password and move to the my page when login succeeds', async () => {
    const fetchMock = mockFetchOnce(200, {
      id: 'usr_1',
      email: EMAIL,
      name: '김구직',
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
      expect(push).toHaveBeenCalledWith('/my');
    });
  });

  it('should show the server message without telling which field was wrong when the credentials are rejected', async () => {
    mockFetchOnce(401, {
      errorCode: 'AUTH_INVALID_CREDENTIALS',
      message: '이메일 또는 비밀번호가 올바르지 않습니다.',
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
