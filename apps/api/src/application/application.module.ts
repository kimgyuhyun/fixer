import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { NotificationService } from '../notification/notification.service';
import { PenaltyModule } from '../penalty/penalty.module';
import { PrismaSuspensionReader } from '../penalty/suspension.reader';
import { PrismaModule } from '../prisma/prisma.module';
import { ApplicationController } from './application.controller';
import { ApplicationService } from './application.service';
import {
  PrismaApplicantProfileReader,
  PrismaApplicationStore,
  PrismaJobPostReader,
} from './prisma-application.store';

/** 신청 도메인. 지원과 철회 (#17), 수락과 정원 제어 (#18), 거절 (#19) */
@Module({
  imports: [PrismaModule, NotificationModule, PenaltyModule],
  controllers: [ApplicationController],
  providers: [
    PrismaApplicationStore,
    PrismaJobPostReader,
    PrismaApplicantProfileReader,
    {
      provide: ApplicationService,
      useFactory: (
        store: PrismaApplicationStore,
        jobPosts: PrismaJobPostReader,
        profiles: PrismaApplicantProfileReader,
        // 포트로 받는다. 이 서비스는 알림이 인앱인지 메일인지 모른다 (#36).
        notifications: NotificationService,
        // 제재 중이면 지원을 막는다 (#25 AC4)
        suspensions: PrismaSuspensionReader,
      ) =>
        new ApplicationService(
          store,
          jobPosts,
          profiles,
          notifications,
          suspensions,
        ),
      inject: [
        PrismaApplicationStore,
        PrismaJobPostReader,
        PrismaApplicantProfileReader,
        NotificationService,
        PrismaSuspensionReader,
      ],
    },
  ],
  exports: [ApplicationService],
})
export class ApplicationModule {}
