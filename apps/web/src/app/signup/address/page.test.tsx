import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignupAddressPage from './page';
import { openPostcodePopup } from './kakao-postcode';

/**
 * 카카오 우편번호 팝업은 외부 서비스다. 테스트에서 스크립트를 내려받지 않고
 * "팝업이 값을 돌려줬을 때 폼이 채워지는가"만 본다. (이슈 #3 AC1)
 */
vi.mock('./kakao-postcode', () => ({
  openPostcodePopup: vi.fn(),
}));

const popup = vi.mocked(openPostcodePopup);

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));

const SELECTED = {
  postalCode: '06236',
  roadAddress: '서울 강남구 테헤란로 152',
  jibunAddress: '서울 강남구 역삼동 737',
  sido: '서울',
  sigungu: '강남구',
};

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

function createdBody() {
  return {
    ...SELECTED,
    id: 'adr_1',
    label: '기본',
    lat: 37.5006431,
    lng: 127.0359529,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

async function chooseAddress() {
  await userEvent.click(screen.getByRole('button', { name: '주소 검색' }));
}

async function save() {
  await userEvent.click(screen.getByRole('button', { name: '저장하기' }));
}

/**
 * 가입 직후 세션이 있다 (ADR-AUTH-5). 회원 id는 화면이 들고 다니지 않는다 —
 * sessionStorage에 아무것도 넣지 않고 시작한다.
 */
beforeEach(() => {
  popup.mockResolvedValue(SELECTED);
});

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('SignupAddressPage', () => {
  it('should fill the road address, jibun address and postal code when the popup returns a selection', async () => {
    render(<SignupAddressPage />);

    await chooseAddress();

    expect(await screen.findByLabelText('우편번호')).toHaveValue(
      SELECTED.postalCode,
    );
    expect(screen.getByLabelText('도로명주소')).toHaveValue(
      SELECTED.roadAddress,
    );
    expect(screen.getByLabelText('지번주소')).toHaveValue(
      SELECTED.jibunAddress,
    );
  });

  it('should show an error message when opening the popup fails', async () => {
    // 스크립트를 못 내려받거나 카카오가 이상한 모양을 주면 여기로 온다.
    // try/catch가 없으면 처리되지 않은 예외가 되고 화면은 아무 반응도 하지 않는다.
    popup.mockRejectedValue(new Error('script load failed'));
    render(<SignupAddressPage />);

    await chooseAddress();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '주소 검색을 열지 못했습니다. 잠시 후 다시 시도해 주세요.',
    );
  });

  it('should keep the form empty when the popup is closed without choosing', async () => {
    popup.mockResolvedValue(null);
    render(<SignupAddressPage />);

    await chooseAddress();

    expect(screen.getByLabelText('우편번호')).toHaveValue('');
    expect(screen.getByLabelText('도로명주소')).toHaveValue('');
  });

  it('should show step 3/4', () => {
    render(<SignupAddressPage />);

    expect(screen.getByText('3/4')).toBeInTheDocument();
  });

  it('should show the address form when sessionStorage holds no signup value', () => {
    render(<SignupAddressPage />);

    expect(
      screen.queryByRole('button', { name: '주소 검색' }),
    ).toBeInTheDocument();
  });

  it('should post the chosen address to /api/members/me/addresses with no userId in the url or body', async () => {
    const fetchMock = mockFetchOnce(201, createdBody());
    render(<SignupAddressPage />);

    await chooseAddress();
    await save();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect({
      url,
      method: init.method,
      body: JSON.parse(init.body as string) as unknown,
    }).toEqual({
      url: '/api/members/me/addresses',
      method: 'POST',
      body: SELECTED,
    });
  });

  it('should replace the route with /signup/agreement when saving succeeds', async () => {
    mockFetchOnce(201, createdBody());
    render(<SignupAddressPage />);

    await chooseAddress();
    await save();

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/signup/agreement'),
    );
  });

  it('should send no request when no address has been chosen yet', async () => {
    const fetchMock = mockFetchOnce(201, createdBody());
    render(<SignupAddressPage />);

    await save();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should show the server message when the server rejects the save', async () => {
    mockFetchOnce(404, {
      errorCode: 'MEMBER_NOT_FOUND',
      message: '회원을 찾을 수 없습니다.',
    });
    render(<SignupAddressPage />);

    await chooseAddress();
    await save();

    expect(
      await screen.findByText('회원을 찾을 수 없습니다.'),
    ).toBeInTheDocument();
  });

  it('should show a login-required message with a link to /login when saving answers 401', async () => {
    mockFetchOnce(401, {
      errorCode: 'AUTH_UNAUTHENTICATED',
      message: '로그인이 필요합니다.',
    });
    render(<SignupAddressPage />);

    await chooseAddress();
    await save();

    expect(
      await screen.findByRole('link', { name: '로그인하러 가기' }),
    ).toHaveAttribute('href', '/login');
  });
});
