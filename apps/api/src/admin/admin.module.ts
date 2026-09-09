import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { ExchangeAccountService } from '../exchange/exchange-account.service';
import { JobPostModule } from '../job-post/job-post.module';
import { NotificationModule } from '../notification/notification.module';
import { NotificationService } from '../notification/notification.service';
import { PrismaModule } from '../prisma/prisma.module';
import {
  PrismaAcceptedCounter,
  PrismaJobPostStore,
} from '../job-post/prisma-job-post.store';
import { AdminExchangeController } from './admin-exchange.controller';
import { AdminExchangeService } from './admin-exchange.service';
import { AdminJobPostController } from './admin-job-post.controller';
import { AdminJobPostService } from './admin-job-post.service';
import { AdminMemberController } from './admin-member.controller';
import { AdminMemberService } from './admin-member.service';
import { PrismaAdminMemberStore } from './prisma-admin-member.store';
import { AdminSuspensionController } from './admin-suspension.controller';
import { AdminSuspensionService } from './admin-suspension.service';
import { AdminGuard, ROLE_READER } from './admin.guard';
import { PrismaAdminExchangeStore } from './prisma-admin-exchange.store';
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
  imports: [
    PrismaModule,
    AuthModule,
    JobPostModule,
    ExchangeModule,
    NotificationModule,
  ],
  controllers: [
    AdminJobPostController,
    AdminExchangeController,
    AdminSuspensionController,
    AdminMemberController,
  ],
  providers: [
    PrismaRoleReader,
    PrismaAdminJobPostStore,
    PrismaAdminExchangeStore,
    PrismaAdminSuspensionStore,
    PrismaAdminMemberStore,
    AdminGuard,
    { provide: ROLE_READER, useExisting: PrismaRoleReader },
    {
      // 계좌 복호화는 #30이 만든 것을 그대로 쓴다 (`ADR-PAY-6`). 관리자가
      // 두 번째 복호화 경로를 갖게 되면 키 관리가 두 곳으로 갈린다.
      provide: AdminExchangeService,
      useFactory: (
        store: PrismaAdminExchangeStore,
        accounts: ExchangeAccountService,
        notifications: NotificationService,
      ) => new AdminExchangeService(store, accounts, notifications),
      inject: [
        PrismaAdminExchangeStore,
        ExchangeAccountService,
        NotificationService,
      ],
    },
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
    {
      // 읽기 전용이라 알림도 감사 로그도 물리지 않는다 (#32).
      provide: AdminMemberService,
      useFactory: (store: PrismaAdminMemberStore) =>
        new AdminMemberService(store),
      inject: [PrismaAdminMemberStore],
    },
  ],
})
export class AdminModule {}
