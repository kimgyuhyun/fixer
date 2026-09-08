import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PostgresJobLock } from '../retention/prisma-purge.store';
import { JobPostScheduleJob } from './job-post-schedule.job';
import { JobPostScheduleService } from './job-post-schedule.service';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { PrismaJobPostScheduleStore } from './prisma-job-post-schedule.store';
import { PrismaNotificationStore } from './prisma-notification.store';

/**
 * 알림 도메인. (이슈 #36)
 *
 * `NotificationService`를 export하는 것이 이 모듈의 본체다 — 다른 도메인은
 * `NotificationPublisher` 타입으로만 이걸 받는다 (ADR-NOT-1).
 * 스케줄 잡(#38)이 여기 붙었고, 이메일 병행(#37)이 나중에 붙는다.
 *
 * 잡이 이 모듈에 사는 이유는 **알림을 발행하는 쪽이기 때문이다.** 공고를
 * 읽고 쓰지만 공고 도메인의 규칙(등록·수정·취소)은 하나도 모른다.
 */
@Module({
  imports: [PrismaModule, AuthModule, ScheduleModule.forRoot()],
  controllers: [NotificationController],
  providers: [
    PrismaNotificationStore,
    PrismaJobPostScheduleStore,
    // advisory lock은 #39가 만든 것을 그대로 쓴다. 두 번 구현하면 락 키
    // 관리가 두 곳으로 갈린다.
    PostgresJobLock,
    {
      provide: NotificationService,
      useFactory: (store: PrismaNotificationStore) =>
        new NotificationService(store),
      inject: [PrismaNotificationStore],
    },
    {
      provide: JobPostScheduleService,
      useFactory: (
        store: PrismaJobPostScheduleStore,
        // 포트로 받는다. 잡은 알림이 인앱인지 메일인지 모른다 (ADR-NOT-1).
        notifications: NotificationService,
        lock: PostgresJobLock,
      ) => new JobPostScheduleService(store, notifications, lock),
      inject: [
        PrismaJobPostScheduleStore,
        NotificationService,
        PostgresJobLock,
      ],
    },
    JobPostScheduleJob,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
