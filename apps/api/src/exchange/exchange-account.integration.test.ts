import { execSync } from 'node:child_process';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { EnvAccountCipher } from './account-cipher';
import {
  ExchangeAccountService,
  StubAccountVerifier,
} from './exchange-account.service';
import { PrismaExchangeAccountStore } from './prisma-exchange-account.store';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * **"평문이 DB에 없다"는 진짜 DB에서만 증명된다.** (이슈 #30)
 *
 * 가짜 저장소는 내가 넣은 값을 그대로 돌려주므로, 컬럼에 무엇이 들어갔는지는
 * 실제 테이블을 읽어야 안다.
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let service: ExchangeAccountService;

const ACCOUNT_NUMBER = '11012345678';

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  service = new ExchangeAccountService(
    new PrismaExchangeAccountStore(prisma as unknown as PrismaService),
    new EnvAccountCipher({
      get: () => 'integration-master-key',
    } as unknown as ConfigService),
    new StubAccountVerifier(),
  );
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  await prisma.exchangeAccount.deleteMany();
  await prisma.user.deleteMany();
});

async function seedMember(email = 'worker@example.com'): Promise<string> {
  const user = await prisma.user.create({
    data: { email, passwordHash: 'h', name: '김구직' },
  });
  return user.id;
}

describe('계좌 등록 — 진짜 Postgres에서', () => {
  it('should leave no plain account number in the database', async () => {
    const userId = await seedMember();

    await service.register(userId, {
      bankCode: '088',
      accountNumber: ACCOUNT_NUMBER,
      holderName: '김구직',
    });

    // 행 전체를 문자열로 만들어 훑는다. 어느 컬럼에도 평문이 없어야 한다.
    const row = await prisma.exchangeAccount.findUniqueOrThrow({
      where: { userId },
    });
    expect(JSON.stringify(row)).not.toContain(ACCOUNT_NUMBER);
    expect(row.accountNumberLast4).toBe('5678');
    expect(row.verificationStatus).toBe('VERIFIED');
  });

  it('should read the number back for a payout', async () => {
    const userId = await seedMember();
    await service.register(userId, {
      bankCode: '088',
      accountNumber: ACCOUNT_NUMBER,
      holderName: '김구직',
    });

    expect(await service.revealForPayout(userId)).toBe(ACCOUNT_NUMBER);
  });

  it('should keep one account per member', async () => {
    const userId = await seedMember();
    await service.register(userId, {
      bankCode: '088',
      accountNumber: ACCOUNT_NUMBER,
      holderName: '김구직',
    });

    await service.register(userId, {
      bankCode: '004',
      accountNumber: '98765432109',
      holderName: '김구직',
    });

    expect(await prisma.exchangeAccount.count({ where: { userId } })).toBe(1);
    expect(await service.revealForPayout(userId)).toBe('98765432109');
  });

  it('should store nothing when the format is wrong', async () => {
    const userId = await seedMember();

    await expect(
      service.register(userId, {
        bankCode: '088',
        accountNumber: '1',
        holderName: '김구직',
      }),
    ).rejects.toThrow();

    expect(await prisma.exchangeAccount.count()).toBe(0);
  });

  it('should not let two members share one row', async () => {
    const first = await seedMember('a@example.com');
    const second = await seedMember('b@example.com');

    await service.register(first, {
      bankCode: '088',
      accountNumber: ACCOUNT_NUMBER,
      holderName: '김구직',
    });
    await service.register(second, {
      bankCode: '004',
      accountNumber: '98765432109',
      holderName: '이구인',
    });

    expect(await prisma.exchangeAccount.count()).toBe(2);
    expect(await service.revealForPayout(first)).toBe(ACCOUNT_NUMBER);
  });
});
