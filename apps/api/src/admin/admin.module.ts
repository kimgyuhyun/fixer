import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobPostModule } from '../job-post/job-post.module';
import { NotificationModule } from '../notification/notification.module';
import { NotificationService } from '../notification/notification.service';
import { PrismaModule } from '../prisma/prisma.module';
import {
  PrismaAcceptedCounter,
  PrismaJobPostStore,
} from '../job-post/prisma-job-post.store';
import { AdminJobPostController } from './admin-job-post.controller';
import { AdminJobPostService } from './admin-job-post.service';
import { AdminSuspensionController } from './admin-suspension.controller';
import { AdminSuspensionService } from './admin-suspension.service';
import { AdminGuard, ROLE_READER } from './admin.guard';
import {
  PrismaAdminJobPostStore,
  PrismaAdminSuspensionStore,
  PrismaRoleReader,
} from './prisma-admin.store';

/**
 * 관리자 도메인. (이슈 #35)
 *
 * `AdminGuard`를 여기서 한 번 배선하고 #32·#33·#34가 그대로 쓴다.
 */
@Module({
  imports: [PrismaModule, AuthModule, JobPostModule, NotificationModule],
  controllers: [AdminJobPostController, AdminSuspensionController],
  providers: [
    PrismaRoleReader,
    PrismaAdminJobPostStore,
    PrismaAdminSuspensionStore,
    AdminGuard,
    { provide: ROLE_READER, useExisting: PrismaRoleReader },
    {
      provide: AdminJobPostService,
      useFactory: (
        admins: PrismaAdminJobPostStore,
        posts: PrismaJobPostStore,
        accepted: PrismaAcceptedCounter,
      ) => new AdminJobPostService(admins, posts, accepted),
      inject: [
        PrismaAdminJobPostStore,
        PrismaJobPostStore,
        PrismaAcceptedCounter,
      ],
    },
    {
      provide: AdminSuspensionService,
      useFactory: (
        store: PrismaAdminSuspensionStore,
        // 포트로 받는다. 이 서비스는 알림이 인앱인지 메일인지 모른다 (ADR-NOT-1).
        notifications: NotificationService,
      ) => new AdminSuspensionService(store, notifications),
      inject: [PrismaAdminSuspensionStore, NotificationService],
    },
  ],
})
export class AdminModule {}
