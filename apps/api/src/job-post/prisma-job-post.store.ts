import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  holdKeyFor,
  transition,
  type BalanceReader,
  type JobPostRecord,
  type JobPostStore,
  type MemberAddressReader,
} from './job-post.service';

/** Prisma가 유니크 제약 위반에 쓰는 코드 */
const UNIQUE_VIOLATION = 'P2002';

/**
 * 공고 저장소. **이 파일의 트랜잭션이 이 이슈의 핵심이다.**
 *
 * 공고 저장 · v1 스냅샷 · 예산 잠금 · `OPEN` 전환이 함께 되거나 함께 안 된다.
 * 나뉘면 두 가지 사고가 난다.
 *
 * - 공고만 남으면 → 예산 없는 공고가 목록에 뜬다
 * - `HOLD`만 남으면 → **아무도 풀어줄 수 없는 돈**이 된다
 */
@Injectable()
export class PrismaJobPostStore implements JobPostStore {
  constructor(private readonly prisma: PrismaService) {}

  async createOpenWithHold(input: {
    employerId: string;
    categoryId: string;
    title: string;
    workAddress: string;
    workStartAt: Date;
    workEndAt: Date;
    headcount: number;
    rewardPerPerson: number;
    requiredDescription: string;
    budget: number;
  }): Promise<JobPostRecord | 'INSUFFICIENT'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. DRAFT로 만든다. 아직 돈이 잠기지 않았으므로 모집 중이 아니다.
        const draft = await tx.jobPost.create({
          data: {
            employerId: input.employerId,
            categoryId: input.categoryId,
            title: input.title,
            workAddress: input.workAddress,
            workStartAt: input.workStartAt,
            workEndAt: input.workEndAt,
            headcount: input.headcount,
            rewardPerPerson: input.rewardPerPerson,
            requiredDescription: input.requiredDescription,
            status: 'DRAFT',
            version: 1,
          },
        });

        // 2. v1 스냅샷. 지금 안 남기면 첫 수정 전까지 복원할 것이 없다 (ADR-JOB-1).
        await tx.jobPostVersion.create({
          data: {
            jobPostId: draft.id,
            version: draft.version,
            workAddress: draft.workAddress,
            workStartAt: draft.workStartAt,
            workEndAt: draft.workEndAt,
            headcount: draft.headcount,
            rewardPerPerson: draft.rewardPerPerson,
            requiredDescription: draft.requiredDescription,
          },
        });

        // 3. 예산을 잠근다. **조건부 UPDATE 한 문장**이라 읽고 쓰는 사이의
        //    틈으로 동시 요청 두 개가 모두 통과하는 일이 없다 (ADR-PAY-2).
        const affected = await tx.$executeRaw`
          UPDATE "User"
          SET "cachedBalance" = "cachedBalance" - ${input.budget}
          WHERE id = ${input.employerId}
            AND "cachedBalance" - ${input.budget} >= 0
        `;
        if (affected === 0) {
          throw new InsufficientBalance();
        }

        await tx.pointTransaction.create({
          data: {
            userId: input.employerId,
            type: 'HOLD',
            amount: -input.budget,
            idempotencyKey: holdKeyFor(draft.id, draft.version),
            referenceId: draft.id,
          },
        });

        // 4. 전이표를 거쳐 OPEN으로 올린다. 한 번에 OPEN으로 만들면
        //    표를 우회하게 되어 ADR-JOB-3이 무의미해진다.
        const opened = await tx.jobPost.update({
          where: { id: draft.id },
          data: { status: transition('DRAFT', 'OPEN') },
        });

        return toRecord(opened);
      });
    } catch (error) {
      if (error instanceof InsufficientBalance) return 'INSUFFICIENT';
      // 같은 공고를 두 번 잠그려 한 것이다. 트랜잭션이 통째로 되돌아간다.
      if (isUniqueViolation(error)) return 'INSUFFICIENT';
      throw error;
    }
  }

  async listOpen(): Promise<{ items: JobPostRecord[]; total: number }> {
    const where = { status: 'OPEN' as const, deletedAt: null };
    const [rows, total] = await Promise.all([
      this.prisma.jobPost.findMany({
        where,
        // 최신순. 목록의 유일한 정렬이라 복합 인덱스가 이 순서다 (ADR-JOB-5).
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.jobPost.count({ where }),
    ]);
    return { items: rows.map(toRecord), total };
  }
}

/** 가입 주소를 기본값으로 준다. 라벨이 여럿이면 먼저 등록한 것 (#3) */
@Injectable()
export class PrismaMemberAddressReader implements MemberAddressReader {
  constructor(private readonly prisma: PrismaService) {}

  async defaultAddressOf(userId: string): Promise<string | null> {
    const row = await this.prisma.userAddress.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { roadAddress: true },
    });
    return row?.roadAddress ?? null;
  }
}

/** 잔액. **원장 합계다** — 부족 금액 안내도 진실의 원천을 따른다 (ADR-PAY-1) */
@Injectable()
export class PrismaBalanceReader implements BalanceReader {
  constructor(private readonly prisma: PrismaService) {}

  async balanceOf(userId: string): Promise<number> {
    const { _sum } = await this.prisma.pointTransaction.aggregate({
      where: { userId },
      _sum: { amount: true },
    });
    return _sum.amount ?? 0;
  }
}

/** 트랜잭션을 되돌리기 위한 내부 신호. 밖으로 새지 않는다 */
class InsufficientBalance extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

function toRecord(row: {
  id: string;
  employerId: string;
  categoryId: string;
  title: string;
  status: string;
  version: number;
  workAddress: string;
  workStartAt: Date;
  workEndAt: Date;
  headcount: number;
  rewardPerPerson: number;
  requiredDescription: string;
  createdAt: Date;
}): JobPostRecord {
  return { ...row, status: row.status as JobPostRecord['status'] };
}
