import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NotificationBell from './NotificationBell';

function mockList(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('알림 벨 (#36 AC1·AC3)', () => {
  it('should show the unread count when unread notifications exist', async () => {
    mockList({ items: [], unreadCount: 3 });

    render(<NotificationBell />);

    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  /**
   * 0을 그리면 "알림이 0건 있다"처럼 보인다. 아무것도 없는 상태는 아무것도
   * 안 그리는 것이 맞다.
   */
  it('should show no number when the unread count is zero', async () => {
    mockList({ items: [], unreadCount: 0 });

    render(<NotificationBell />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /알림/ })).toBeInTheDocument();
    });
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
