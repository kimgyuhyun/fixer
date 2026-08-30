import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VerifyEmailPage from './page';

const NOW = new Date('2026-09-01T00:00:00.000Z');
const EMAIL = 'worker@example.com';

/** fetch 한 번에 대한 응답을 정한다. 실제 서버가 주는 모양 그대로 쓴다. */
function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentBody(seconds: number) {
  return {
    expiresAt: new Date(NOW.getTime() + 10 * 60_000).toISOString(),
    resendAvailableAt: new Date(NOW.getTime() + seconds * 1000).toISOString(),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function requestCodeFor(email: string) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.type(screen.getByLabelText('이메일'), email);
  await user.click(screen.getByRole('button', { name: '인증 코드 받기' }));
}

describe('VerifyEmailPage', () => {
  it('should show the email form first', () => {
    render(<VerifyEmailPage />);

    expect(screen.getByLabelText('이메일')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '인증 코드 받기' }),
    ).toBeInTheDocument();
  });

  /**
   * AC 4의 "남은 시간이 안내된다". 지금까지 사람이 눈으로만 보던 부분이다.
   */
  it('should count down the remaining seconds on the resend button', async () => {
    mockFetchOnce(200, sentBody(60));
    render(<VerifyEmailPage />);

    await requestCodeFor(EMAIL);

    const resend = await screen.findByRole('button', {
      name: /초 후 재발송/,
    });
    expect(resend).toBeDisabled();
    expect(resend).toHaveTextContent('60초 후 재발송');

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });

    expect(
      screen.getByRole('button', { name: /초 후 재발송/ }),
    ).toHaveTextContent('57초 후 재발송');
  });

  it('should enable the resend button once the cooldown has passed', async () => {
    mockFetchOnce(200, sentBody(2));
    render(<VerifyEmailPage />);

    await requestCodeFor(EMAIL);
    await screen.findByRole('button', { name: /초 후 재발송/ });

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });

    const resend = screen.getByRole('button', { name: '코드 다시 받기' });
    expect(resend).toBeEnabled();
  });

  it('should show the message the server sent when the request is rejected', async () => {
    mockFetchOnce(429, {
      errorCode: 'MEMBER_RESEND_COOLDOWN',
      message: '42초 뒤에 다시 요청할 수 있습니다.',
      retryAfterSeconds: 42,
    });
    render(<VerifyEmailPage />);

    await requestCodeFor(EMAIL);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '42초 뒤에 다시 요청할 수 있습니다.',
    );
  });
});
