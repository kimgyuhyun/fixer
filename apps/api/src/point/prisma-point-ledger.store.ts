import { Injectable } from '@nestjs/common';
import type { LedgerEntry } from '@fixer/shared';
import { PrismaService } from '../prisma/prisma.service';
import type {
  PointLedgerStore,
  PointTransactionRecord,
} from './point-ledger.service';
import type { PointHistoryStore } from './point-history.service';

/** Prisma가 유니크 제약 위반에 쓰는 코드 */
const UNIQUE_VIOLATION = 'P2002';

/**
 * 원장 저장소. **이 파일이 돈의 정합성을 지키는 곳이다.**
 *
 * 두 가지를 저장소가 원자적으로 한다.
 *
 * 1. **잔액 검증** — 조건부 UPDATE 한 문장 (ADR-PAY-2). 읽고 쓰는 사이의
 *    틈으로 동시 요청 두 개가 모두 통과하는 것을 막는다. §4.4가 정원 초과에
 *    쓴 것과 같은 패턴이다.
 * 2. **멱등** — 유니크 제약 위반을 "이미 처리됨"으로 해석 (ADR-PAY-3).
 *    먼저 조회하고 없으면 넣는 방식은 조회와 삽입 사이에 틈이 있다.
 */
@Injectable()
export class PrismaPointLedgerStore
  implements PointLedgerStore, PointHistoryStore
{
  constructor(private readonly prisma: PrismaService) {}

  async append(
    entry: LedgerEntry,
  ): Promise<PointTransactionRecord | 'INSUFFICIENT' | 'DUPLICATE'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 잔액을 줄이는 행만 검증한다. 늘리는 행은 막을 이유가 없다.
        if (entry.amount < 0) {
          // 조건부 UPDATE 한 문장. 영향받은 행이 0이면 잔액이 모자란 것이다.
          // 이 문장 자체가 원자적이라 행 잠금도 직렬화 격리도 필요 없다.
          const affected = await tx.$executeRaw`
            UPDATE "User"
            SET "cachedBalance" = "cachedBalance" + ${entry.amount}
            WHERE id = ${entry.userId}
              AND "cachedBalance" + ${entry.amount} >= 0
          `;
          if (affected === 0) {
            // 트랜잭션을 되돌린다. 원장에 아무것도 안 남는다 (AC2).
            throw new InsufficientBalance();
          }
        } else {
          await tx.$executeRaw`
            UPDATE "User"
            SET "cachedBalance" = "cachedBalance" + ${entry.amount}
            WHERE id = ${entry.userId}
          `;
        }

        // 유니크 제약이 최후 방어선이다. 여기서 터지면 롤백되어 캐시 갱신도
        // 함께 되돌아간다 — 중복 웹훅이 잔액을 두 번 올리지 않는다.
        return tx.pointTransaction.create({
          data: {
            userId: entry.userId,
            type: entry.type,
            amount: entry.amount,
            idempotencyKey: entry.idempotencyKey,
            sourcePaymentId: entry.sourcePaymentId ?? null,
            referenceId: entry.referenceId ?? null,
          },
        });
      });
    } catch (error) {
      if (error instanceof InsufficientBalance) return 'INSUFFICIENT';
      if (isUniqueViolation(error)) return 'DUPLICATE';
      throw error;
    }
  }

  async findByIdempotencyKey(
    key: string,
  ): Promise<PointTransactionRecord | null> {
    return this.prisma.pointTransaction.findUnique({
      where: { idempotencyKey: key },
    });
  }

  async sumBalance(userId: string): Promise<number> {
    const { _sum } = await this.prisma.pointTransaction.aggregate({
      where: { userId },
      _sum: { amount: true },
    });
    return _sum.amount ?? 0;
  }

  async readCachedBalance(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { cachedBalance: true },
    });
    return user?.cachedBalance ?? 0;
  }

  /** 내역 화면이 읽는다. 최근 것부터 (#28 AC5) */
  async listByUser(
    userId: string,
    limit: number,
  ): Promise<PointTransactionRecord[]> {
    return this.prisma.pointTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

/** 트랜잭션을 되돌리기 위한 내부 신호. 밖으로 새지 않는다 */
class InsufficientBalance extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}
