import { Injectable } from '@nestjs/common';
import type { AdminAction, AdminExchangeFilter } from '@fixer/shared';
import type { ExchangeRequestStatus } from '@fixer/shared';
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

  listAll(
    filter: AdminExchangeFilter,
    pageSize: number,
  ): Promise<{ items: AdminExchangeRow[]; total: number }> {
    throw new Error('not implemented');
  }

  findById(id: string): Promise<ExchangeRequestRecord | null> {
    throw new Error('not implemented');
  }

  updateStatus(input: {
    requestId: string;
    expectedStatus: ExchangeRequestStatus;
    nextStatus: ExchangeRequestStatus;
    adminId: string;
    action: AdminAction;
  }): Promise<ExchangeRequestRecord | 'STALE'> {
    throw new Error('not implemented');
  }

  reject(input: {
    requestId: string;
    userId: string;
    amount: number;
    expectedStatus: ExchangeRequestStatus;
    adminId: string;
    reason: string;
  }): Promise<ExchangeRequestRecord | 'STALE'> {
    throw new Error('not implemented');
  }

  recordAudit(input: {
    adminId: string;
    action: AdminAction;
    targetId: string;
  }): Promise<void> {
    throw new Error('not implemented');
  }
}
