import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ApplicationStatus } from '@fixer/shared';
import type {
  ApplicantProfile,
  ApplicantProfileReader,
  ApplicationRecord,
  ApplicationStore,
  JobPostForApplication,
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

  /**
   * 수락. **두 조건부 UPDATE가 함께 되거나 함께 안 된다** (`ADR-APP-1`).
   *
   * 나뉘면 신청은 `ACCEPTED`인데 카운터는 그대로거나, 그 반대가 된다. 앞은
   * 정원보다 많은 사람이 확정되고, 뒤는 아무도 안 쓴 자리로 정원이 채워진다.
   * 둘 다 잠긴 포인트와 지급할 돈이 어긋나는 사고다 (§4.4).
   */
  async accept(input: {
    applicationId: string;
    jobPostId: string;
    acceptedAt: Date;
  }): Promise<ApplicationRecord | 'STALE' | 'FULL'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // **신청 갱신이 먼저다.** 카운터를 먼저 올리면 중복 수락이 "정원이
        // 찼다"로 보고된다 — 실제 이유는 그게 아닌데.
        const moved = await tx.application.updateMany({
          where: { id: input.applicationId, status: 'APPLIED' },
          data: { status: 'ACCEPTED', acceptedAt: input.acceptedAt },
        });
        if (moved.count === 0) throw new StaleStatus();

        // 한 문장이 원자적이라 별도 락이 필요 없다. 두 요청이 동시에 와도
        // Postgres가 행 잠금을 잡은 뒤 조건을 **다시** 평가한다.
        const seat = await tx.jobPost.updateMany({
          where: {
            id: input.jobPostId,
            acceptedCount: { lt: this.prisma.jobPost.fields.headcount },
          },
          data: { acceptedCount: { increment: 1 } },
        });
        if (seat.count === 0) throw new HeadcountFull();

        const row = await tx.application.findUniqueOrThrow({
          where: { id: input.applicationId },
        });
        return toRecord(row);
      });
    } catch (error) {
      // 신호를 밖으로 흘리지 않는다. 트랜잭션은 이미 통째로 되돌아갔다.
      if (error instanceof StaleStatus) return 'STALE';
      if (error instanceof HeadcountFull) return 'FULL';
      throw error;
    }
  }

  async listByJobPost(
    jobPostId: string,
    statuses: readonly ApplicationStatus[],
  ): Promise<ApplicationRecord[]> {
    const rows = await this.prisma.application.findMany({
      where: { jobPostId, status: { in: [...statuses] } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toRecord);
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

  async findForApplication(
    jobPostId: string,
  ): Promise<JobPostForApplication | null> {
    return this.prisma.jobPost.findFirst({
      where: { id: jobPostId, deletedAt: null },
      select: {
        id: true,
        employerId: true,
        status: true,
        version: true,
        headcount: true,
        acceptedCount: true,
      },
    });
  }
}

/**
 * 지원자의 이름과 평점. (#18)
 *
 * 이름은 진짜로 읽고, **평점은 표본 0으로 돌려준다** — `Rating`(#26)이 아직
 * 없기 때문이다. #26이 이 어댑터만 채우면 화면은 그대로 동작한다.
 */
@Injectable()
export class PrismaApplicantProfileReader implements ApplicantProfileReader {
  constructor(private readonly prisma: PrismaService) {}

  async profilesOf(
    applicantIds: readonly string[],
  ): Promise<Map<string, ApplicantProfile>> {
    const rows = await this.prisma.user.findMany({
      where: { id: { in: [...applicantIds] } },
      select: { id: true, name: true },
    });

    return new Map(
      rows.map((row) => [
        row.id,
        // 평점은 #26이 채운다. 표본 0이므로 화면은 전원 "신규"로 그린다 (§7).
        { name: row.name, ratingAsWorker: null, ratingCount: 0 },
      ]),
    );
  }
}

/** 신청이 `APPLIED`가 아니었다. 트랜잭션을 되돌리기 위한 내부 신호 */
class StaleStatus extends Error {}

/** 정원이 찼다. 신청 갱신까지 함께 되돌린다 */
class HeadcountFull extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === UNIQUE_VIOLATION;
}

function toRecord(row: {
  id: string;
  jobPostId: string;
  applicantId: string;
  status: ApplicationStatus;
  appliedVersion: number;
  acceptedAt: Date | null;
  createdAt: Date;
}): ApplicationRecord {
  return {
    id: row.id,
    jobPostId: row.jobPostId,
    applicantId: row.applicantId,
    status: row.status,
    appliedVersion: row.appliedVersion,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
  };
}
