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

  findRecipientEmail(_userId: string): Promise<string | null> {
    throw new Error('not implemented');
  }

  recordDelivery(_entry: MailDeliveryEntry): Promise<void> {
    throw new Error('not implemented');
  }
}
