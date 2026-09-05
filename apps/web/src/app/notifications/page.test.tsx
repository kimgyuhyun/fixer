import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NotificationsPage from './page';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const UNREAD = {
  id: 'ntf_1',
  type: 'ACCOUNT_VERIFIED',
  title: '계좌 검증이 끝났습니다',
  body: '신한은행 ****5678 계좌를 쓸 수 있습니다.',
  linkUrl: '/my/account',
  read: false,
  createdAt: '2026-09-05T00:00:01.000Z',
};

function mockRoutes(routes: Record<string, { status: number; body: unknown }>) {
  const fetchMock = vi.fn((input: unknown) => {
    const url = String(input);
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => url.startsWith(k));
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

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

describe('알림 목록 화면 (#36 AC2·AC3)', () => {
  it('should list the notifications returned by the API', async () => {
    mockRoutes({
      '/api/notifications/me': {
        status: 200,
        body: { items: [UNREAD], unreadCount: 1 },
      },
    });

    render(<NotificationsPage />);

    expect(
      await screen.findByText('계좌 검증이 끝났습니다'),
    ).toBeInTheDocument();
  });

  it('should mark the notification read and move to its linked screen when clicked', async () => {
    const fetchMock = mockRoutes({
      '/api/notifications/me': {
        status: 200,
        body: { items: [UNREAD], unreadCount: 1 },
      },
      '/api/notifications/ntf_1/read': {
        status: 200,
        body: { ...UNREAD, read: true },
      },
    });
    render(<NotificationsPage />);

    await userEvent.click(await screen.findByText('계좌 검증이 끝났습니다'));

    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('/api/notifications/ntf_1/read'),
      ),
    ).toBe(true);
    expect(push).toHaveBeenCalledWith('/my/account');
  });

  it('should show an empty message when there are no notifications', async () => {
    mockRoutes({
      '/api/notifications/me': {
        status: 200,
        body: { items: [], unreadCount: 0 },
      },
    });

    render(<NotificationsPage />);

    expect(
      await screen.findByText('받은 알림이 없습니다.'),
    ).toBeInTheDocument();
  });
});
