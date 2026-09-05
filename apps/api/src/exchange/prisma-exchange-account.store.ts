import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AccountRecord,
  ExchangeAccountStore,
} from './exchange-account.service';

/** 계좌 저장소. 회원당 하나라 `userId` 유니크에 upsert한다 */
@Injectable()
export class PrismaExchangeAccountStore implements ExchangeAccountStore {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(record: AccountRecord): Promise<AccountRecord> {
    const { userId, ...rest } = record;
    // 계좌를 바꿨는데 옛 검증 상태가 남으면 검증 안 된 계좌로 송금이 나간다.
    // upsert가 상태까지 통째로 덮어쓰므로 그 일이 없다.
    const row = await this.prisma.exchangeAccount.upsert({
      where: { userId },
      update: rest,
      create: record,
    });
    return toRecord(row);
  }

  async findByUser(userId: string): Promise<AccountRecord | null> {
    const row = await this.prisma.exchangeAccount.findUnique({
      where: { userId },
    });
    return row === null ? null : toRecord(row);
  }
}

function toRecord(row: {
  userId: string;
  bankCode: string;
  accountNumberEncrypted: string;
  accountNumberLast4: string;
  holderName: string;
  verificationStatus: string;
  rejectedReason: string | null;
}): AccountRecord {
  return {
    ...row,
    verificationStatus:
      row.verificationStatus as AccountRecord['verificationStatus'],
  };
}
