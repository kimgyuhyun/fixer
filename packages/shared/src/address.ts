import { z } from 'zod';

/**
 * 주소 규칙. (이슈 #3, ADR-AUTH-2)
 *
 * 상수를 한 곳에 모으는 이유는 화면과 서버가 같은 값으로 검사하기 위해서다.
 */
export const ADDRESS_RULES = {
  /** 라벨을 정하지 않으면 이 값이 붙는다 */
  defaultLabel: '기본',
  /** 방어적 상한. 사양에 값이 없어 입력 폭주만 막는 선에서 정했다 */
  labelMaxLength: 20,
  /** 카카오 `zonecode`는 2015년 이후의 5자리 새 우편번호다 */
  postalCodeLength: 5,
} as const;

/** 주소 등록이 내는 에러 코드 */
export const ADDRESS_ERRORS = {
  /** 그 회원이 없다 */
  MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
} as const;

export type AddressErrorCode =
  (typeof ADDRESS_ERRORS)[keyof typeof ADDRESS_ERRORS];

/**
 * 분해된 주소 한 건.
 *
 * 시/도와 시/군/구를 따로 두는 이유는 관리자 화면이 두 단계로 좁히기
 * 때문이다(`spec-fixed.md` §11). 통 문자열에 `LIKE`를 걸면 "경기도 광주시"와
 * "광주광역시"가 함께 걸린다.
 */
const addressFieldsSchema = z.object({
  postalCode: z
    .string({ error: '우편번호를 입력해 주세요.' })
    .regex(new RegExp(`^\\d{${ADDRESS_RULES.postalCodeLength}}$`), {
      error: `우편번호는 ${ADDRESS_RULES.postalCodeLength}자리 숫자여야 합니다.`,
    }),
  roadAddress: z.string({ error: '도로명주소를 확인해 주세요.' }),
  jibunAddress: z.string({ error: '지번주소를 확인해 주세요.' }),
  sido: z.string({ error: '주소를 다시 선택해 주세요.' }).min(1, {
    error: '주소를 다시 선택해 주세요.',
  }),
  /**
   * 세종특별자치시처럼 시/군/구가 없는 지역이 있다. 필수로 막으면 그 지역
   * 주민이 가입을 못 한다. 카카오도 그런 주소에는 빈 문자열을 준다.
   */
  sigungu: z.string({ error: '주소를 다시 선택해 주세요.' }),
});

/**
 * 도로명과 지번이 둘 다 비면 그건 주소가 아니다.
 *
 * 카카오는 지번만 있는 주소에서 `roadAddress`를 빈 문자열로 준다. 한쪽이 비는
 * 것은 정상이지만 양쪽이 비는 것은 고장이다.
 */
function hasAnyAddressLine(value: {
  roadAddress: string;
  jibunAddress: string;
}): boolean {
  return value.roadAddress !== '' || value.jibunAddress !== '';
}

const ADDRESS_LINE_ISSUE = {
  error: '도로명주소나 지번주소 중 하나는 있어야 합니다.',
  path: ['roadAddress'] as PropertyKey[],
};

/** 우편번호 팝업이 고른 주소 한 건 */
export const addressSelectionSchema = addressFieldsSchema.refine(
  hasAnyAddressLine,
  ADDRESS_LINE_ISSUE,
);
export type AddressSelection = z.infer<typeof addressSelectionSchema>;

/** 저장 요청. 선택된 주소에 라벨만 얹는다 */
export const registerAddressRequestSchema = addressFieldsSchema
  .extend({
    label: z
      .string()
      .trim()
      .min(1, { error: '라벨을 입력해 주세요.' })
      .max(ADDRESS_RULES.labelMaxLength, {
        error: `라벨은 ${ADDRESS_RULES.labelMaxLength}자 이내로 입력해 주세요.`,
      })
      .optional(),
  })
  .refine(hasAnyAddressLine, ADDRESS_LINE_ISSUE);
export type RegisterAddressRequest = z.infer<
  typeof registerAddressRequestSchema
>;

/** 저장 결과. 좌표는 비어 있을 수 있다 (AC3) */
export const registeredAddressSchema = addressFieldsSchema.extend({
  id: z.string(),
  label: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  createdAt: z.iso.datetime(),
});
export type RegisteredAddress = z.infer<typeof registeredAddressSchema>;

/** 위도·경도 한 쌍 */
export const coordinateSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});
export type Coordinate = z.infer<typeof coordinateSchema>;

/**
 * 카카오 우편번호 팝업 결과를 우리 모양으로 옮긴다.
 *
 * 모양이 어긋나면 `ZodError`를 던진다 — 주소가 없으면 저장할 것이 없기 때문이다.
 */
export function parseKakaoPostcodeResult(_raw: unknown): AddressSelection {
  throw new Error('not implemented');
}

/**
 * 카카오 로컬 주소검색 응답에서 좌표를 읽는다.
 *
 * 던지지 않고 `null`을 준다. 좌표는 없어도 되는 값이라 실패가 예외가 아니라
 * 결과다. (이슈 #3 AC3)
 */
export function parseKakaoCoordinate(_raw: unknown): Coordinate | null {
  throw new Error('not implemented');
}
