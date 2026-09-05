import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobPostModule } from '../job-post/job-post.module';
import { PrismaModule } from '../prisma/prisma.module';
import {
  PrismaAcceptedCounter,
  PrismaJobPostStore,
} from '../job-post/prisma-job-post.store';
import { AdminJobPostController } from './admin-job-post.controller';
import { AdminJobPostService } from './admin-job-post.service';
import { AdminGuard, ROLE_READER } from './admin.guard';
import {
  PrismaAdminJobPostStore,
  PrismaRoleReader,
} from './prisma-admin.store';

/**
 * 관리자 도메인. (이슈 #35)
 *
 * `AdminGuard`를 여기서 한 번 배선하고 #32·#33·#34가 그대로 쓴다.
 */
@Module({
  imports: [PrismaModule, AuthModule, JobPostModule],
  controllers: [AdminJobPostController],
  providers: [
    PrismaRoleReader,
    PrismaAdminJobPostStore,
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
  ],
})
export class AdminModule {}
