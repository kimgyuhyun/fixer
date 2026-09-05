import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExchangeAccountPage from './page';

const REGISTERED = {
  bankCode: '088',
  bankName: '신한은행',
  maskedAccountNumber: '****5678',
  holderName: '김구직',
  verificationStatus: 'VERIFIED',
  rejectedReason: null,
};

function mockRoutes(routes: Record<string, { status: number; body: unknown }>) {
  const fetchMock = vi.fn((input: unknown, init?: { body?: unknown }) => {
    void init;
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    const hit = key === undefined ? { status: 404, body: {} } : routes[key];
    return Promise.resolve({
      ok: hit.status >= 200 && hit.status < 300,
      status: hit.status,
      json: () => Promise.resolve(hit.body),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('회원 id'), 'usr_1');
  await user.selectOptions(screen.getByLabelText('은행'), '088');
  await user.type(screen.getByLabelText('계좌번호'), '110-123-45678');
  await user.type(screen.getByLabelText('예금주'), '김구직');
  await user.click(screen.getByRole('button', { name: '계좌 등록' }));
  return user;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('환전 계좌 화면 (#30 AC4)', () => {
  it('should show the masked number after registering', async () => {
    mockRoutes({
      '/api/exchange-accounts/me': { status: 404, body: {} },
      '/api/exchange-accounts': { status: 200, body: REGISTERED },
    });
    render(<ExchangeAccountPage />);

    await fillAndSubmit();

    expect(await screen.findByText('****5678')).toBeInTheDocument();
    // 은행 이름은 선택 목록(option)에도 있으므로 등록 정보(dd) 쪽만 본다.
    expect(
      screen.getAllByText('신한은행').some((el) => el.tagName === 'DD'),
    ).toBe(true);
    expect(screen.getByText('검증 완료')).toBeInTheDocument();
  });

  it('should never show the full account number after registering', async () => {
    // 서버가 평문을 안 내려보내므로 화면이 보여줄 방법도 없어야 한다.
    mockRoutes({
      '/api/exchange-accounts/me': { status: 404, body: {} },
      '/api/exchange-accounts': { status: 200, body: REGISTERED },
    });
    render(<ExchangeAccountPage />);

    await fillAndSubmit();
    await screen.findByText('****5678');

    expect(document.body.textContent).not.toContain('11012345678');
    // 입력칸도 비운다.
    expect(screen.getByLabelText('계좌번호')).toHaveValue('');
  });

  it('should strip hyphens before sending', async () => {
    const fetchMock = mockRoutes({
      '/api/exchange-accounts/me': { status: 404, body: {} },
      '/api/exchange-accounts': { status: 200, body: REGISTERED },
    });
    render(<ExchangeAccountPage />);

    await fillAndSubmit();

    await waitFor(() => {
      const sent = fetchMock.mock.calls.find(
        (call) => String(call[0]) === '/api/exchange-accounts',
      );
      const body = JSON.parse(String(sent?.[1]?.body ?? '{}')) as Record<
        string,
        unknown
      >;
      expect(body.accountNumber).toBe('11012345678');
    });
  });

  it('should show why the account was refused', async () => {
    // "실패했습니다"만 주면 무엇을 고쳐야 하는지 모른다.
    mockRoutes({
      '/api/exchange-accounts/me': { status: 404, body: {} },
      '/api/exchange-accounts': {
        status: 400,
        body: {
          errorCode: 'ACCOUNT_INVALID_FORMAT',
          message: '계좌번호는 10~14자리입니다.',
        },
      },
    });
    render(<ExchangeAccountPage />);

    await fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '계좌번호는 10~14자리입니다.',
    );
  });

  it('should load an account that was registered before', async () => {
    mockRoutes({
      '/api/exchange-accounts/me': { status: 200, body: REGISTERED },
    });
    render(<ExchangeAccountPage />);

    await userEvent.setup().type(screen.getByLabelText('회원 id'), 'usr_1');

    expect(await screen.findByText('****5678')).toBeInTheDocument();
  });

  it('should not let a registration start before a member is chosen', () => {
    mockRoutes({});
    render(<ExchangeAccountPage />);

    expect(screen.getByRole('button', { name: '계좌 등록' })).toBeDisabled();
  });
});
