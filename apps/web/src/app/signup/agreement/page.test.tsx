import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgreementPage from './page';

/**
 * 서명 캔버스는 이 화면의 관심사가 아니다. jsdom에 canvas 구현이 없어
 * 진짜 컴포넌트로는 "서명이 있는 상태"를 만들 수 없으므로, **모듈만 바꿔
 * 끼운다.** 캔버스 자체의 동작은 `SignaturePad.test.tsx`가 본다.
 */
vi.mock('./SignaturePad', () => ({
  SignaturePad: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange('base64-png')}>
      서명하기
    </button>
  ),
}));

const SIGNED_UP_USER_ID_KEY = 'fixer.signup.userId';
const USER_ID = 'usr_1';
const SIGNED_AT = '2026-09-03T00:00:00.000Z';

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
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

describe('AgreementPage', () => {
  it('should show the template pdf', () => {
    render(<AgreementPage />);

    expect(screen.getByLabelText('동의서 내용')).toHaveAttribute(
      'data',
      '/api/agreements/template',
    );
  });

  it('should keep the 동의 button disabled until something is drawn', () => {
    render(<AgreementPage />);

    // AC4 — 그리기 전에는 누를 수 없다
    expect(screen.getByRole('button', { name: '동의합니다' })).toBeDisabled();
  });

  it('should send the signature and move on when 동의 is pressed', async () => {
    const fetchMock = mockFetchOnce(201, {
      id: 'agr_1',
      templateVersion: 3,
      agreedAt: SIGNED_AT,
    });
    render(<AgreementPage />);

    await userEvent.click(screen.getByRole('button', { name: '서명하기' }));
    await userEvent.click(screen.getByRole('button', { name: '동의합니다' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agreements',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(
      await screen.findByText('동의서 서명이 끝났습니다'),
    ).toBeInTheDocument();
  });

  it('should show the server message when the server rejects', async () => {
    mockFetchOnce(400, {
      errorCode: 'AGREEMENT_SIGNATURE_REQUIRED',
      message: '서명을 그려 주세요.',
    });
    render(<AgreementPage />);

    await userEvent.click(screen.getByRole('button', { name: '서명하기' }));
    await userEvent.click(screen.getByRole('button', { name: '동의합니다' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '서명을 그려 주세요.',
    );
  });
});
