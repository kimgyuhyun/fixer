import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ADVISORY_LOCK_KEYS, UNDERFILL_NOTICE_LEAD_MS } from '@fixer/shared';
import { JobPostScheduleService } from './job-post-schedule.service';

/**
 * 공고 스케줄 잡. 1분 주기. (`spec-fixed.md` §8.1)
 *
 * 이 클래스는 **언제 도는지만** 안다. 무엇을 하는지는
 * `JobPostScheduleService`가 정한다 — 그래야 테스트가 1분도, 3시간도
 * 기다리지 않고 서비스를 직접 부를 수 있다. (#39의 `PurgeJob`과 같은 모양)
 */
@Injectable()
export class JobPostScheduleJob {
  private readonly logger = new Logger(JobPostScheduleJob.name);

  constructor(private readonly schedule: JobPostScheduleService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async notifyUnderfilled(): Promise<void> {
    const report = await this.schedule.notifyUnderfilled(
      new Date(),
      UNDERFILL_NOTICE_LEAD_MS,
      ADVISORY_LOCK_KEYS.NOTIFY_UNDERFILLED_JOB_POST,
    );

    if (report.skippedByLock || report.notifiedJobPostIds.length === 0) return;

    this.logger.log(
      `모집 미달 알림: 공고 ${report.notifiedJobPostIds.length}건`,
    );
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async closeStarted(): Promise<void> {
    const report = await this.schedule.closeStarted(
      new Date(),
      ADVISORY_LOCK_KEYS.CLOSE_STARTED_JOB_POST,
    );

    const changed =
      report.closedJobPostIds.length + report.expiredJobPostIds.length;
    if (report.skippedByLock || changed === 0) return;

    this.logger.log(
      `공고 자동 마감: 마감 ${report.closedJobPostIds.length}건, 미달 만료 ${report.expiredJobPostIds.length}건`,
    );
  }
}
