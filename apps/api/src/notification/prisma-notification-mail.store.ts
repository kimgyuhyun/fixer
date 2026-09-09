import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  MailDeliveryEntry,
  NotificationMailStore,
} from './notification.service';

/** 알림 메일의 주소 조회와 발송 이력 저장소. (이슈 #37) */
@Injectable()
export class PrismaNotificationMailStore implements NotificationMailStore {
  constructor(private readonly prisma: PrismaService) {}

  async findRecipientEmail(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      // 주소 하나만 꺼낸다. 회원 전체를 읽으면 해시와 잔액까지 딸려 온다.
      select: { email: true },
    });
    return user?.email ?? null;
  }

  async recordDelivery(entry: MailDeliveryEntry): Promise<void> {
    await this.prisma.mailDelivery.create({ data: entry });
  }
}
