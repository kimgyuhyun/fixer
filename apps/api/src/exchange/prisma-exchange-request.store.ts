import { Injectable } from '@nestjs/common';
import { EXCHANGE_MATURITY_DAYS } from '@fixer/shared';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ExchangeRequestRecord,
  ExchangeRequestStore,
  MaturedPointReader,
} from './exchange-request.service';

/**
 * 환전 요청 저장소. **이 파일이 성숙도 게이트의 최종 판정자다.**
 *
 * 성숙액은 컬럼이 아니라 원장 질의 결과라 `ADR-PAY-2`의 조건부 UPDATE가
 * 지켜주지 못한다. 그래서 트랜잭션 안에서 잔액 UPDATE를 먼저 걸어 그 회원의
 * 행을 잠근 뒤 성숙액을 다시 센다 — 뒤에 온 요청은 앞 것이 커밋된 뒤에
 * 세므로 이미 빠진 금액을 본다.
 *
 * 성숙액 질의를 원장 저장소가 아니라 여기에 두는 이유는 읽기 전용 집계라
 * 원장 쪽에 없어도 손해가 없기 때문이다.
 */
@Injectable()
export class PrismaExchangeRequestStore
  implements ExchangeRequestStore, MaturedPointReader
{
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    userId: string;
    amount: number;
  }): Promise<ExchangeRequestRecord | 'INSUFFICIENT' | 'NOT_MATURED'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 조건부 UPDATE 한 문장 (`ADR-PAY-2`). 영향받은 행이 0이면 잔액이
        // 모자란 것이다. **이 문장이 그 회원의 행을 잠그기도 한다** — 아래
        // 성숙액 재계산이 동시 요청과 뒤엉키지 않는 것이 그 덕이다.
        const affected = await tx.$executeRaw`
          UPDATE "User"
          SET "cachedBalance" = "cachedBalance" - ${input.amount}
          WHERE id = ${input.userId}
            AND "cachedBalance" - ${input.amount} >= 0
        `;
        if (affected === 0) {
          throw new Rejected('INSUFFICIENT');
        }

        // 서비스가 이미 한 번 셌지만 그 사이 다른 요청이 커밋했을 수 있다.
        // **진실은 여기다** — 위 UPDATE가 잠근 뒤에 센 값이기 때문이다.
        const matured = await maturedSum(tx, input.userId, maturedBefore());
        if (matured < input.amount) {
          throw new Rejected('NOT_MATURED');
        }

        const request = await tx.exchangeRequest.create({
          data: { userId: input.userId, amount: input.amount },
        });

        // 요청 행과 원장 행이 함께 커밋된다 (`ADR-PAY-4`). 나뉘면 요청은
        // 남았는데 포인트가 안 빠진 상태가 되고, 관리자가 그걸 승인하면
        // 없는 돈이 나간다.
        await tx.pointTransaction.create({
          data: {
            userId: input.userId,
            type: 'EXCHANGE_REQUEST',
            // 부호는 amount에 담는다 (§6.1). 합계가 곧 잔액이어야 한다.
            amount: -input.amount,
            idempotencyKey: `exchange-request:${request.id}`,
            // 반려가 어느 요청을 되돌리는 것인지 여기서 되짚는다.
            referenceId: request.id,
          },
        });

        return toRecord(request);
      });
    } catch (error) {
      if (error instanceof Rejected) return error.reason;
      throw error;
    }
  }

  /** 환전할 수 있는 금액. **캐시가 아니라 원장을 합산한다** (`ADR-PAY-1`) */
  maturedBalanceOf(userId: string, maturedBefore: Date): Promise<number> {
    return maturedSum(this.prisma, userId, maturedBefore);
  }
}

/**
 * 성숙분 − 이미 쓴 환전 + 반려로 되돌아온 것.
 *
 * 환전은 오래된 것부터 소진되므로(`ADR-PAY-7`) 이미 요청한 금액을 성숙분에서
 * 그냥 빼면 된다. **안 빼면 같은 포인트를 몇 번이고 환전할 수 있다.**
 */
async function maturedSum(
  client: Pick<PrismaService, 'pointTransaction'> | Prisma.TransactionClient,
  userId: string,
  maturedBefore: Date,
): Promise<number> {
  const { _sum } = await client.pointTransaction.aggregate({
    where: {
      userId,
      OR: [
        { type: 'PAYOUT', createdAt: { lte: maturedBefore } },
        { type: { in: ['EXCHANGE_REQUEST', 'EXCHANGE_REVERT'] } },
      ],
    },
    _sum: { amount: true },
  });
  return _sum.amount ?? 0;
}

/** 이 시각 이전에 지급된 것만 환전할 수 있다 (§6.4.1) */
function maturedBefore(): Date {
  return new Date(Date.now() - EXCHANGE_MATURITY_DAYS * 24 * 60 * 60 * 1000);
}

/** 트랜잭션을 되돌리기 위한 내부 신호. 밖으로 새지 않는다 */
class Rejected extends Error {
  constructor(readonly reason: 'INSUFFICIENT' | 'NOT_MATURED') {
    super(reason);
  }
}

function toRecord(row: {
  id: string;
  userId: string;
  amount: number;
  status: string;
  createdAt: Date;
}): ExchangeRequestRecord {
  return {
    ...row,
    status: row.status as ExchangeRequestRecord['status'],
  };
}
