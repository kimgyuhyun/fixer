import { Injectable } from '@nestjs/common';
import type {
  AdminAction,
  AdminExchangeFilter,
  ExchangeRequestStatus,
} from '@fixer/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { ExchangeRequestRecord } from '../exchange/exchange-request.service';
import type {
  AdminExchangeRow,
  AdminExchangeStore,
} from './admin-exchange.service';

/**
 * 관리자 환전 저장소. (이슈 #34)
 *
 * **이 파일이 상태 전이의 최종 판정자다.** 조건부 UPDATE 한 문장으로
 * "기대한 상태였을 때만" 옮긴다 — 관리자 둘이 같은 건을 동시에 눌러도
 * 하나만 통과한다 (`ADR-PAY-2`와 같은 모양).
 */
@Injectable()
export class PrismaAdminExchangeStore implements AdminExchangeStore {
  constructor(private readonly prisma: PrismaService) {}

  async listAll(
    filter: AdminExchangeFilter,
    pageSize: number,
  ): Promise<{ items: AdminExchangeRow[]; total: number }> {
    const where = filter.status ? { status: filter.status } : {};

    const [rows, total] = await Promise.all([
      this.prisma.exchangeRequest.findMany({
        where,
        // 신청자 이름과 계좌를 함께 가져온다. 목록을 그린 뒤 화면이 따로
        // 부르면 한 페이지에 스무 번을 더 부르게 된다.
        include: {
          user: {
            select: {
              name: true,
              exchangeAccount: {
                select: {
                  bankCode: true,
                  accountNumberLast4: true,
                  holderName: true,
                  verificationStatus: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        // 범위를 넘은 페이지는 오류가 아니라 빈 목록이다 (#35와 같은 규칙).
        skip: (filter.page - 1) * pageSize,
        take: pageSize,
      }),
      // **필터를 적용한 뒤의** 건수다. 같은 where를 쓴다.
      this.prisma.exchangeRequest.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        amount: row.amount,
        status: row.status,
        createdAt: row.createdAt,
        requesterName: row.user.name,
        account: row.user.exchangeAccount,
      })),
      total,
    };
  }

  async findById(id: string): Promise<ExchangeRequestRecord | null> {
    const row = await this.prisma.exchangeRequest.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        amount: true,
        status: true,
        createdAt: true,
      },
    });
    return row;
  }

  async updateStatus(input: {
    requestId: string;
    expectedStatus: ExchangeRequestStatus;
    nextStatus: ExchangeRequestStatus;
    adminId: string;
    action: AdminAction;
  }): Promise<ExchangeRequestRecord | 'STALE'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 조건부 UPDATE 한 문장. 기대한 상태가 아니면 0건이다 — 다른
        // 관리자가 먼저 눌렀다는 뜻이라 덮어쓰지 않는다.
        const affected = await tx.exchangeRequest.updateMany({
          where: { id: input.requestId, status: input.expectedStatus },
          data: { status: input.nextStatus },
        });
        if (affected.count === 0) {
          throw new Stale();
        }

        // **같은 트랜잭션이다** (§11.5). 뒤에 따로 쓰면 그 사이에 죽었을 때
        // "승인은 됐는데 누가 왜 했는지 없는" 건이 남는다.
        await tx.adminAuditLog.create({
          data: {
            adminId: input.adminId,
            action: input.action,
            targetType: 'ExchangeRequest',
            targetId: input.requestId,
          },
        });

        return await tx.exchangeRequest.findUniqueOrThrow({
          where: { id: input.requestId },
          select: {
            id: true,
            userId: true,
            amount: true,
            status: true,
            createdAt: true,
          },
        });
      });
    } catch (error) {
      if (error instanceof Stale) return 'STALE';
      throw error;
    }
  }

  async reject(input: {
    requestId: string;
    userId: string;
    amount: number;
    expectedStatus: ExchangeRequestStatus;
    adminId: string;
    reason: string;
  }): Promise<ExchangeRequestRecord | 'STALE'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const affected = await tx.exchangeRequest.updateMany({
          where: { id: input.requestId, status: input.expectedStatus },
          data: { status: 'REJECTED' },
        });
        if (affected.count === 0) {
          throw new Stale();
        }

        // 원장 행과 캐시를 함께 되돌린다 (`ADR-PAY-1`). 진실은 원장이고
        // `cachedBalance`는 표시용이라 둘이 어긋나면 안 된다.
        await tx.pointTransaction.create({
          data: {
            userId: input.userId,
            type: 'EXCHANGE_REVERT',
            // 부호는 amount에 담는다 (§6.1). 요청이 음수였으니 반려는 양수다.
            amount: input.amount,
            idempotencyKey: `exchange-revert:${input.requestId}`,
            // 어느 요청을 되돌린 것인지 여기서 되짚는다.
            referenceId: input.requestId,
          },
        });
        await tx.user.update({
          where: { id: input.userId },
          data: { cachedBalance: { increment: input.amount } },
        });

        await tx.adminAuditLog.create({
          data: {
            adminId: input.adminId,
            action: 'EXCHANGE_REJECT',
            targetType: 'ExchangeRequest',
            targetId: input.requestId,
            reason: input.reason,
          },
        });

        return await tx.exchangeRequest.findUniqueOrThrow({
          where: { id: input.requestId },
          select: {
            id: true,
            userId: true,
            amount: true,
            status: true,
            createdAt: true,
          },
        });
      });
    } catch (error) {
      if (error instanceof Stale) return 'STALE';
      throw error;
    }
  }

  async recordAudit(input: {
    adminId: string;
    action: AdminAction;
    targetId: string;
  }): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminId: input.adminId,
        action: input.action,
        targetType: 'ExchangeRequest',
        targetId: input.targetId,
      },
    });
  }
}

/** 트랜잭션을 되돌리기 위한 내부 신호. 밖으로 새지 않는다 */
class Stale extends Error {}
