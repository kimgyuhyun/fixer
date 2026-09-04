import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { PostgresJobLock, PrismaPurgeStore } from './prisma-purge.store';
import { PurgeService, type PurgeFileRemover } from './purge.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * **이 이슈에는 화면이 없다. 이 파일이 데모다.** (이슈 #39)
 *
 * 가짜 저장소로는 증명할 수 없는 것이 두 가지다.
 *
 * 1. **행을 지우지 않고 컬럼만 바꾼다** — FK가 걸린 원장·동의서가 실제로
 *    살아남는지는 진짜 Postgres에서만 드러난다.
 * 2. **advisory lock이 진짜 분산락인지** — 두 번째 연결이 정말 못 잡는지.
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let store: PrismaPurgeStore;
let lock: PostgresJobLock;

const FOUR_MONTHS = 120 * 24 * 60 * 60 * 1000;
const ONE_MINUTE = 60 * 1000;
const LOCK_KEY = 3939;

/** 지운 파일을 기록만 하는 가짜. 파일 시스템은 이 테스트의 관심사가 아니다 */
class RecordingFiles implements PurgeFileRemover {
  readonly deleted: string[] = [];
  delete(filePath: string): Promise<void> {
    this.deleted.push(filePath);
    return Promise.resolve();
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  store = new PrismaPurgeStore(prisma as unknown as PrismaService);
  lock = new PostgresJobLock(prisma as unknown as PrismaService);
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  await prisma.agreement.deleteMany();
  await prisma.agreementTemplate.deleteMany();
  await prisma.pointTransaction.deleteMany();
  await prisma.userAddress.deleteMany();
  await prisma.user.deleteMany();
});

/** 탈퇴한 지 오래된 회원 하나를, 파기하면 안 되는 기록까지 붙여서 만든다 */
async function seedWithdrawnMember(deactivatedAt: Date): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: 'gone@example.com',
      passwordHash: 'hash',
      name: '김구직',
      deactivatedAt,
    },
  });

  await prisma.userAddress.create({
    data: {
      userId: user.id,
      label: '기본',
      postalCode: '06236',
      roadAddress: '서울 강남구 테헤란로 1',
      jibunAddress: '서울 강남구 역삼동 1',
      sido: '서울',
      sigungu: '강남구',
    },
  });

  // 5년 보관 대상. 파기해도 남아야 한다.
  await prisma.pointTransaction.create({
    data: {
      userId: user.id,
      type: 'CHARGE',
      amount: 10_000,
      idempotencyKey: `charge-${user.id}`,
    },
  });

  await prisma.agreementTemplate.create({
    data: {
      version: 1,
      fileKey: 'templates/v1.pdf',
      sha256: 'template-sha',
      signatureBox: { x: 1, y: 2, width: 3, height: 4 },
      isActive: true,
    },
  });

  await prisma.agreement.create({
    data: {
      userId: user.id,
      templateVersion: 1,
      filePath: 'agreements/gone.pdf',
      sha256: 'agreement-sha',
      ip: '127.0.0.1',
      userAgent: 'vitest',
    },
  });

  return user.id;
}

function serviceWith(files: PurgeFileRemover): PurgeService {
  return new PurgeService(store, files, lock);
}

describe('파기 배치 — 진짜 Postgres에서', () => {
  it('should mask the member without deleting the row or its records', async () => {
    const now = new Date();
    const userId = await seedWithdrawnMember(
      new Date(now.getTime() - FOUR_MONTHS - 1000),
    );
    const files = new RecordingFiles();

    const report = await serviceWith(files).purge(now, FOUR_MONTHS, LOCK_KEY);

    expect(report.purgedUserIds).toEqual([userId]);

    const purged = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(purged.name).toBe('탈퇴회원');
    expect(purged.email).toBe(`deleted_${userId}@invalid`);
    expect(purged.purgedAt).not.toBeNull();

    // 5년 보관 대상은 그대로다. 행을 지웠다면 FK가 끊겨 여기서 0이 된다.
    expect(await prisma.pointTransaction.count({ where: { userId } })).toBe(1);

    // 동의서 행은 남고 해시도 남는다. 파일만 지워진다 (§9).
    const agreement = await prisma.agreement.findFirstOrThrow({
      where: { userId },
    });
    expect(agreement.sha256).toBe('agreement-sha');
    expect(files.deleted).toEqual(['agreements/gone.pdf']);
  });

  it('should delete every address row of the purged member', async () => {
    const now = new Date();
    const userId = await seedWithdrawnMember(
      new Date(now.getTime() - FOUR_MONTHS - 1000),
    );

    await serviceWith(new RecordingFiles()).purge(now, FOUR_MONTHS, LOCK_KEY);

    expect(await prisma.userAddress.count({ where: { userId } })).toBe(0);
  });

  it('should let the purged email be used for a brand new signup', async () => {
    // 원래 주소가 비워지므로 유니크 제약에 걸리지 않는다 (AC4).
    const now = new Date();
    await seedWithdrawnMember(new Date(now.getTime() - FOUR_MONTHS - 1000));

    await serviceWith(new RecordingFiles()).purge(now, FOUR_MONTHS, LOCK_KEY);

    const fresh = await prisma.user.create({
      data: {
        email: 'gone@example.com',
        passwordHash: 'hash',
        name: '새로가입한사람',
      },
    });

    expect(fresh.deactivatedAt).toBeNull();
    expect(await prisma.user.count()).toBe(2);
  });

  it('should purge after one minute when the retention period is one minute', async () => {
    // 4개월을 기다릴 수 없으므로 상수를 주입한다 (AC5).
    const now = new Date();
    const userId = await seedWithdrawnMember(
      new Date(now.getTime() - ONE_MINUTE - 1000),
    );

    const report = await serviceWith(new RecordingFiles()).purge(
      now,
      ONE_MINUTE,
      LOCK_KEY,
    );

    expect(report.purgedUserIds).toEqual([userId]);
  });

  it('should leave a member deactivated for only one month untouched', async () => {
    const now = new Date();
    const userId = await seedWithdrawnMember(
      new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    );

    const report = await serviceWith(new RecordingFiles()).purge(
      now,
      FOUR_MONTHS,
      LOCK_KEY,
    );

    expect(report.purgedUserIds).toHaveLength(0);
    const untouched = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(untouched.name).toBe('김구직');
    expect(untouched.email).toBe('gone@example.com');
  });

  it('should purge nothing on a second run', async () => {
    const now = new Date();
    await seedWithdrawnMember(new Date(now.getTime() - FOUR_MONTHS - 1000));
    const files = new RecordingFiles();
    await serviceWith(files).purge(now, FOUR_MONTHS, LOCK_KEY);

    const second = await serviceWith(files).purge(now, FOUR_MONTHS, LOCK_KEY);

    expect(second.purgedUserIds).toHaveLength(0);
    // 파일을 두 번 지우려 들지도 않는다.
    expect(files.deleted).toHaveLength(1);
  });
});

describe('advisory lock — 진짜 분산락인가', () => {
  it('should refuse a second holder while the first holds the lock', async () => {
    // 다른 연결에서 잡아야 진짜 검증이다. 같은 세션은 재진입이 허용된다.
    const other = new PrismaClient({
      adapter: new PrismaPg({ connectionString: container.getConnectionUri() }),
    });
    const otherLock = new PostgresJobLock(other as unknown as PrismaService);

    try {
      expect(await lock.tryLock(LOCK_KEY)).toBe(true);
      expect(await otherLock.tryLock(LOCK_KEY)).toBe(false);

      await lock.unlock(LOCK_KEY);
      expect(await otherLock.tryLock(LOCK_KEY)).toBe(true);
      await otherLock.unlock(LOCK_KEY);
    } finally {
      await other.$disconnect();
    }
  });

  it('should skip the run without touching anything when the lock is held elsewhere', async () => {
    const other = new PrismaClient({
      adapter: new PrismaPg({ connectionString: container.getConnectionUri() }),
    });
    const otherLock = new PostgresJobLock(other as unknown as PrismaService);
    const now = new Date();
    const userId = await seedWithdrawnMember(
      new Date(now.getTime() - FOUR_MONTHS - 1000),
    );

    try {
      await otherLock.tryLock(LOCK_KEY);

      const report = await serviceWith(new RecordingFiles()).purge(
        now,
        FOUR_MONTHS,
        LOCK_KEY,
      );

      expect(report.skippedByLock).toBe(true);
      const untouched = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(untouched.purgedAt).toBeNull();
    } finally {
      await otherLock.unlock(LOCK_KEY);
      await other.$disconnect();
    }
  });
});
