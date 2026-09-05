import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PointsPage from './page';

const USER = 'usr_1';

function historyBody(balance: number, transactions: unknown[] = []) {
  return { balance, transactions };
}

function chargeTx(amount: number, id = 'ptx_1') {
  return {
    id,
    type: 'CHARGE',
    amount,
    createdAt: '2026-09-01T10:00:00.000Z',
  };
}

/**
 * 요청 URL로 응답을 고른다.
 *
 * 순서로 짝지으면 화면이 요청 순서를 바꿀 때 테스트가 조용히 다른 것을
 * 검사하게 된다.
 */
function mockRoutes(routes: Record<string, { status: number; body: unknown }>) {
  const fetchMock = vi.fn((input: unknown) => {
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

async function typeUserId(id = USER) {
  await userEvent.setup().type(screen.getByLabelText('회원 id'), id);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('포인트 화면 — 잔액과 내역 (AC5)', () => {
  it('should show the balance the server reported', async () => {
    mockRoutes({
      '/api/points/me': { status: 200, body: historyBody(50_000) },
    });
    render(<PointsPage />);

    await typeUserId();

    expect(await screen.findByText('50,000')).toBeInTheDocument();
  });

  it('should list a charge with a readable label instead of the raw code', async () => {
    mockRoutes({
      '/api/points/me': {
        status: 200,
        body: historyBody(50_000, [chargeTx(50_000)]),
      },
    });
    render(<PointsPage />);

    await typeUserId();

    expect(await screen.findByText('충전')).toBeInTheDocument();
    expect(screen.getByText('+50,000')).toBeInTheDocument();
  });

  it('should say there is nothing yet for a member who never charged', async () => {
    mockRoutes({
      '/api/points/me': { status: 200, body: historyBody(0) },
    });
    render(<PointsPage />);

    await typeUserId();

    expect(
      await screen.findByText('아직 내역이 없습니다.'),
    ).toBeInTheDocument();
  });
});

describe('포인트 화면 — 충전 (AC1)', () => {
  it('should not let a charge start before a member is chosen', () => {
    mockRoutes({});
    render(<PointsPage />);

    expect(screen.getByRole('button', { name: '10천원' })).toBeDisabled();
  });

  it('should start and confirm the payment the server created', async () => {
    // 클라이언트는 금액을 확정 요청에 싣지 않는다. 실을 값이 있으면
    // 그것이 조작 대상이 된다.
    const fetchMock = mockRoutes({
      '/api/points/me': { status: 200, body: historyBody(0) },
      '/api/payments/confirm': {
        status: 200,
        body: {
          paymentId: 'pay_1',
          charged: 10_000,
          balance: 10_000,
          applied: true,
        },
      },
      '/api/payments': {
        status: 201,
        body: { paymentId: 'pay_1', amount: 10_000 },
      },
    });
    render(<PointsPage />);
    await typeUserId();

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: '10천원' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/payments/confirm',
        expect.objectContaining({
          body: JSON.stringify({ userId: USER, paymentId: 'pay_1' }),
        }),
      );
    });
  });

  it('should show the server message when the amount did not match', async () => {
    mockRoutes({
      '/api/points/me': { status: 200, body: historyBody(0) },
      '/api/payments/confirm': {
        status: 409,
        body: {
          errorCode: 'PAYMENT_AMOUNT_MISMATCH',
          message: '결제 금액이 맞지 않아 충전하지 않았습니다.',
        },
      },
      '/api/payments': {
        status: 201,
        body: { paymentId: 'pay_1', amount: 10_000 },
      },
    });
    render(<PointsPage />);
    await typeUserId();

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: '10천원' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '결제 금액이 맞지 않아 충전하지 않았습니다.',
    );
  });
});

describe('포인트 화면 — 환불 (#29)', () => {
  it('should show which payment each refunded amount came from', async () => {
    // 묶어서 총액만 보여주면 카드 명세서에 두 줄이 찍힌 이유를 알 수 없다.
    mockRoutes({
      '/api/points/me': { status: 200, body: historyBody(80_000) },
      '/api/refunds': {
        status: 200,
        body: {
          refunded: 55_000,
          balance: 80_000,
          lots: [
            { paymentId: 'pay_old', amount: 50_000 },
            { paymentId: 'pay_new', amount: 5_000 },
          ],
          applied: true,
        },
      },
    });
    render(<PointsPage />);
    await typeUserId();

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: '50천원 환불' }));

    expect(await screen.findByText('pay_old')).toBeInTheDocument();
    expect(screen.getByText('pay_new')).toBeInTheDocument();
    expect(screen.getByText('-50,000')).toBeInTheDocument();
  });

  it('should show the server message when the points were already spent', async () => {
    mockRoutes({
      '/api/points/me': { status: 200, body: historyBody(0) },
      '/api/refunds': {
        status: 409,
        body: {
          errorCode: 'PAYMENT_INSUFFICIENT_BALANCE',
          message:
            '이미 사용한 포인트는 환불할 수 없습니다. 잔액을 확인해 주세요.',
        },
      },
    });
    render(<PointsPage />);
    await typeUserId();

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: '10천원 환불' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이미 사용한 포인트는 환불할 수 없습니다',
    );
  });
});
