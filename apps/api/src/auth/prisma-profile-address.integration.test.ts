import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { PrismaProfileAddressReader } from './prisma-user-address.store';

/**
 * **"가장 먼저 등록한 주소"는 진짜 DB의 정렬로만 증명된다.** (이슈 #82)
 *
 * 가짜 저장소는 내가 넣은 순서대로 돌려주므로, \`createdAt\` 정렬이 실제로
 * 걸려 있는지는 실제 테이블을 읽어야 안다.
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let reader: PrismaProfileAddressReader;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  reader = new PrismaProfileAddressReader(prisma as unknown as PrismaService);
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  await prisma.userAddress.deleteMany();
  await prisma.user.deleteMany();
});

async function seedMember(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: 'worker@example.com', passwordHash: 'h', name: '김구직' },
  });
  return user.id;
}

async function seedAddress(
  userId: string,
  fields: { roadAddress: string; jibunAddress: string; createdAt: Date },
): Promise<void> {
  await prisma.userAddress.create({
    data: {
      userId,
      label: '기본',
      postalCode: '06236',
      sido: '서울',
      sigungu: '강남구',
      ...fields,
    },
  });
}

describe('PrismaProfileAddressReader.defaultAddressOf — 진짜 Postgres에서', () => {
  it("should return the road address of the member's address", async () => {
    const userId = await seedMember();
    await seedAddress(userId, {
      roadAddress: '서울 강남구 테헤란로 152',
      jibunAddress: '서울 강남구 역삼동 737',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    await expect(reader.defaultAddressOf(userId)).resolves.toBe(
      '서울 강남구 테헤란로 152',
    );
  });

  it('should return the earliest registered address when the member has two', async () => {
    const userId = await seedMember();
    // 나중 것을 먼저 넣는다. 삽입 순서로 우연히 맞는 일을 막는다.
    await seedAddress(userId, {
      roadAddress: '서울 마포구 월드컵북로 396',
      jibunAddress: '서울 마포구 상암동 1605',
      createdAt: new Date('2026-09-20T00:00:00.000Z'),
    });
    await seedAddress(userId, {
      roadAddress: '서울 강남구 테헤란로 152',
      jibunAddress: '서울 강남구 역삼동 737',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    await expect(reader.defaultAddressOf(userId)).resolves.toBe(
      '서울 강남구 테헤란로 152',
    );
  });

  it('should fall back to the jibun address when the road address is empty', async () => {
    const userId = await seedMember();
    await seedAddress(userId, {
      roadAddress: '',
      jibunAddress: '서울 강남구 역삼동 737',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    await expect(reader.defaultAddressOf(userId)).resolves.toBe(
      '서울 강남구 역삼동 737',
    );
  });

  it('should return null when the member has no address', async () => {
    const userId = await seedMember();

    await expect(reader.defaultAddressOf(userId)).resolves.toBeNull();
  });
});
