import { z } from 'zod';

/**
 * 은행 코드. (금융결제원 표준 코드 일부 — MVP에 필요한 만큼만)
 *
 * 목록으로 두는 이유는 검증이 형식만 보기 때문이다(§6.4.2 stub). 아무 코드나
 * 받으면 존재하지 않는 은행으로 송금 목록이 만들어진다.
 */
export const BANK_CODES = {
  '004': 'KB국민은행',
  '011': 'NH농협은행',
  '020': '우리은행',
  '023': 'SC제일은행',
  '081': '하나은행',
  '088': '신한은행',
  '090': '카카오뱅크',
  '089': '케이뱅크',
  '092': '토스뱅크',
} as const;

export type BankCode = keyof typeof BANK_CODES;

/** 계좌번호 자릿수. 은행마다 다르지만 이 범위를 벗어나는 곳은 없다 */
export const ACCOUNT_NUMBER_MIN_LENGTH = 10;
export const ACCOUNT_NUMBER_MAX_LENGTH = 14;

/** 계좌가 내는 에러 코드 */
export const ACCOUNT_ERRORS = {
  /** 형식이 틀렸다. 사유를 함께 준다 */
  INVALID_FORMAT: 'ACCOUNT_INVALID_FORMAT',
  /** 등록된 계좌가 없다 */
  NOT_REGISTERED: 'ACCOUNT_NOT_REGISTERED',
} as const;

export type AccountErrorCode =
  (typeof ACCOUNT_ERRORS)[keyof typeof ACCOUNT_ERRORS];

/** 검증 상태. (§6.4.1) */
export const ACCOUNT_VERIFICATION_STATUSES = [
  'PENDING',
  'VERIFIED',
  'REJECTED',
] as const;
export type AccountVerificationStatus =
  (typeof ACCOUNT_VERIFICATION_STATUSES)[number];

/** 계좌 등록 요청 */
export const registerAccountRequestSchema = z.object({
  bankCode: z.string().trim().min(1, { error: '은행을 골라 주세요.' }),
  /** 하이픈은 화면에서 지우고 보낸다. 숫자만 저장한다 */
  accountNumber: z
    .string()
    .trim()
    .min(1, { error: '계좌번호를 입력해 주세요.' }),
  holderName: z.string().trim().min(1, { error: '예금주를 입력해 주세요.' }),
});
export type RegisterAccountRequest = z.infer<
  typeof registerAccountRequestSchema
>;

/**
 * 화면이 보는 계좌. **평문 계좌번호가 없다.**
 *
 * 스키마에 자리를 안 두면 실수로 얹어 보내도 여기서 떨어져 나간다 —
 * #2의 비밀번호 해시에 쓴 것과 같은 방식이다.
 */
export const maskedAccountSchema = z.object({
  bankCode: z.string(),
  bankName: z.string(),
  /** `****1234` 형태 */
  maskedAccountNumber: z.string(),
  holderName: z.string(),
  verificationStatus: z.enum(ACCOUNT_VERIFICATION_STATUSES),
  rejectedReason: z.string().nullable(),
});
export type MaskedAccount = z.infer<typeof maskedAccountSchema>;

/** 은행 이름. 모르는 코드면 코드를 그대로 보여준다 */
export function bankNameOf(bankCode: string): string {
  return BANK_CODES[bankCode as BankCode] ?? bankCode;
}

/** `****1234`. 뒤 4자리만 남긴다 */
export function maskAccountNumber(last4: string): string {
  return `****${last4}`;
}

/**
 * 계좌번호 형식 검사. **`StubAccountVerifier`가 보는 것이 이것뿐이다** (§6.4.2).
 *
 * 통과하면 실명 대조 없이 바로 `VERIFIED`다. 관리자 대기 단계를 만들지 않는
 * 이유는 실서비스와 단계 수가 같아야 전환할 때 화면을 안 고치기 때문이다.
 */
export function checkAccountFormat(input: {
  bankCode: string;
  accountNumber: string;
}): { ok: true } | { ok: false; reason: string } {
  if (!(input.bankCode in BANK_CODES)) {
    return { ok: false, reason: '지원하지 않는 은행입니다.' };
  }

  if (!/^\d+$/.test(input.accountNumber)) {
    return { ok: false, reason: '계좌번호는 숫자만 입력해 주세요.' };
  }

  const { length } = input.accountNumber;
  if (
    length < ACCOUNT_NUMBER_MIN_LENGTH ||
    length > ACCOUNT_NUMBER_MAX_LENGTH
  ) {
    return {
      ok: false,
      reason: `계좌번호는 ${ACCOUNT_NUMBER_MIN_LENGTH}~${ACCOUNT_NUMBER_MAX_LENGTH}자리입니다.`,
    };
  }

  return { ok: true };
}
