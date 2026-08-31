import { render, screen } from '@testing-library/react';
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

/** 가입한 회원의 id는 #2 화면이 sessionStorage에 남긴다 */
const SIGNED_UP_USER_ID_KEY = 'fixer.signup.userId';

const USER_ID = 'usr_1';

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

beforeEach(() => {
  sessionStorage.setItem(SIGNED_UP_USER_ID_KEY, USER_ID);
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

  it('should keep the form empty when the popup is closed without choosing', async () => {
    popup.mockResolvedValue(null);
    render(<SignupAddressPage />);

    await chooseAddress();

    expect(screen.getByLabelText('우편번호')).toHaveValue('');
    expect(screen.getByLabelText('도로명주소')).toHaveValue('');
  });

  it('should send the chosen address and show the completion state when saving succeeds', async () => {
    const fetchMock = mockFetchOnce(201, createdBody());
    render(<SignupAddressPage />);

    await chooseAddress();
    await save();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/members/${USER_ID}/addresses`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(
      await screen.findByText('주소가 등록되었습니다'),
    ).toBeInTheDocument();
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

  it('should guide back to signup when no signed-up member was carried over', () => {
    sessionStorage.clear();

    render(<SignupAddressPage />);

    expect(
      screen.getByRole('link', { name: '가입하러 가기' }),
    ).toBeInTheDocument();
  });
});
