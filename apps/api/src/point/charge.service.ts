import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  PAYMENT_ERRORS,
  chargeIdempotencyKey,
  startChargeRequestSchema,
  type ChargeResult,
  type PaymentErrorCode,
  type StartedCharge,
} from '@fixer/shared';
import { PointLedgerService } from './point-ledger.service';

/** 결제가 던지는 도메인 에러 */
export class PaymentError extends Error {
  constructor(readonly code: PaymentErrorCode) {
    super(code);
    this.name = 'PaymentError';
  }
}

/** 포트원이 아는 결제 건 */
export interface GatewayPayment {
  id: string;
  /** 원 단위. **이 값이 진실이다** — 클라이언트가 준 값이 아니다 */
  amount: number;
  status: 'PAID' | 'CANCELLED' | 'PENDING' | 'FAILED';
}

/**
 * 포트원. **테스트 모드와 실결제는 이 포트 뒤에서만 다르다** (ADR-PAY-5).
 *
 * 개발 중에는 채널키가 없어 결제창을 띄울 수 없으므로 가짜를 꽂는다.
 */
export interface PaymentGateway {
  find(paymentId: string): Promise<GatewayPayment | null>;
}

/** 웹훅 서명. 위조된 요청으로 잔액을 만들 수 없어야 한다 */
export interface WebhookVerifier {
  verify(rawBody: string, headers: Record<string, string | undefined>): boolean;
}

/** 우리가 들고 있는 결제 건 */
export interface PaymentRecord {
  id: string;
  userId: string;
  amount: number;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
}

export interface PaymentStore {
  create(input: {
    id: string;
    userId: string;
    amount: number;
  }): Promise<PaymentRecord>;
  find(paymentId: string): Promise<PaymentRecord | null>;
  markPaid(paymentId: string): Promise<void>;
}

/**
 * 포인트 충전. (이슈 #28, `spec-fixed.md` §6.3)
 *
 * **클라이언트가 준 금액을 믿지 않는다.** 결제 시작 때 서버가 금액을 박아
 * 두고, 확정 때 포트원에 다시 물어 그 값과 대조한다. 클라이언트가 되돌려
 * 보내는 것은 식별자 하나뿐이라 조작할 값이 없다.
 */
@Injectable()
export class ChargeService {
  constructor(
    private readonly payments: PaymentStore,
    private readonly gateway: PaymentGateway,
    private readonly ledger: PointLedgerService,
    private readonly webhooks: WebhookVerifier,
  ) {}

  /** 결제창을 열기 전에 서버가 금액을 정해 둔다 */
  async start(userId: string, input: unknown): Promise<StartedCharge> {
    const parsed = startChargeRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new PaymentError(PAYMENT_ERRORS.INVALID_AMOUNT);
    }

    // 식별자도 서버가 만든다. 클라이언트가 정하면 남의 건을 가리킬 수 있다.
    const created = await this.payments.create({
      id: `pay_${randomUUID()}`,
      userId,
      amount: parsed.data.amount,
    });

    return { paymentId: created.id, amount: created.amount };
  }

  /**
   * 결제를 확정하고 `CHARGE`를 기록한다.
   *
   * **웹훅과 확정 API가 같은 이 함수를 부른다.** 코드를 나누면 한쪽만 고쳐
   * 금액 대조가 빠지는 날이 온다. 어느 쪽이 먼저 오든 결과가 같아야 한다.
   */
  async confirm(input: {
    paymentId: string;
    /** 확정 API는 로그인한 회원, 웹훅은 모른다(그래서 undefined) */
    userId?: string;
  }): Promise<ChargeResult> {
    const ours = await this.payments.find(input.paymentId);
    if (!ours) {
      throw new PaymentError(PAYMENT_ERRORS.NOT_FOUND);
    }

    // 남의 결제 건을 확정해 자기 잔액을 늘리는 것을 막는다.
    if (input.userId !== undefined && ours.userId !== input.userId) {
      throw new PaymentError(PAYMENT_ERRORS.NOT_OWNED);
    }

    const theirs = await this.gateway.find(input.paymentId);
    if (!theirs) {
      throw new PaymentError(PAYMENT_ERRORS.NOT_FOUND);
    }

    if (theirs.status !== 'PAID') {
      // PENDING과 FAILED를 한 코드로 묶되, 화면이 다르게 말할 수 있도록
      // 상태는 그대로 올려보낸다.
      throw new PaymentError(PAYMENT_ERRORS.NOT_PAID);
    }

    // **여기가 이 이슈의 심장이다.** 우리가 박아 둔 금액과 포트원이 준 금액이
    // 다르면 아무것도 하지 않는다.
    if (theirs.amount !== ours.amount) {
      throw new PaymentError(PAYMENT_ERRORS.AMOUNT_MISMATCH);
    }

    // 멱등 키는 포트원 식별자에서 만든다. 우리가 만들면 재전송 때 같은 키가
    // 나오는 것을 보장할 수 없다 (ADR-PAY-3).
    const { record, inserted } = await this.ledger.recordOnce({
      userId: ours.userId,
      type: 'CHARGE',
      amount: ours.amount,
      idempotencyKey: chargeIdempotencyKey(ours.id),
      sourcePaymentId: ours.id,
    });

    // 원장이 실제로 늘었는지는 **원장이 안다.** 우리 쪽 status로 판정하면
    // 웹훅 두 개가 동시에 와서 둘 다 PENDING을 읽었을 때 둘 다 참이 된다.
    if (inserted) {
      await this.payments.markPaid(ours.id);
    }

    return {
      paymentId: ours.id,
      charged: record.amount,
      balance: await this.ledger.balanceOf(ours.userId),
      applied: inserted,
    };
  }

  /**
   * 포트원 웹훅.
   *
   * 서명을 먼저 본다. 위조된 본문으로 잔액을 만들 수 있으면 나머지 검증이
   * 전부 무의미해진다.
   */
  async handleWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): Promise<ChargeResult> {
    if (!this.webhooks.verify(rawBody, headers)) {
      throw new PaymentError(PAYMENT_ERRORS.WEBHOOK_SIGNATURE_INVALID);
    }

    const paymentId = paymentIdOf(rawBody);
    if (paymentId === null) {
      throw new PaymentError(PAYMENT_ERRORS.NOT_FOUND);
    }

    // 웹훅은 누가 보냈는지 모른다. 결제 건에 적힌 주인을 그대로 쓴다.
    return this.confirm({ paymentId });
  }
}

/**
 * 웹훅 본문에서 결제 건 식별자를 꺼낸다.
 *
 * 본문의 **다른 값은 하나도 쓰지 않는다.** 금액도 상태도 포트원 API에
 * 다시 물어본다 — 서명이 맞아도 본문은 우리가 만든 것이 아니다.
 */
function paymentIdOf(rawBody: string): string | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    const id = (parsed as { data?: { paymentId?: unknown } }).data?.paymentId;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}
