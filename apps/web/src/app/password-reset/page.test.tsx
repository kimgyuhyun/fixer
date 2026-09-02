import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PasswordResetPage from './page';

const EMAIL = 'worker@example.com';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PasswordResetPage', () => {
  it('should show a sent notice after requesting a reset mail', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    render(<PasswordResetPage />);

    await userEvent.type(screen.getByLabelText('이메일'), EMAIL);
    await userEvent.click(
      screen.getByRole('button', { name: '재설정 메일 받기' }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      '메일을 보냈습니다',
    );
  });

  it('should show the same notice when the email belongs to nobody', async () => {
    // 가입 여부를 화면으로도 알려주지 않는다. 서버가 204를 주는 것과 같은 이유다.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    render(<PasswordResetPage />);

    await userEvent.type(screen.getByLabelText('이메일'), 'nobody@example.com');
    await userEvent.click(
      screen.getByRole('button', { name: '재설정 메일 받기' }),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      '메일을 보냈습니다',
    );
  });
});
