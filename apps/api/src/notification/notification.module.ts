import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { PrismaNotificationStore } from './prisma-notification.store';

/**
 * 알림 도메인. (이슈 #36)
 *
 * `NotificationService`를 export하는 것이 이 모듈의 본체다 — 다른 도메인은
 * `NotificationPublisher` 타입으로만 이걸 받는다 (ADR-NOT-1).
 * 이메일 병행(#37)과 스케줄 잡(#38)이 나중에 여기 붙는다.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [NotificationController],
  providers: [
    PrismaNotificationStore,
    {
      provide: NotificationService,
      useFactory: (store: PrismaNotificationStore) =>
        new NotificationService(store),
      inject: [PrismaNotificationStore],
    },
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
