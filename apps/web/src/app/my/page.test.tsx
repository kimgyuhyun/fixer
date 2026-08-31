import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MyPage from './page';

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
