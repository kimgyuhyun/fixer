import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

const SIGNED_AT = '2026-09-03T00:00:00.000Z';

const SIGNED = { id: 'agr_1', templateVersion: 3, agreedAt: SIGNED_AT };

type Reply = { status: number; body?: unknown };

/**
 * 이 화면은 요청을 둘 보낸다 — 들어올 때 `GET /api/agreements/mine`,
 * 제출할 때 `POST /api/agreements`. 메서드와 주소로 갈라 답한다.
 *
 * 204에는 본문이 없다. 진짜 fetch처럼 `json()`이 실패하게 둔다 — 화면이
 * 상태 코드를 먼저 보지 않으면 여기서 드러난다.
 */
function mockServer(replies: { mine: Reply; sign?: Reply }) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const reply =
      (init?.method ?? 'GET') === 'POST' && url === '/api/agreements'
        ? replies.sign
        : url === '/api/agreements/mine'
          ? replies.mine
          : undefined;
    if (reply === undefined) {
      return Promise.reject(new Error(`예상하지 못한 요청: ${url}`));
    }
    return Promise.resolve({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: () =>
        reply.body === undefined
          ? Promise.reject(new SyntaxError('Unexpected end of JSON input'))
          : Promise.resolve(reply.body),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const NOT_SIGNED_YET: Reply = { status: 204 };

const UNAUTHENTICATED: Reply = {
  status: 401,
  body: { errorCode: 'AUTH_UNAUTHENTICATED', message: '로그인이 필요합니다.' },
};

async function drawAndAgree() {
  await userEvent.click(
    await screen.findByRole('button', { name: '서명하기' }),
  );
  await userEvent.click(screen.getByRole('button', { name: '동의합니다' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('AgreementPage', () => {
  it('should show step 4/4 with the signature form', async () => {
    mockServer({ mine: NOT_SIGNED_YET });
    render(<AgreementPage />);

    await screen.findByRole('button', { name: '동의합니다' });

    expect(screen.getByText('4/4')).toBeInTheDocument();
  });

  it('should show the signature form when /api/agreements/mine answers 204', async () => {
    mockServer({ mine: NOT_SIGNED_YET });
    render(<AgreementPage />);

    expect(
      await screen.findByRole('button', { name: '동의합니다' }),
    ).toBeInTheDocument();
  });

  it('should show the template pdf', async () => {
    mockServer({ mine: NOT_SIGNED_YET });
    render(<AgreementPage />);

    expect(await screen.findByLabelText('동의서 내용')).toHaveAttribute(
      'data',
      '/api/agreements/template',
    );
  });

  it('should keep the 동의 button disabled until something is drawn', async () => {
    mockServer({ mine: NOT_SIGNED_YET });
    render(<AgreementPage />);

    // AC4(#7) — 그리기 전에는 누를 수 없다
    expect(
      await screen.findByRole('button', { name: '동의합니다' }),
    ).toBeDisabled();
  });

  it('should post a body holding only signaturePngBase64 to /api/agreements', async () => {
    const fetchMock = mockServer({
      mine: NOT_SIGNED_YET,
      sign: { status: 201, body: SIGNED },
    });
    render(<AgreementPage />);

    await drawAndAgree();

    // 회원은 세션이 말한다 (ADR-AUTH-5). 본문에 id를 싣지 않는다.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agreements',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const post = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'POST',
    );
    expect(JSON.parse(post?.[1]?.body as string) as unknown).toEqual({
      signaturePngBase64: 'base64-png',
    });
  });

  it('should show the signup-finished screen with links to / and /my when signing succeeds', async () => {
    mockServer({
      mine: NOT_SIGNED_YET,
      sign: { status: 201, body: SIGNED },
    });
    render(<AgreementPage />);

    await drawAndAgree();

    await screen.findByRole('heading', { name: '가입이 끝났습니다' });
    expect(
      screen.getAllByRole('link').map((link) => link.getAttribute('href')),
    ).toEqual(expect.arrayContaining(['/', '/my']));
  });

  it('should show an already-signed message with a link to /my instead of the form when /api/agreements/mine answers 200', async () => {
    mockServer({ mine: { status: 200, body: SIGNED } });
    render(<AgreementPage />);

    // 마이페이지에서 주소만 등록하러 왔다가 여기로 넘어온 경우다. 다시 서명시키지 않는다.
    await screen.findByText('이미 서명한 동의서가 있습니다');
    expect({
      form: screen.queryByRole('button', { name: '동의합니다' }) !== null,
      links: screen
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    }).toEqual({ form: false, links: expect.arrayContaining(['/my']) });
  });

  it('should show a login-required message with a link to /login instead of the form when /api/agreements/mine answers 401', async () => {
    mockServer({ mine: UNAUTHENTICATED });
    render(<AgreementPage />);

    const login = await screen.findByRole('link', { name: '로그인하러 가기' });
    expect({
      href: login.getAttribute('href'),
      form: screen.queryByRole('button', { name: '동의합니다' }) !== null,
    }).toEqual({ href: '/login', form: false });
  });

  it('should show the login-required message when submitting answers 401', async () => {
    mockServer({ mine: NOT_SIGNED_YET, sign: UNAUTHENTICATED });
    render(<AgreementPage />);

    await drawAndAgree();

    expect(
      await screen.findByRole('link', { name: '로그인하러 가기' }),
    ).toHaveAttribute('href', '/login');
  });

  it('should show the server message when the server rejects', async () => {
    mockServer({
      mine: NOT_SIGNED_YET,
      sign: {
        status: 400,
        body: {
          errorCode: 'AGREEMENT_SIGNATURE_REQUIRED',
          message: '서명을 그려 주세요.',
        },
      },
    });
    render(<AgreementPage />);

    await drawAndAgree();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '서명을 그려 주세요.',
    );
  });
});
