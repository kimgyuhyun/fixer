import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ApplicationController } from './application.controller';
import { ApplicationService } from './application.service';
import {
  PrismaApplicationStore,
  PrismaJobPostReader,
} from './prisma-application.store';

/** 신청 도메인. 지원과 철회 (#17) */
@Module({
  imports: [PrismaModule],
  controllers: [ApplicationController],
  providers: [
    PrismaApplicationStore,
    PrismaJobPostReader,
    {
      provide: ApplicationService,
      useFactory: (
        store: PrismaApplicationStore,
        jobPosts: PrismaJobPostReader,
      ) => new ApplicationService(store, jobPosts),
      inject: [PrismaApplicationStore, PrismaJobPostReader],
    },
  ],
  exports: [ApplicationService],
})
export class ApplicationModule {}
