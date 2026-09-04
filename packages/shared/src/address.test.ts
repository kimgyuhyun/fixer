import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { parseKakaoCoordinate, parseKakaoPostcodeResult } from './address.js';

/**
 * 카카오가 실제로 주는 모양이다. 우리가 쓰는 필드만 남기고 줄였다.
 *
 * 이 파일이 카카오 필드명이 등장하는 유일한 테스트다. 카카오가 이름을 바꾸면
 * 여기와 `address.ts` 두 곳만 고치면 된다. (ADR-AUTH-2)
 */
function popupResult(overrides: Record<string, unknown> = {}) {
  return {
    zonecode: '06236',
    roadAddress: '서울 강남구 테헤란로 152',
    jibunAddress: '서울 강남구 역삼동 737',
    autoRoadAddress: '',
    autoJibunAddress: '',
    sido: '서울',
    sigungu: '강남구',
    ...overrides,
  };
}

/** 카카오 로컬 주소검색 응답. 좌표만 남기고 줄였다 */
function localResponse(documents: unknown[]) {
  return { documents, meta: { total_count: documents.length } };
}

describe('parseKakaoPostcodeResult', () => {
  it('should map zonecode, roadAddress and jibunAddress into a postal code and two address lines', () => {
    const parsed = parseKakaoPostcodeResult(popupResult());

    expect(parsed).toMatchObject({
      postalCode: '06236',
      roadAddress: '서울 강남구 테헤란로 152',
      jibunAddress: '서울 강남구 역삼동 737',
    });
  });

  it('should carry sido and sigungu through unchanged', () => {
    const parsed = parseKakaoPostcodeResult(popupResult());

    expect(parsed).toMatchObject({ sido: '서울', sigungu: '강남구' });
  });

  it('should keep sigungu empty when the popup returns an empty sigungu', () => {
    // 세종특별자치시는 시/군/구가 없다. 카카오도 빈 문자열을 준다.
    const parsed = parseKakaoPostcodeResult(
      popupResult({
        sido: '세종특별자치시',
        sigungu: '',
        roadAddress: '세종특별자치시 한누리대로 2130',
        jibunAddress: '세종특별자치시 보람동 812',
      }),
    );

    expect(parsed.sigungu).toBe('');
  });

  it('should fall back to autoRoadAddress when roadAddress is empty', () => {
    // 지번만 있는 주소를 고르면 카카오가 roadAddress를 비우고
    // autoRoadAddress에 도로명을 담아 준다.
    const parsed = parseKakaoPostcodeResult(
      popupResult({
        roadAddress: '',
        autoRoadAddress: '서울 강남구 테헤란로 152',
      }),
    );

    expect(parsed.roadAddress).toBe('서울 강남구 테헤란로 152');
  });

  it('should reject when both the road address and the jibun address are empty', () => {
    expect(() =>
      parseKakaoPostcodeResult(
        popupResult({ roadAddress: '', jibunAddress: '' }),
      ),
    ).toThrow(ZodError);
  });

  it('should reject when the postal code is not 5 digits', () => {
    expect(() =>
      parseKakaoPostcodeResult(popupResult({ zonecode: '135-080' })),
    ).toThrow(ZodError);
  });
});

describe('parseKakaoCoordinate', () => {
  it('should read lng from x and lat from y of the first document', () => {
    // 카카오는 x가 경도, y가 위도다. 뒤집으면 거리 검색이 통째로 어긋난다.
    const coordinate = parseKakaoCoordinate(
      localResponse([{ x: '127.0359529', y: '37.5006431' }]),
    );

    expect(coordinate).toEqual({ lat: 37.5006431, lng: 127.0359529 });
  });

  it('should return null when documents is an empty array', () => {
    expect(parseKakaoCoordinate(localResponse([]))).toBeNull();
  });

  it('should return null when the response has no documents field', () => {
    expect(parseKakaoCoordinate({ error: 'unauthorized' })).toBeNull();
  });
});
