import { z } from 'zod';

/**
 * 원장 유형. (`spec-fixed.md` §6.1)
 *
 * **부호는 `amount`에 담는다.** 유형별로 부호를 다시 계산하면 그 계산이 여러
 * 곳에 흩어지고, 한 곳만 틀려도 잔액이 어긋난다. 합계가 곧 잔액이어야 한다.
 */
export const POINT_TRANSACTION_TYPES = [
  /** 포트원 결제 웹훅 검증 성공 시 (+) */
  'CHARGE',
  /** 공고 OPEN 전환 시 예산을 묶는다 (−) */
  'HOLD',
  /** 미체결 인원분 반환 (+) */
  'RELEASE',
  /** 업무 완료 확인 시. 구인자 −, 구직자 + 두 행이다 */
  'PAYOUT',
  /** 환전 요청 시 환전 대기로 옮긴다 (−) */
  'EXCHANGE_REQUEST',
  /** 환전 요청 반려 시 되돌린다 (+) */
  'EXCHANGE_REVERT',
  /** 결제 취소 (−) */
  'REFUND',
] as const;

export type PointTransactionType = (typeof POINT_TRANSACTION_TYPES)[number];

/** 포인트가 내는 에러 코드 */
export const POINT_ERRORS = {
  /** 쓰려는 금액이 잔액보다 크다 */
  INSUFFICIENT_BALANCE: 'POINT_INSUFFICIENT_BALANCE',
  /** 금액이 0이거나 정수가 아니다 */
  INVALID_AMOUNT: 'POINT_INVALID_AMOUNT',
} as const;

export type PointErrorCode = (typeof POINT_ERRORS)[keyof typeof POINT_ERRORS];

/**
 * 원장에 쓸 한 줄.
 *
 * `amount`는 **부호를 포함한 값**이다. `HOLD 6000`은 `amount: -6000`으로 온다.
 */
export const ledgerEntrySchema = z.object({
  userId: z.string().min(1),
  type: z.enum(POINT_TRANSACTION_TYPES),
  /**
   * 0은 허용하지 않는다. 아무것도 바꾸지 않는 행은 원장을 읽기만 어렵게 한다.
   * 1포인트 = 1원이므로 소수도 없다 (`spec-fixed.md` §0).
   */
  amount: z
    .number()
    .int({ error: '포인트는 정수여야 합니다.' })
    .refine((v) => v !== 0, { error: '0원짜리 원장은 쓰지 않습니다.' }),
  /** 웹훅 중복 수신 방어. 우리가 만들지 않고 외부 식별자에서 온다 (ADR-PAY-3) */
  idempotencyKey: z.string().min(1),
  /** 어느 결제 건에서 나왔나 (ADR-PAY-7) */
  sourcePaymentId: z.string().min(1).nullish(),
  /** 무엇 때문에 생긴 행인가. 공고 id, 환전 요청 id 등 */
  referenceId: z.string().min(1).nullish(),
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

/** 잔액을 줄이는 유형인가. 검증이 필요한 쪽이다 */
export function isSpending(amount: number): boolean {
  return amount < 0;
}
