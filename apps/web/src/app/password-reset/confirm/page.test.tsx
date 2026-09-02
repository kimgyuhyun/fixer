import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PasswordResetConfirmPage from './page';

/** 토큰은 링크 쿼리로 온다 */
const searchParams = vi.hoisted(
  () => new URLSearchParams('token=issued-token'),
);
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));

const NEW_PASSWORD = 'new-good-password';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PasswordResetConfirmPage', () => {
  it('should submit the token from the URL query with the entered password', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    render(<PasswordResetConfirmPage />);

    await userEvent.type(
      await screen.findByLabelText('새 비밀번호'),
      NEW_PASSWORD,
    );
    await userEvent.click(
      screen.getByRole('button', { name: '비밀번호 바꾸기' }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset/confirm',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          token: 'issued-token',
          newPassword: NEW_PASSWORD,
        }),
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      '모두 끊었습니다',
    );
  });

  it('should show the server message when the token was already used', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          errorCode: 'AUTH_RESET_TOKEN_INVALID',
          message: '재설정 링크가 유효하지 않습니다. 다시 요청해 주세요.',
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PasswordResetConfirmPage />);

    await userEvent.type(
      await screen.findByLabelText('새 비밀번호'),
      NEW_PASSWORD,
    );
    await userEvent.click(
      screen.getByRole('button', { name: '비밀번호 바꾸기' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '재설정 링크가 유효하지 않습니다',
    );
  });

  it('should reject a password shorter than 8 characters before calling fetch', async () => {
    // 서버와 같은 스키마로 먼저 본다. 규칙에 걸린 요청이 1회용 토큰을 태우지 않는다.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<PasswordResetConfirmPage />);

    await userEvent.type(
      await screen.findByLabelText('새 비밀번호'),
      'short12',
    );
    await userEvent.click(
      screen.getByRole('button', { name: '비밀번호 바꾸기' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '비밀번호는 8자 이상이어야 합니다',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
