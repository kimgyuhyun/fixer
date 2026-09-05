import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ApplicationController } from './application.controller';
import { ApplicationService } from './application.service';
import {
  PrismaApplicantProfileReader,
  PrismaApplicationStore,
  PrismaJobPostReader,
} from './prisma-application.store';

/** 신청 도메인. 지원과 철회 (#17), 수락과 정원 제어 (#18) */
@Module({
  imports: [PrismaModule],
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
      ) => new ApplicationService(store, jobPosts, profiles),
      inject: [
        PrismaApplicationStore,
        PrismaJobPostReader,
        PrismaApplicantProfileReader,
      ],
    },
  ],
  exports: [ApplicationService],
})
export class ApplicationModule {}
