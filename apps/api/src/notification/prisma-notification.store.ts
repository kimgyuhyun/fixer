import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  NotificationRecord,
  NotificationStore,
  PublishNotificationInput,
} from './notification.service';

/** 알림 저장소. (이슈 #36) */
@Injectable()
export class PrismaNotificationStore implements NotificationStore {
  constructor(private readonly prisma: PrismaService) {}

  async insert(input: PublishNotificationInput): Promise<void> {
    await this.prisma.notification.create({ data: input });
  }

  async listRecent(
    userId: string,
    limit: number,
  ): Promise<NotificationRecord[]> {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  /**
   * `userId`를 조건절에 함께 넣는 것이 남의 알림을 막는 곳이다. 서비스에서
   * 한 번 더 거르지 않고 **여기서 0건이 되게** 한다.
   *
   * `readAt: null` 조건 덕분에 두 번째 호출은 대상이 0건이라 첫 읽음 시각이
   * 유지된다. 그래서 갱신 결과가 아니라 행을 다시 읽어 돌려준다.
   */
  async markRead(
    userId: string,
    id: string,
  ): Promise<NotificationRecord | null> {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });

    return this.prisma.notification.findFirst({ where: { id, userId } });
  }
}
