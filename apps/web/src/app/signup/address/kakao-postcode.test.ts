import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPostcodePopup } from './kakao-postcode';

/**
 * 카카오 스크립트를 내려받는 부분은 테스트하지 않는다 — 외부 서비스다.
 * `window.daum`을 가짜로 심어 **우리 코드가 그것을 어떻게 쓰는지**만 본다. (이슈 #3 AC1)
 */
type PostcodeOptions = {
  oncomplete: (result: unknown) => void;
  onclose: (state: string) => void;
};

/** 카카오가 주는 모양 그대로. 필드명이 등장하는 곳은 shared 한 곳뿐이다 */
const KAKAO_RESULT = {
  zonecode: '06236',
  roadAddress: '서울 강남구 테헤란로 152',
  jibunAddress: '서울 강남구 역삼동 737',
  sido: '서울',
  sigungu: '강남구',
};

/**
 * 사용자가 팝업에서 무엇을 하는지 흉내 낸다.
 * `open()`이 불리면 정해둔 행동을 한 번 수행한다.
 */
function stubDaum(behave: (options: PostcodeOptions) => void) {
  const open = vi.fn();
  const Postcode = vi.fn((options: PostcodeOptions) => ({
    open: open.mockImplementation(() => behave(options)),
  }));
  vi.stubGlobal('daum', { Postcode });
  return { Postcode, open };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('openPostcodePopup', () => {
  it('should resolve the parsed selection when the user picks an address in the popup', async () => {
    stubDaum((options) => options.oncomplete(KAKAO_RESULT));

    await expect(openPostcodePopup()).resolves.toEqual({
      postalCode: '06236',
      roadAddress: '서울 강남구 테헤란로 152',
      jibunAddress: '서울 강남구 역삼동 737',
      sido: '서울',
      sigungu: '강남구',
    });
  });

  it('should resolve null when the popup is closed without choosing', async () => {
    stubDaum((options) => options.onclose('FORCE_CLOSE'));

    await expect(openPostcodePopup()).resolves.toBeNull();
  });
});
