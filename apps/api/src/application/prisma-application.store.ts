import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ApplicationStatus, JobPostStatus } from '@fixer/shared';
import type {
  ApplicationRecord,
  ApplicationStore,
  JobPostReader,
} from './application.service';

/** Prisma가 유니크 제약 위반에 쓰는 코드 */
const UNIQUE_VIOLATION = 'P2002';

/**
 * 신청 저장소.
 *
 * **조건부 UPDATE가 이 파일의 요점이다.** 서비스의 조회와 여기의 쓰기는
 * 다른 트랜잭션이라, 그 사이에 다른 경로가 상태를 바꿨을 수 있다.
 * `WHERE`에 기대 상태를 걸어 두면 그 경우 0행이 갱신되어 `'STALE'`이 된다.
 */
@Injectable()
export class PrismaApplicationStore implements ApplicationStore {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    jobPostId: string;
    applicantId: string;
    appliedVersion: number;
  }): Promise<ApplicationRecord | 'DUPLICATE'> {
    try {
      return toRecord(
        await this.prisma.application.create({
          data: {
            jobPostId: input.jobPostId,
            applicantId: input.applicantId,
            status: 'APPLIED',
            appliedVersion: input.appliedVersion,
          },
        }),
      );
    } catch (error) {
      // 같은 사람의 다른 요청이 먼저 넣었다. **경합의 정상적인 결과다** (§4.5).
      if (isUniqueViolation(error)) return 'DUPLICATE';
      throw error;
    }
  }

  async findById(applicationId: string): Promise<ApplicationRecord | null> {
    const row = await this.prisma.application.findUnique({
      where: { id: applicationId },
    });
    return row === null ? null : toRecord(row);
  }

  async findByApplicant(
    jobPostId: string,
    applicantId: string,
  ): Promise<ApplicationRecord | null> {
    const row = await this.prisma.application.findUnique({
      where: { jobPostId_applicantId: { jobPostId, applicantId } },
    });
    return row === null ? null : toRecord(row);
  }

  async updateStatus(input: {
    applicationId: string;
    expectedStatus: ApplicationStatus;
    nextStatus: ApplicationStatus;
  }): Promise<ApplicationRecord | 'STALE'> {
    // **기대 상태를 `WHERE`에 건다.** 그 사이 바뀌었으면 0건이 되어
    // 아무것도 안 바뀐다 — 철회 버튼 연타의 두 번째가 여기서 걸린다.
    const { count } = await this.prisma.application.updateMany({
      where: { id: input.applicationId, status: input.expectedStatus },
      data: { status: input.nextStatus },
    });
    if (count === 0) return 'STALE';

    return this.mustFind(input.applicationId);
  }

  async reapply(input: {
    applicationId: string;
    appliedVersion: number;
  }): Promise<ApplicationRecord | 'STALE'> {
    // **상태와 버전이 한 문장 안에서 함께 바뀐다.** 나누면 되살아났는데
    // 옛 버전이 남아 있는 창이 생기고, 그 사이 조회한 사람은 본 적 없는
    // 조건에 동의한 신청을 보게 된다.
    const { count } = await this.prisma.application.updateMany({
      where: { id: input.applicationId, status: 'WITHDRAWN' },
      data: { status: 'APPLIED', appliedVersion: input.appliedVersion },
    });
    if (count === 0) return 'STALE';

    return this.mustFind(input.applicationId);
  }

  /** 방금 갱신한 행. 조건부 UPDATE가 1건을 셌으므로 반드시 있다 */
  private async mustFind(applicationId: string): Promise<ApplicationRecord> {
    const row = await this.prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
    });
    return toRecord(row);
  }
}

/** 공고에서 상태·버전·주인만 읽는다. 소프트 삭제된 것은 없는 것이다 (#14) */
@Injectable()
export class PrismaJobPostReader implements JobPostReader {
  constructor(private readonly prisma: PrismaService) {}

  async findForApplication(jobPostId: string): Promise<{
    id: string;
    employerId: string;
    status: JobPostStatus;
    version: number;
  } | null> {
    return this.prisma.jobPost.findFirst({
      where: { id: jobPostId, deletedAt: null },
      select: { id: true, employerId: true, status: true, version: true },
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === UNIQUE_VIOLATION;
}

function toRecord(row: {
  id: string;
  jobPostId: string;
  applicantId: string;
  status: ApplicationStatus;
  appliedVersion: number;
  createdAt: Date;
}): ApplicationRecord {
  return {
    id: row.id,
    jobPostId: row.jobPostId,
    applicantId: row.applicantId,
    status: row.status,
    appliedVersion: row.appliedVersion,
    createdAt: row.createdAt,
  };
}
