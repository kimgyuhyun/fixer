import { z } from 'zod';

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
