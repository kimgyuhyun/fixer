import { z } from 'zod';

/**
 * 충전 단위. (`spec-fixed.md` §0 — 1포인트 = 1원)
 *
 * 1000원 단위로만 받는다. 잔돈이 섞이면 환불 lot 소진(ADR-PAY-7)에서
 * 1원짜리 나머지가 남아 화면에 "환불 불가 1원"이 뜬다.
 */
export const CHARGE_UNIT = 1_000;

/** 한 번에 충전할 수 있는 최대. 실수로 0 하나 더 누르는 것을 막는다 */
export const CHARGE_MAX = 1_000_000;

/** 결제가 내는 에러 코드 */
export const PAYMENT_ERRORS = {
  /** 포트원이 준 금액이 우리가 박아 둔 금액과 다르다. **충전하지 않는다** */
  AMOUNT_MISMATCH: 'PAYMENT_AMOUNT_MISMATCH',
  /** 포트원이 아직 PAID라고 하지 않았다 */
  NOT_PAID: 'PAYMENT_NOT_PAID',
  /** 포트원이 그런 결제 건을 모른다 */
  NOT_FOUND: 'PAYMENT_NOT_FOUND',
  /** 남의 결제 건이다 */
  NOT_OWNED: 'PAYMENT_NOT_OWNED',
  /** 웹훅 서명이 맞지 않는다. 위조된 요청일 수 있다 */
  WEBHOOK_SIGNATURE_INVALID: 'PAYMENT_WEBHOOK_SIGNATURE_INVALID',
  /** 금액이 단위에 맞지 않거나 한도를 넘었다 */
  INVALID_AMOUNT: 'PAYMENT_INVALID_AMOUNT',
} as const;

export type PaymentErrorCode =
  (typeof PAYMENT_ERRORS)[keyof typeof PAYMENT_ERRORS];

/**
 * 충전 시작 요청.
 *
 * **금액만 받는다.** 결제 건 식별자는 서버가 만들고, 확정 때 클라이언트가
 * 되돌려 보내는 것은 그 식별자뿐이다 — 조작할 수 있는 값을 남기지 않는다.
 */
export const startChargeRequestSchema = z.object({
  amount: z
    .number()
    .int({ error: '금액은 정수여야 합니다.' })
    .positive({ error: '0원은 충전할 수 없습니다.' })
    .max(CHARGE_MAX, { error: '한 번에 100만원까지 충전할 수 있습니다.' })
    .refine((v) => v % CHARGE_UNIT === 0, {
      error: '1,000원 단위로만 충전할 수 있습니다.',
    }),
});
export type StartChargeRequest = z.infer<typeof startChargeRequestSchema>;

/** 충전 시작 응답. 이 식별자로 결제창을 연다 */
export const startedChargeSchema = z.object({
  paymentId: z.string().min(1),
  amount: z.number().int().positive(),
});
export type StartedCharge = z.infer<typeof startedChargeSchema>;

/** 확정 요청. 클라이언트가 보내는 것은 식별자 하나뿐이다 */
export const confirmChargeRequestSchema = z.object({
  paymentId: z.string().min(1),
});
export type ConfirmChargeRequest = z.infer<typeof confirmChargeRequestSchema>;

/** 확정 결과 */
export const chargeResultSchema = z.object({
  paymentId: z.string(),
  /** 이번에 충전된 금액. 이미 처리된 건이면 0이 아니라 그 건의 금액이다 */
  charged: z.number().int(),
  /** 확정 후 잔액. **원장 합계다** (ADR-PAY-1) */
  balance: z.number().int(),
  /** 이번 호출이 실제로 원장을 늘렸나. 재전송이면 false */
  applied: z.boolean(),
});
export type ChargeResult = z.infer<typeof chargeResultSchema>;

/** 포인트 내역 한 줄 */
export const pointHistoryItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  amount: z.number().int(),
  createdAt: z.iso.datetime(),
});

/** 포인트 화면이 읽는 것 */
export const pointHistorySchema = z.object({
  balance: z.number().int(),
  transactions: z.array(pointHistoryItemSchema),
});
export type PointHistory = z.infer<typeof pointHistorySchema>;

/** 멱등 키. **포트원이 준 식별자에서 만든다** (ADR-PAY-3) */
export function chargeIdempotencyKey(paymentId: string): string {
  return `charge:${paymentId}`;
}
