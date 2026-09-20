import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MyAgreementPage from './page';

const SUMMARY = {
  id: 'agr_1',
  templateVersion: 1,
  agreedAt: '2026-09-03T00:00:00.000Z',
};

/** 204는 본문이 없다. `json()`을 부르면 안 되는 경로다 */
function mockFetchOnce(status: number, body?: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () =>
      body === undefined
        ? Promise.reject(new Error('204에는 본문이 없다'))
        : Promise.resolve(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('MyAgreementPage', () => {
  it('should request the summary without a userId query', async () => {
    // 회원은 쿠키에서 온다 (#69·#72). 화면이 회원을 고르지 않는다.
    const fetchMock = mockFetchOnce(200, SUMMARY);
    render(<MyAgreementPage />);

    await screen.findByRole('link', { name: '서명한 동의서 보기' });

    expect(fetchMock).toHaveBeenCalledWith('/api/agreements/mine');
  });

  it('should link to the signed pdf without a userId query', async () => {
    mockFetchOnce(200, SUMMARY);
    render(<MyAgreementPage />);

    const link = await screen.findByRole('link', {
      name: '서명한 동의서 보기',
    });
    // 소유자 확인은 서버가 토큰 주체로 한다. 화면은 링크만 만든다.
    expect(link).toHaveAttribute('href', '/api/agreements/agr_1');
  });

  it('should say nothing is signed yet when there is none', async () => {
    // 204는 오류가 아니다. 아직 서명하지 않았을 뿐이다.
    mockFetchOnce(204);
    render(<MyAgreementPage />);

    expect(
      await screen.findByText('아직 서명한 동의서가 없습니다.'),
    ).toBeInTheDocument();
  });

  it('should show the server message when the read answers 401', async () => {
    // "아직 서명한 동의서가 없습니다"로 덮으면 로그인이 안 된 것을
    // 거짓말하게 된다. 서버가 준 문구를 그대로 띄운다.
    mockFetchOnce(401, {
      errorCode: 'LOGIN_UNAUTHENTICATED',
      message: '로그인이 필요합니다.',
    });
    render(<MyAgreementPage />);

    expect(await screen.findByText('로그인이 필요합니다.')).toBeInTheDocument();
  });
});
