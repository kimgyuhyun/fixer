import { Injectable } from '@nestjs/common';
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
  constructor(
    private readonly store: JobPostScheduleStore,
    private readonly notifications: NotificationPublisher,
    private readonly lock: JobLock,
  ) {}

  notifyUnderfilled(
    _now: Date,
    _leadMs: number,
    _lockKey: number,
  ): Promise<UnderfillNoticeReport> {
    throw new Error('not implemented');
  }

  closeStarted(_now: Date, _lockKey: number): Promise<AutoCloseReport> {
    throw new Error('not implemented');
  }
}
