import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AgreementModule } from '../agreement/agreement.module';
import { LocalFileStore } from '../agreement/local-file.store';
import { PrismaModule } from '../prisma/prisma.module';
import { PostgresJobLock, PrismaPurgeStore } from './prisma-purge.store';
import { PurgeJob } from './purge.job';
import { PurgeService } from './purge.service';

/**
 * 개인정보 파기. (이슈 #39)
 *
 * 파일 삭제는 동의서(#7)가 이미 만든 `LocalFileStore`를 그대로 쓴다. 파기가
 * 자기 파일 접근 코드를 따로 가지면 저장 위치가 두 곳에 적히게 되고,
 * S3로 옮길 때 한쪽만 고쳐 파일이 남는다.
 */
@Module({
  imports: [PrismaModule, ScheduleModule.forRoot(), AgreementModule],
  providers: [
    PrismaPurgeStore,
    PostgresJobLock,
    {
      provide: PurgeService,
      useFactory: (
        store: PrismaPurgeStore,
        files: LocalFileStore,
        lock: PostgresJobLock,
      ) => new PurgeService(store, files, lock),
      inject: [PrismaPurgeStore, LocalFileStore, PostgresJobLock],
    },
    PurgeJob,
  ],
  exports: [PurgeService],
})
export class RetentionModule {}
