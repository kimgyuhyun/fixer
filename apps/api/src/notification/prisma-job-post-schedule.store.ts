import { Injectable } from '@nestjs/common';
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

  findUnderfilled(_after: Date, _until: Date): Promise<UnderfilledJobPost[]> {
    throw new Error('not implemented');
  }

  markNotified(_jobPostId: string, _notifiedAt: Date): Promise<boolean> {
    throw new Error('not implemented');
  }

  findStarted(_now: Date): Promise<StartedJobPost[]> {
    throw new Error('not implemented');
  }

  close(_jobPostId: string, _to: 'CLOSED' | 'EXPIRED'): Promise<boolean> {
    throw new Error('not implemented');
  }
}
