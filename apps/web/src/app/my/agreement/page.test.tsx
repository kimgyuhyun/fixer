import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MyAgreementPage from './page';

const SIGNED_UP_USER_ID_KEY = 'fixer.signup.userId';
const USER_ID = 'usr_1';

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

beforeEach(() => {
  sessionStorage.setItem(SIGNED_UP_USER_ID_KEY, USER_ID);
});

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('MyAgreementPage', () => {
  it('should link to the signed pdf when one exists', async () => {
    mockFetchOnce(200, SUMMARY);
    render(<MyAgreementPage />);

    const link = await screen.findByRole('link', {
      name: '서명한 동의서 보기',
    });
    // 소유자 확인은 서버가 한다. 화면은 링크만 만든다.
    expect(link).toHaveAttribute(
      'href',
      `/api/agreements/agr_1?userId=${USER_ID}`,
    );
  });

  it('should say nothing is signed yet when there is none', async () => {
    // 204는 오류가 아니다. 아직 서명하지 않았을 뿐이다.
    mockFetchOnce(204);
    render(<MyAgreementPage />);

    expect(
      await screen.findByText('아직 서명한 동의서가 없습니다.'),
    ).toBeInTheDocument();
  });
});
