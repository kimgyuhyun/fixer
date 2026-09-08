import { Injectable } from '@nestjs/common';
import { type RatingRole, type RatingSummary } from '@fixer/shared';
import { PrismaService } from '../prisma/prisma.service';
import type {
  RatableApplication,
  RatingRecord,
  RatingStore,
} from './rating.service';

/** Prisma가 유니크 제약 위반에 쓰는 코드 */
const UNIQUE_VIOLATION = 'P2002';

/** `RatingRecord`가 필요로 하는 칸 */
const RATING_FIELDS = {
  id: true,
  applicationId: true,
  raterId: true,
  rateeId: true,
  rateeRole: true,
  score: true,
} as const;

/**
 * 별점 저장소. (이슈 #26)
 *
 * **삽입과 캐시 재집계가 한 트랜잭션이다** (`ADR-PEN-3`). 나뉘면 `Rating`
 * 행은 커밋됐는데 `User`의 평균이 옛 값인 상태가 남고, 그걸 고쳐 줄 배치가
 * 없다 (§8.1). #25가 경고와 제재를 한 트랜잭션에 둔 이유와 같다.
 */
@Injectable()
export class PrismaRatingStore implements RatingStore {
  constructor(private readonly prisma: PrismaService) {}

  async findApplication(
    applicationId: string,
  ): Promise<RatableApplication | null> {
    const row = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        status: true,
        applicantId: true,
        // 구인자는 공고가 갖고 있다. 신청 행에 복사해 두지 않는다
        jobPost: { select: { employerId: true } },
      },
    });
    if (row === null) return null;

    return {
      id: row.id,
      status: row.status,
      applicantId: row.applicantId,
      employerId: row.jobPost.employerId,
    };
  }

  async create(input: {
    applicationId: string;
    raterId: string;
    rateeId: string;
    rateeRole: RatingRole;
    score: number;
  }): Promise<RatingRecord | 'DUPLICATE'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.rating.create({
          data: input,
          select: RATING_FIELDS,
        });

        // 증분이 아니라 재집계다. 캐시가 한 번 틀어져도 다음 별점에서 맞는
        // 값으로 돌아온다 — 진실은 `Rating` 표다 (`ADR-PAY-1`과 같은 판단).
        const stats = await tx.rating.aggregate({
          where: { rateeId: input.rateeId, rateeRole: input.rateeRole },
          _avg: { score: true },
          _count: { score: true },
        });
        await tx.user.update({
          where: { id: input.rateeId },
          data: cacheOf(input.rateeRole, stats._avg.score, stats._count.score),
        });

        return row;
      });
    } catch (error) {
      // 거래당 1회를 실제로 지키는 것은 이 제약이다 (§7)
      if (isUniqueViolation(error)) return 'DUPLICATE';
      throw error;
    }
  }

  async summaryOf(userId: string): Promise<RatingSummary | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        ratingAsPoster: true,
        ratingAsPosterCount: true,
        ratingAsWorker: true,
        ratingAsWorkerCount: true,
      },
    });
    if (row === null) return null;

    return {
      userId: row.id,
      asPoster: { average: row.ratingAsPoster, count: row.ratingAsPosterCount },
      asWorker: { average: row.ratingAsWorker, count: row.ratingAsWorkerCount },
    };
  }
}

/** 역할에 맞는 캐시 칸 두 개. 반대쪽 역할은 건드리지 않는다 (§2.1) */
function cacheOf(role: RatingRole, average: number | null, count: number) {
  return role === 'POSTER'
    ? { ratingAsPoster: average, ratingAsPosterCount: count }
    : { ratingAsWorker: average, ratingAsWorkerCount: count };
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === UNIQUE_VIOLATION;
}
