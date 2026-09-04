import { Injectable } from '@nestjs/common';
import {
  PAYMENT_ERRORS,
  refundIdempotencyKey,
  type RefundResult,
} from '@fixer/shared';
import { PaymentError } from './charge.service';
import { PointLedgerService } from './point-ledger.service';

/** 소진 대상이 되는 결제 건 하나 */
export interface RefundableLot {
  paymentId: string;
  /** 이 lot에 아직 남아 있는 금액. **원장에서 계산된 값이다** (ADR-PAY-7) */
  remaining: number;
  /** 카드 취소 기한. `null`이면 기한 없음 */
  refundableUntil: Date | null;
}

export interface RefundStore {
  /**
   * 환불에 쓸 수 있는 lot들을 **오래된 것부터** 준다.
   *
   * lot 잔여는 컬럼이 아니라 `sourcePaymentId`를 가진 원장 행들의 합이다
   * (ADR-PAY-7). 숫자가 두 벌이면 어긋났을 때 어느 쪽이 맞는지 알 수 없다.
   */
  listRefundableLots(userId: string): Promise<RefundableLot[]>;
  /** 결제 건 하나 */
  findLot(paymentId: string): Promise<
    | (RefundableLot & {
        userId: string;
        status: 'PENDING' | 'PAID' | 'CANCELLED';
      })
    | null
  >;
  /** 남은 것이 0이 된 lot을 취소로 표시한다 */
  markCancelled(paymentId: string): Promise<void>;
}

/**
 * 결제 취소. (이슈 #29, `ADR-PAY-7`)
 *
 * **환불은 잔액을 줄이는 일이 아니라 특정 카드 결제 건을 취소하는 일이다.**
 * 그래서 어느 `paymentId`에서 얼마를 빼는지가 정해져야 하고, 오래된
 * 결제 건부터 소진한다 — 카드 취소 기한이 그쪽부터 먼저 만료되므로
 * 취소 불가로 굳는 금액이 최소가 된다.
 */
@Injectable()
export class RefundService {
  constructor(
    private readonly lots: RefundStore,
    private readonly ledger: PointLedgerService,
  ) {}

  /** 결제 건 하나를 통째로 취소한다. 두 번 불러도 한 번만 반영된다 */
  async cancelPayment(input: {
    userId: string;
    paymentId: string;
  }): Promise<RefundResult> {
    const lot = await this.lots.findLot(input.paymentId);
    if (!lot) {
      throw new PaymentError(PAYMENT_ERRORS.NOT_FOUND);
    }
    if (lot.userId !== input.userId) {
      throw new PaymentError(PAYMENT_ERRORS.NOT_OWNED);
    }
    if (lot.status === 'PENDING') {
      // 결제되지 않은 건은 취소할 것이 없다.
      throw new PaymentError(PAYMENT_ERRORS.NOT_PAID);
    }

    // 남은 것이 없으면 이미 취소된 것이다. 오류가 아니라 "다시 해도 그대로"다.
    if (lot.remaining === 0) {
      return {
        refunded: 0,
        balance: await this.ledger.balanceOf(input.userId),
        lots: [],
        applied: false,
      };
    }

    // 전액 취소도 금액 환불과 **같은 경로**를 탄다. 코드를 나누면 한쪽만
    // 고쳐 잔액 검사가 빠지는 날이 온다.
    return this.consume(input.userId, lot.remaining, [lot]);
  }

  /** 금액만큼 환불한다. 오래된 결제 건부터 소진한다 */
  async refund(input: {
    userId: string;
    amount: number;
  }): Promise<RefundResult> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new PaymentError(PAYMENT_ERRORS.INVALID_AMOUNT);
    }

    const lots = await this.lots.listRefundableLots(input.userId);
    return this.consume(input.userId, input.amount, lots);
  }

  /**
   * lot들을 순서대로 소진한다.
   *
   * 원장 행을 **lot마다 하나씩** 쓴다. 환불 한 번에 카드 취소가 여러 번
   * 나갈 수 있고 중간에 하나가 실패할 수 있으므로, 어느 카드에 얼마가
   * 나갔는지가 원장에 남아야 한다 (ADR-PAY-7).
   */
  private async consume(
    userId: string,
    amount: number,
    lots: RefundableLot[],
  ): Promise<RefundResult> {
    // **lot 잔여가 아니라 원장 합계로 본다.** 포인트를 이미 썼으면 그 돈은
    // 우리 손을 떠났으므로 카드로 돌려줄 수 없다. lot만 보면 "lot에는
    // 있는데 잔액에는 없는" 상태에서 통과해 잔액이 음수가 된다.
    const balance = await this.ledger.balanceOf(userId);
    if (amount > balance) {
      throw new PaymentError(PAYMENT_ERRORS.INSUFFICIENT_BALANCE);
    }

    const now = new Date();
    let left = amount;
    const taken: { paymentId: string; amount: number }[] = [];
    let applied = false;

    for (const lot of lots) {
      if (left === 0) break;
      if (lot.remaining <= 0) continue;
      // 기한이 지난 lot은 건너뛴다. 카드로 되돌릴 수 없기 때문이다.
      if (lot.refundableUntil !== null && lot.refundableUntil <= now) continue;

      const take = Math.min(lot.remaining, left);
      const consumedTotal = lot.remaining - take;

      // 멱등 키를 **lot과 소진 후 잔여**로 만든다. 같은 취소를 두 번 하면
      // 두 번째도 같은 키가 나와 유니크 위반으로 막힌다 (AC3).
      const { inserted } = await this.ledger.recordOnce({
        userId,
        type: 'REFUND',
        amount: -take,
        idempotencyKey: refundIdempotencyKey(lot.paymentId, consumedTotal),
        sourcePaymentId: lot.paymentId,
      });

      if (inserted) applied = true;
      taken.push({ paymentId: lot.paymentId, amount: take });
      left -= take;

      if (consumedTotal === 0) {
        await this.lots.markCancelled(lot.paymentId);
      }
    }

    if (left > 0) {
      // 잔액은 충분한데 소진할 lot이 없다. 기한이 지난 lot만 남은 경우다.
      throw new PaymentError(PAYMENT_ERRORS.NO_REFUNDABLE_LOT);
    }

    return {
      refunded: amount,
      balance: await this.ledger.balanceOf(userId),
      lots: taken,
      applied,
    };
  }
}
