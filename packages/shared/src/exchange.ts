import { z } from 'zod';
import { ACCOUNT_VERIFICATION_STATUSES } from './exchange-account.js';

/** 환전 최소 금액 (`spec-fixed.md` §6.4.1) */
export const EXCHANGE_MIN_AMOUNT = 5_000;
/** 환전 금액 단위 (§6.4.1) */
export const EXCHANGE_AMOUNT_UNIT = 10;
/** 지급받은 뒤 환전 가능해지기까지 (§6.4.1) */
export const EXCHANGE_MATURITY_DAYS = 7;

/**
 * 환전 요청 상태 (§6.4.1).
 *
 * #31이 만드는 것은 `REQUESTED`까지다. 나머지 셋은 관리자 승인 이슈가 쓴다 —
 * 지금 자리를 만들어 두는 이유는 상태 컬럼의 모양이 그때 바뀌지 않게 하기
 * 위해서다.
 */
export const EXCHANGE_REQUEST_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'COMPLETED',
  'REJECTED',
] as const;
export type ExchangeRequestStatus = (typeof EXCHANGE_REQUEST_STATUSES)[number];

/** 환전이 내는 에러 코드 */
export const EXCHANGE_ERRORS = {
  /** 5,000원 미만이다 */
  BELOW_MIN_AMOUNT: 'EXCHANGE_BELOW_MIN_AMOUNT',
  /** 10원 단위가 아니다 */
  INVALID_UNIT: 'EXCHANGE_INVALID_UNIT',
  /** 지급받은 지 7일이 안 된 포인트다 */
  NOT_MATURED: 'EXCHANGE_NOT_MATURED',
  /** 계좌가 검증되지 않았거나 등록조차 안 됐다 */
  ACCOUNT_NOT_VERIFIED: 'EXCHANGE_ACCOUNT_NOT_VERIFIED',
  /** 그런 환전 요청이 없다 (#34) */
  REQUEST_NOT_FOUND: 'EXCHANGE_REQUEST_NOT_FOUND',
  /** 전이표에 없는 상태 변경이다 (#34) */
  INVALID_TRANSITION: 'EXCHANGE_INVALID_TRANSITION',
} as const;

export type ExchangeErrorCode =
  (typeof EXCHANGE_ERRORS)[keyof typeof EXCHANGE_ERRORS];

/**
 * 환전 요청.
 *
 * **금액 규칙은 여기서 보지 않는다** — zod(런타임에 데이터 모양을 검사하고
 * TypeScript 타입까지 만들어주는 라이브러리)가 5,000원 미만을 거르면
 * `VALIDATION_FAILED`가 나가는데, 요청한 사람이 알아야 하는 것은
 * `EXCHANGE_BELOW_MIN_AMOUNT`다.
 */
export const requestExchangeSchema = z.object({
  userId: z.string().min(1),
  amount: z
    .number()
    .int({ error: '포인트는 정수여야 합니다.' })
    .positive({ error: '금액을 입력해 주세요.' }),
});
export type RequestExchange = z.infer<typeof requestExchangeSchema>;

/** 요청한 사람이 돌려받는 환전 한 건 */
export const exchangeRequestSummarySchema = z.object({
  id: z.string(),
  amount: z.number().int(),
  status: z.enum(EXCHANGE_REQUEST_STATUSES),
  requestedAt: z.string(),
});
export type ExchangeRequestSummary = z.infer<
  typeof exchangeRequestSummarySchema
>;

/**
 * 이 시각 이전에 지급된 포인트만 환전할 수 있다 (§6.4.1).
 *
 * **서비스와 저장소가 같은 함수를 부른다.** 두 곳이 각자 계산하면 한쪽만
 * 고쳤을 때 1차 방어와 최종 판정이 서로 다른 기준을 쓰게 된다.
 */
export function maturityCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - EXCHANGE_MATURITY_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * 금액 규칙. #30의 `checkAccountFormat`과 같은 자리다.
 *
 * **최소금액이 단위보다 먼저다.** 4,005원처럼 둘 다 걸리는 값에서 어느 쪽이
 * 나오는지 정해두지 않으면 테스트가 구현을 따라가게 된다.
 */
export function checkExchangeAmount(
  amount: number,
): { ok: true } | { ok: false; code: ExchangeErrorCode } {
  if (amount < EXCHANGE_MIN_AMOUNT) {
    return { ok: false, code: EXCHANGE_ERRORS.BELOW_MIN_AMOUNT };
  }
  if (amount % EXCHANGE_AMOUNT_UNIT !== 0) {
    return { ok: false, code: EXCHANGE_ERRORS.INVALID_UNIT };
  }
  return { ok: true };
}

/**
 * 관리자 환전 목록 한 페이지 건수. (#34, §11.5)
 *
 * 공고 목록(`JOB_POST_PAGE_SIZE`)과 값이 같지만 상수를 공유하지 않는다 —
 * 한쪽을 늘릴 이유와 다른 쪽을 늘릴 이유가 다르다.
 */
export const EXCHANGE_PAGE_SIZE = 20;

/**
 * 환전 상태 전이표. (#34, §6.4.1)
 *
 * **`COMPLETED`와 `REJECTED`는 종착역이다.** 이체가 끝난 건을 반려하면
 * 돈은 나갔는데 포인트까지 돌려주게 되고, 원복된 건을 다시 승인하면
 * 없는 돈이 나간다.
 */
export function canTransitionExchange(
  from: ExchangeRequestStatus,
  to: ExchangeRequestStatus,
): boolean {
  throw new Error('not implemented');
}

/** 관리자 환전 목록 필터. 상태와 페이지만 본다 (#34) */
export const adminExchangeFilterSchema = z.object({
  /** 없으면 전부 */
  status: z.enum(EXCHANGE_REQUEST_STATUSES).optional(),
  /** 1부터. 범위를 넘으면 오류가 아니라 빈 목록이다 (#35와 같은 규칙) */
  page: z.coerce.number().int().min(1).catch(1).default(1),
});
export type AdminExchangeFilter = z.infer<typeof adminExchangeFilterSchema>;

/**
 * 관리자 목록 한 줄. AC1이 요구하는 네 칸이 그대로 필드다.
 *
 * **계좌 블록이 통째로 nullable이다.** 파기 배치(#39)가 계좌를 지운 뒤에도
 * 환전 이력은 남는다 — 그때 빈 문자열을 채우면 "없음"과 "빈 값"이 섞인다.
 */
export const adminExchangeRequestSummarySchema = z.object({
  id: z.string(),
  requesterName: z.string(),
  amount: z.number().int(),
  status: z.enum(EXCHANGE_REQUEST_STATUSES),
  requestedAt: z.iso.datetime(),
  account: z
    .object({
      bankName: z.string(),
      /** `****1234`. **평문은 이 스키마를 통과하지 못한다** */
      maskedAccountNumber: z.string(),
      holderName: z.string(),
      verificationStatus: z.enum(ACCOUNT_VERIFICATION_STATUSES),
    })
    .nullable(),
});
export type AdminExchangeRequestSummary = z.infer<
  typeof adminExchangeRequestSummarySchema
>;

/** 목록 응답. 오프셋 페이징이라 전체 건수를 함께 준다 */
export const adminExchangeListSchema = z.object({
  items: z.array(adminExchangeRequestSummarySchema),
  /** **필터를 적용한 뒤의** 건수 */
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AdminExchangeList = z.infer<typeof adminExchangeListSchema>;

/** 승인·이체 완료의 응답. 바뀐 상태만 돌려준다 */
export const exchangeActionResultSchema = z.object({
  id: z.string(),
  status: z.enum(EXCHANGE_REQUEST_STATUSES),
});
export type ExchangeActionResult = z.infer<typeof exchangeActionResultSchema>;

/** 반려 요청. **사유가 필수다** (§11.5) */
export const rejectExchangeRequestSchema = z.object({
  reason: z.string().trim().min(1, { error: '반려 사유를 입력해 주세요.' }),
});
export type RejectExchangeRequest = z.infer<typeof rejectExchangeRequestSchema>;

/** 반려 응답. 되돌린 금액을 함께 준다 — 화면이 다시 묻지 않아도 된다 */
export const rejectExchangeResultSchema = z.object({
  id: z.string(),
  status: z.enum(EXCHANGE_REQUEST_STATUSES),
  reverted: z.number().int(),
});
export type RejectExchangeResult = z.infer<typeof rejectExchangeResultSchema>;

/**
 * 계좌번호 전체 열람의 응답. (#34 AC4)
 *
 * **은행명·예금주는 담지 않는다.** 목록에 이미 있고, 한 벌 더 실으면 평문
 * 계좌번호가 담긴 페이로드만 커진다.
 */
export const revealedAccountSchema = z.object({
  accountNumber: z.string(),
});
export type RevealedAccount = z.infer<typeof revealedAccountSchema>;
