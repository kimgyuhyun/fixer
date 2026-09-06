import { Injectable } from '@nestjs/common';
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

  create(input: {
    userId: string;
    amount: number;
  }): Promise<ExchangeRequestRecord | 'INSUFFICIENT' | 'NOT_MATURED'> {
    throw new Error('not implemented');
  }

  maturedBalanceOf(userId: string, maturedBefore: Date): Promise<number> {
    throw new Error('not implemented');
  }
}
