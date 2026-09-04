import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { PaymentRecord, PaymentStore } from './charge.service';

/** 결제 건 저장소. FIFO 환불(#29)이 `createdAt` 순서를 쓴다 (ADR-PAY-7) */
@Injectable()
export class PrismaPaymentStore implements PaymentStore {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    id: string;
    userId: string;
    amount: number;
  }): Promise<PaymentRecord> {
    const row = await this.prisma.payment.create({ data: input });
    return toRecord(row);
  }

  async find(paymentId: string): Promise<PaymentRecord | null> {
    const row = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    return row === null ? null : toRecord(row);
  }

  async markPaid(paymentId: string): Promise<void> {
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'PAID' },
    });
  }
}

function toRecord(row: {
  id: string;
  userId: string;
  amount: number;
  status: string;
}): PaymentRecord {
  return {
    id: row.id,
    userId: row.userId,
    amount: row.amount,
    status: row.status as PaymentRecord['status'],
  };
}
