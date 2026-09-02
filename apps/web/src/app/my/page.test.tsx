import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MyPage from './page';

/** 로그아웃 뒤에 어디로 보냈는지만 본다. 실제 라우팅은 Next의 몫이다 */
const replace = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: replace, refresh }),
}));

const EMAIL = 'worker@example.com';
const NAME = '김구직';

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

function profile() {
  return {
    id: 'usr_1',
    email: EMAIL,
    name: NAME,
    address: null,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('MyPage', () => {
  it('should show my email and name', async () => {
    mockFetchOnce(200, profile());
    render(<MyPage />);

    expect(await screen.findByText(EMAIL)).toBeInTheDocument();
    expect(await screen.findByText(NAME)).toBeInTheDocument();
  });

  it('should show that no address is registered yet', async () => {
    mockFetchOnce(200, profile());
    render(<MyPage />);

    // 주소 등록은 #3의 몫이다. 지금은 비어 있음을 자연스럽게 알린다.
    expect(
      await screen.findByText('아직 등록하지 않았습니다'),
    ).toBeInTheDocument();
  });
});

describe('MyPage 로그아웃', () => {
  it('should call the logout endpoint and move to /login when 로그아웃 is pressed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(profile()),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MyPage />);
    await screen.findByText(EMAIL);

    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('should invalidate the client router cache so a back navigation cannot replay /my', async () => {
    // spec-fixed §2.5의 세 번째 방어. bfcache는 no-store로 막히지만 Next의
    // 클라이언트 Router Cache는 별개 메커니즘이라 명시적으로 지워야 한다.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(profile()),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MyPage />);
    await screen.findByText(EMAIL);

    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }));

    expect(refresh).toHaveBeenCalled();
  });

  it('should still move to /login when the logout request fails', async () => {
    // 서버가 실패해도 이 브라우저는 로그인 화면으로 보낸다. 남아 있으면
    // 로그아웃한 줄 알았는데 보호 페이지가 그대로 보인다.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(profile()),
      })
      .mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    render(<MyPage />);
    await screen.findByText(EMAIL);

    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }));

    expect(replace).toHaveBeenCalledWith('/login');
  });
});
