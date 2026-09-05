import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { NotificationService } from './notification.service';
import { PrismaNotificationStore } from './prisma-notification.store';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * **"쌓였다"와 "미읽음만 센다"는 진짜 DB에서만 증명된다.** (이슈 #36)
 *
 * 가짜 저장소는 내가 넣은 값을 그대로 돌려주므로, 인덱스와 `readAt IS NULL`
 * 조건이 실제로 무엇을 세는지는 실제 테이블을 읽어야 안다.
 */
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let service: NotificationService;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  service = new NotificationService(
    new PrismaNotificationStore(prisma as unknown as PrismaService),
  );
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  await prisma.notification.deleteMany();
  await prisma.user.deleteMany();
});

async function seedMember(email = 'worker@example.com'): Promise<string> {
  const user = await prisma.user.create({
    data: { email, passwordHash: 'h', name: '김구직' },
  });
  return user.id;
}

describe('인앱 알림 — 진짜 Postgres에서', () => {
  it('should persist a published notification and read it back from the real database', async () => {
    const userId = await seedMember();

    await service.publish({
      userId,
      type: 'ACCOUNT_VERIFIED',
      title: '계좌 검증이 끝났습니다',
      body: '신한은행 ****5678 계좌를 쓸 수 있습니다.',
      linkUrl: '/my/account',
    });

    const list = await service.list(userId);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      type: 'ACCOUNT_VERIFIED',
      title: '계좌 검증이 끝났습니다',
      linkUrl: '/my/account',
      read: false,
    });
    expect(list.unreadCount).toBe(1);
  });

  it("should count only unread rows when some of the user's notifications are already read", async () => {
    const userId = await seedMember();
    for (const title of ['첫째', '둘째', '셋째']) {
      await service.publish({
        userId,
        type: 'ACCOUNT_VERIFIED',
        title,
        body: '본문',
        linkUrl: '/my/account',
      });
    }

    const before = await service.list(userId);
    await service.markRead(userId, before.items[0].id);

    const after = await service.list(userId);
    expect(after.unreadCount).toBe(2);
    expect(after.items).toHaveLength(3);
  });
});
