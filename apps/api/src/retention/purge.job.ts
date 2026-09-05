import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ADVISORY_LOCK_KEYS, RETENTION } from '@fixer/shared';
import { PurgeService } from './purge.service';

/**
 * 개인정보 파기 배치. 일 1회. (`spec-fixed.md` §2.7, §8.2)
 *
 * 이 클래스는 **언제 도는지만** 안다. 무엇을 파기할지는 `PurgeService`가
 * 정한다 — 그래야 테스트가 시간을 기다리지 않고 서비스를 직접 부를 수 있다.
 */
@Injectable()
export class PurgeJob {
  private readonly logger = new Logger(PurgeJob.name);

  constructor(private readonly purge: PurgeService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async run(): Promise<void> {
    const report = await this.purge.purge(
      new Date(),
      RETENTION.PERSONAL_INFO_MS,
      ADVISORY_LOCK_KEYS.PURGE_PERSONAL_INFO,
    );

    if (report.skippedByLock) {
      // 오류가 아니다. 다른 인스턴스가 이미 돌고 있다는 뜻이다.
      this.logger.log('다른 인스턴스가 파기 중이라 건너뛴다');
      return;
    }

    this.logger.log(
      `개인정보 파기: 회원 ${report.purgedUserIds.length}명, 동의서 파일 ${report.deletedAgreementFiles}건`,
    );
  }
}
