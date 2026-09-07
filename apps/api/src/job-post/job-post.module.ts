import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { NotificationService } from '../notification/notification.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';
import { JobPostController } from './job-post.controller';
import { JobPostService } from './job-post.service';
import { PrismaCategoryStore } from './prisma-category.store';
import {
  PrismaAcceptedCounter,
  PrismaBalanceReader,
  PrismaJobPostStore,
  PrismaMemberAddressReader,
} from './prisma-job-post.store';

/** 공고 도메인. 카테고리(#11)와 공고 등록·목록(#12) */
@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [CategoryController, JobPostController],
  providers: [
    PrismaCategoryStore,
    PrismaJobPostStore,
    PrismaMemberAddressReader,
    PrismaBalanceReader,
    PrismaAcceptedCounter,
    {
      provide: CategoryService,
      useFactory: (store: PrismaCategoryStore) => new CategoryService(store),
      inject: [PrismaCategoryStore],
    },
    {
      provide: JobPostService,
      // 예산 잠금은 `PointLedgerService`가 아니라 저장소 트랜잭션이 한다.
      // 공고 저장과 잠금이 **한 트랜잭션**이어야 하기 때문이다 — 서비스를
      // 거치면 두 연결이 되어 둘 중 하나만 성공하는 창이 생긴다.
      useFactory: (
        store: PrismaJobPostStore,
        addresses: PrismaMemberAddressReader,
        balances: PrismaBalanceReader,
        accepted: PrismaAcceptedCounter,
        // 포트로 받는다. 이 서비스는 알림이 인앱인지 메일인지 모른다 (#36).
        notifications: NotificationService,
      ) =>
        new JobPostService(store, addresses, balances, accepted, notifications),
      inject: [
        PrismaJobPostStore,
        PrismaMemberAddressReader,
        PrismaBalanceReader,
        PrismaAcceptedCounter,
        NotificationService,
      ],
    },
  ],
  exports: [CategoryService, JobPostService],
})
export class JobPostModule {}
