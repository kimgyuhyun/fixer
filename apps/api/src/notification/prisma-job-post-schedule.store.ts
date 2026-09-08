import { Injectable } from '@nestjs/common';
import { transition } from '../job-post/job-post.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  JobPostScheduleStore,
  StartedJobPost,
  UnderfilledJobPost,
} from './job-post-schedule.service';

/** 공고 스케줄 잡의 저장소. (이슈 #38) */
@Injectable()
export class PrismaJobPostScheduleStore implements JobPostScheduleStore {
  constructor(private readonly prisma: PrismaService) {}

  findUnderfilled(after: Date, until: Date): Promise<UnderfilledJobPost[]> {
    return this.prisma.jobPost.findMany({
      where: {
        status: 'OPEN',
        deletedAt: null,
        // 이 조건이 중복 발송을 막는 1차 방어다 (`spec-fixed.md` §8.2)
        underfilledNotifiedAt: null,
        // 시작 시각을 지난 것은 마감 잡의 몫이라 창을 양쪽으로 닫는다
        workStartAt: { gt: after, lte: until },
        // 확정 인원 < 정원. **행을 세지 않고 컬럼을 본다** (`ADR-APP-1`)
        acceptedCount: { lt: this.prisma.jobPost.fields.headcount },
      },
      select: {
        id: true,
        employerId: true,
        title: true,
        headcount: true,
        acceptedCount: true,
        workStartAt: true,
      },
    });
  }

  /**
   * `IS NULL`을 조건절에 건 조건부 UPDATE 한 문장이다. 두 실행이 같은 행을
   * 놓고 다투면 **한쪽만 1건을 받는다** — 그쪽만 알림을 발행한다.
   */
  async markNotified(jobPostId: string, notifiedAt: Date): Promise<boolean> {
    const affected = await this.prisma.jobPost.updateMany({
      where: { id: jobPostId, underfilledNotifiedAt: null },
      data: { underfilledNotifiedAt: notifiedAt },
    });
    return affected.count === 1;
  }

  findStarted(now: Date): Promise<StartedJobPost[]> {
    return this.prisma.jobPost.findMany({
      where: { status: 'OPEN', deletedAt: null, workStartAt: { lte: now } },
      select: { id: true, headcount: true, acceptedCount: true },
    });
  }

  /**
   * **상태를 `WHERE`에 건다.** 목록을 읽은 뒤 구인자가 취소했으면 0건이 되어
   * 아무것도 안 바뀐다. 전이 자체가 표에 있는지는 `transition`이 본다
   * (`ADR-JOB-3`).
   */
  async close(jobPostId: string, to: 'CLOSED' | 'EXPIRED'): Promise<boolean> {
    const affected = await this.prisma.jobPost.updateMany({
      where: { id: jobPostId, status: 'OPEN' },
      data: { status: transition('OPEN', to) },
    });
    return affected.count === 1;
  }
}
