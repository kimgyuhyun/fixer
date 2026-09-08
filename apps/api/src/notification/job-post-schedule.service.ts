import { Injectable, Logger } from '@nestjs/common';
import type { JobLock } from '../retention/purge.service';
import type { NotificationPublisher } from './notification.service';

/** 미달 알림 대상 공고 하나. 문구를 만드는 데 필요한 것만 담는다 */
export interface UnderfilledJobPost {
  id: string;
  employerId: string;
  title: string;
  headcount: number;
  /** 확정 인원. **`JobPost.acceptedCount` 컬럼이다** (`ADR-APP-1`) */
  acceptedCount: number;
  workStartAt: Date;
}

/** 시작 시각이 지난 `OPEN` 공고 하나. 마감은 인원 수만 보면 된다 */
export interface StartedJobPost {
  id: string;
  headcount: number;
  acceptedCount: number;
}

export interface JobPostScheduleStore {
  /** `OPEN` · 미달 · 아직 안 알림 · `after < workStartAt <= until` */
  findUnderfilled(after: Date, until: Date): Promise<UnderfilledJobPost[]>;
  /**
   * 알림 보냄 표시. **이미 표시돼 있으면 `false`**.
   *
   * 조건부 UPDATE 한 문장이라 두 실행이 엇갈려도 한쪽만 `true`를 받는다
   * (`spec-fixed.md` §8.2 1차 방어).
   */
  markNotified(jobPostId: string, notifiedAt: Date): Promise<boolean>;
  /** 시작 시각이 지난 `OPEN` 공고 */
  findStarted(now: Date): Promise<StartedJobPost[]>;
  /** `OPEN`일 때만 옮긴다. 이미 누가 옮겼으면 `false` */
  close(jobPostId: string, to: 'CLOSED' | 'EXPIRED'): Promise<boolean>;
}

/** 미달 알림 한 번의 결과 */
export interface UnderfillNoticeReport {
  notifiedJobPostIds: string[];
  /** 락을 못 잡아 아무것도 하지 않았다. **오류가 아니다** */
  skippedByLock: boolean;
}

/** 자동 마감 한 번의 결과 */
export interface AutoCloseReport {
  /** 정원이 찬 채로 시작 시각이 지났다 */
  closedJobPostIds: string[];
  /** 미달인 채로 시작 시각이 지났다 */
  expiredJobPostIds: string[];
  skippedByLock: boolean;
}

/**
 * 공고 스케줄 잡. (이슈 #38, `spec-fixed.md` §8.1)
 *
 * 잡 **둘**을 담는다 — 시작 전의 미달 알림과 시작 후의 자동 마감이다.
 * 조건도 대상도 달라 락 키를 따로 쓴다.
 */
@Injectable()
export class JobPostScheduleService {
  private readonly logger = new Logger(JobPostScheduleService.name);

  constructor(
    private readonly store: JobPostScheduleStore,
    private readonly notifications: NotificationPublisher,
    private readonly lock: JobLock,
  ) {}

  /**
   * 모집 미달 알림. `leadMs`는 운영에서 언제나 `UNDERFILL_NOTICE_LEAD_MS`(3시간)이고,
   * 인자로 받는 것은 테스트가 3시간을 기다리지 않게 하기 위해서다.
   */
  async notifyUnderfilled(
    now: Date,
    leadMs: number,
    lockKey: number,
  ): Promise<UnderfillNoticeReport> {
    // 못 잡으면 조용히 돌아선다. 다른 인스턴스가 돌고 있다는 뜻이지 오류가
    // 아니다 — 여기서 던지면 서버가 두 대일 때 1분마다 알람이 울린다.
    if (!(await this.lock.tryLock(lockKey))) {
      return { notifiedJobPostIds: [], skippedByLock: true };
    }

    try {
      // 창을 양쪽으로 닫는다. 시작 시각이 이미 지난 공고까지 집으면 고를
      // 시간이 0초인 선택지를 보내게 된다 — 그건 마감 잡의 몫이다.
      const posts = await this.store.findUnderfilled(
        now,
        new Date(now.getTime() + leadMs),
      );

      const notifiedJobPostIds: string[] = [];
      for (const post of posts) {
        // **표시가 먼저다.** 조건부 UPDATE라 행을 차지한 쪽 하나만 발행한다.
        // 발행 뒤에 표시하면 그 사이에 죽었을 때 다음 분에 또 나간다.
        if (!(await this.store.markNotified(post.id, now))) continue;

        await this.publishUnderfilled(post);
        notifiedJobPostIds.push(post.id);
      }

      // **공고는 건드리지 않는다.** 미응답의 기본값은 유지다
      // (`prd/notification.md` §5). 연장·삭제는 구인자가 #15·#16으로 한다.
      return { notifiedJobPostIds, skippedByLock: false };
    } finally {
      // 던져도 반드시 푼다. 안 그러면 다음 실행이 영원히 막힌다.
      await this.lock.unlock(lockKey);
    }
  }

  /** 공고 자동 마감. 인원이 찼으면 `CLOSED`, 미달이면 `EXPIRED` */
  async closeStarted(now: Date, lockKey: number): Promise<AutoCloseReport> {
    if (!(await this.lock.tryLock(lockKey))) {
      return {
        closedJobPostIds: [],
        expiredJobPostIds: [],
        skippedByLock: true,
      };
    }

    try {
      const posts = await this.store.findStarted(now);

      const closedJobPostIds: string[] = [];
      const expiredJobPostIds: string[] = [];
      for (const post of posts) {
        const to: 'CLOSED' | 'EXPIRED' =
          post.acceptedCount >= post.headcount ? 'CLOSED' : 'EXPIRED';

        // 읽은 뒤 누가 취소했으면 0건이다. 덮어쓰지 않는다.
        if (!(await this.store.close(post.id, to))) continue;

        (to === 'CLOSED' ? closedJobPostIds : expiredJobPostIds).push(post.id);
      }

      return { closedJobPostIds, expiredJobPostIds, skippedByLock: false };
    } finally {
      await this.lock.unlock(lockKey);
    }
  }

  /**
   * 문구는 발행자가 만든다 (`ADR-NOT-3`).
   *
   * **한 건이 터져도 나머지는 보낸다.** 표시가 이미 끝난 뒤라 다음 실행이
   * 다시 집어주지 않는다 — 여기서 멈추면 뒤쪽 구인자들은 영영 못 받는다.
   */
  private async publishUnderfilled(post: UnderfilledJobPost): Promise<void> {
    try {
      await this.notifications.publish({
        userId: post.employerId,
        type: 'JOB_POST_UNDERFILLED',
        title: '모집 인원이 아직 다 차지 않았습니다',
        body: `${post.title} — 시작 3시간 전인데 ${post.acceptedCount}/${post.headcount}명입니다. 연장·삭제·유지 중에서 고르세요. 그대로 두면 유지됩니다.`,
        linkUrl: `/job-posts/${post.id}`,
      });
    } catch (error) {
      // 공고 id만 적는다. 알림 본문에는 개인정보가 담긴다.
      this.logger.error(
        `모집 미달 알림 발행 실패 (jobPostId=${post.id})`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
