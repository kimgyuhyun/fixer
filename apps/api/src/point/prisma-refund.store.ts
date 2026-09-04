import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { RefundStore, RefundableLot } from './refund.service';

/**
 * 환불 저장소.
 *
 * **lot 잔여를 컬럼에서 읽지 않는다.** `sourcePaymentId`를 가진 원장 행들을
 * 합해서 낸다 (ADR-PAY-7). 컬럼으로 두면 숫자가 두 벌이 되어 어긋났을 때
 * 어느 쪽이 맞는지 판단할 근거가 없다 — `ADR-PAY-1`이 캐시를 두고 내린
 * 것과 같은 판단이다.
 */
@Injectable()
export class PrismaRefundStore implements RefundStore {
  constructor(private readonly prisma: PrismaService) {}

  async listRefundableLots(userId: string): Promise<RefundableLot[]> {
    const payments = await this.prisma.payment.findMany({
      where: { userId, status: 'PAID' },
      // 오래된 것부터. 카드 취소 기한이 그쪽부터 먼저 만료되므로,
      // 오래된 것을 먼저 쓰면 취소 불가로 굳는 금액이 최소가 된다.
      orderBy: { createdAt: 'asc' },
      select: { id: true, refundableUntil: true },
    });
    if (payments.length === 0) return [];

    const remaining = await this.remainingByPayment(payments.map((p) => p.id));

    return payments.map((p) => ({
      paymentId: p.id,
      remaining: remaining.get(p.id) ?? 0,
      refundableUntil: p.refundableUntil,
    }));
  }

  async findLot(paymentId: string): Promise<
    | (RefundableLot & {
        userId: string;
        status: 'PENDING' | 'PAID' | 'CANCELLED';
      })
    | null
  > {
    const row = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        userId: true,
        status: true,
        refundableUntil: true,
      },
    });
    if (row === null) return null;

    const remaining = await this.remainingByPayment([row.id]);

    return {
      paymentId: row.id,
      userId: row.userId,
      status: row.status,
      remaining: remaining.get(row.id) ?? 0,
      refundableUntil: row.refundableUntil,
    };
  }

  async markCancelled(paymentId: string): Promise<void> {
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'CANCELLED' },
    });
  }

  /** 한 번에 모아 센다. lot마다 따로 물으면 결제 건 수만큼 왕복한다 */
  private async remainingByPayment(
    paymentIds: string[],
  ): Promise<Map<string, number>> {
    const sums = await this.prisma.pointTransaction.groupBy({
      by: ['sourcePaymentId'],
      where: { sourcePaymentId: { in: paymentIds } },
      _sum: { amount: true },
    });

    const remaining = new Map<string, number>();
    for (const row of sums) {
      if (row.sourcePaymentId === null) continue;
      remaining.set(row.sourcePaymentId, row._sum.amount ?? 0);
    }
    return remaining;
  }
}
