import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignupAccountPage from './page';

const EMAIL = 'worker@example.com';
const NAME = '김구직';
const PASSWORD = 'good-password';

/**
 * 인증을 마친 이메일은 #1 화면이 sessionStorage에 남긴다.
 *
 * 주소창(query string)에 싣지 않는 이유는 이메일이 개인정보이기 때문이다.
 * 링크를 공유하거나 브라우저 이력에 남으면 그대로 새어나간다.
 */
const VERIFIED_EMAIL_KEY = 'fixer.signup.email';

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

function createdBody() {
  return {
    id: 'usr_1',
    email: EMAIL,
    name: NAME,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

async function fillAndSubmit(password: string, name = NAME) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('이름'), name);
  await user.type(screen.getByLabelText('비밀번호'), password);
  await user.click(screen.getByRole('button', { name: '가입하기' }));
}

beforeEach(() => {
  sessionStorage.setItem(VERIFIED_EMAIL_KEY, EMAIL);
});

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('SignupAccountPage', () => {
  it('should show the verified email with the name and password fields', () => {
    render(<SignupAccountPage />);

    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(screen.getByLabelText('이름')).toBeInTheDocument();
    expect(screen.getByLabelText('비밀번호')).toBeInTheDocument();
  });

  it('should show a password field error and send no request when the password is shorter than 8', async () => {
    const fetchMock = mockFetchOnce(201, createdBody());
    render(<SignupAccountPage />);

    await fillAndSubmit('short');

    expect(
      screen.getByText('비밀번호는 8자 이상이어야 합니다.'),
    ).toBeInTheDocument();
    // "저장되지 않는다" — 요청 자체가 나가지 않아야 한다.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should show the server message when the server rejects the signup', async () => {
    mockFetchOnce(409, {
      errorCode: 'MEMBER_EMAIL_ALREADY_EXISTS',
      message: '이미 가입된 이메일입니다.',
    });
    render(<SignupAccountPage />);

    await fillAndSubmit(PASSWORD);

    expect(
      await screen.findByText('이미 가입된 이메일입니다.'),
    ).toBeInTheDocument();
  });

  it('should show the completion state when signup succeeds', async () => {
    mockFetchOnce(201, createdBody());
    render(<SignupAccountPage />);

    await fillAndSubmit(PASSWORD);

    expect(
      await screen.findByText('가입이 완료되었습니다'),
    ).toBeInTheDocument();
  });

  it('should guide back to email verification when no verified email was carried over', () => {
    sessionStorage.clear();

    render(<SignupAccountPage />);

    expect(
      screen.getByRole('link', { name: '이메일 인증하러 가기' }),
    ).toBeInTheDocument();
  });
});
