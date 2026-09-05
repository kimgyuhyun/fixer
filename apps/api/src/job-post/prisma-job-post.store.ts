import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ADMIN_ACTIONS,
  type JobPostFilter,
  type JobPostStatus,
  type JobPostVersionSnapshot,
} from '@fixer/shared';
import {
  holdKeyFor,
  transition,
  type AcceptedCounter,
  type BalanceReader,
  type JobPostRecord,
  type JobPostStore,
  type MemberAddress,
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
    workSido: string;
    workSigungu: string;
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
            workSido: input.workSido,
            workSigungu: input.workSigungu,
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

  async listOpen(
    filter: JobPostFilter,
    pageSize: number,
  ): Promise<{ items: JobPostRecord[]; total: number }> {
    const where = {
      status: 'OPEN' as const,
      deletedAt: null,
      ...(filter.category ? { categoryId: filter.category } : {}),
      ...(filter.sido ? { workSido: filter.sido } : {}),
      // 시/도 없이 시/군/구만 골라도 그대로 거른다. 무시하면 사용자는
      // 필터가 먹은 줄 알고 엉뚱한 목록을 본다.
      ...(filter.sigungu ? { workSigungu: filter.sigungu } : {}),
      ...(filter.q
        ? { title: { contains: filter.q, mode: 'insensitive' as const } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.jobPost.findMany({
        where,
        // 최신순. 목록의 유일한 정렬이라 복합 인덱스가 이 순서다 (ADR-JOB-5).
        orderBy: { createdAt: 'desc' },
        // 범위를 넘은 페이지는 오류가 아니라 빈 목록이다 — 마지막 페이지에서
        // 필터를 바꾸면 흔히 생기는 상황이라 화면이 깨지면 안 된다.
        skip: (filter.page - 1) * pageSize,
        take: pageSize,
      }),
      // **필터를 적용한 뒤의** 건수다. 같은 where를 쓴다.
      this.prisma.jobPost.count({ where }),
    ]);
    return { items: rows.map(toRecord), total };
  }

  async findById(
    jobPostId: string,
  ): Promise<(JobPostRecord & { categoryName: string }) | null> {
    const row = await this.prisma.jobPost.findFirst({
      // **소프트 삭제된 것은 아예 못 찾는다** (#14). 상태는 안 본다 —
      // 이미 지원한 사람이 취소된 공고를 다시 여는 경로가 있어야 한다.
      where: { id: jobPostId, deletedAt: null },
      include: { category: { select: { name: true } } },
    });
    if (row === null) return null;

    return { ...toRecord(row), categoryName: row.category.name };
  }

  /**
   * 수정. **버전 증가·스냅샷·잠금 조정이 한 트랜잭션이다** (#15).
   *
   * 셋이 나뉘면 각각 사고가 다르다. 버전만 오르면 그 계약을 복원할 수 없고,
   * 스냅샷만 남으면 번호가 겹치고, 잠금을 안 고치면 **약속한 돈보다 적게
   * 잠긴 공고**가 된다.
   */
  async applyUpdate(input: {
    jobPostId: string;
    patch: Partial<JobPostRecord>;
    nextVersion: number;
    writeSnapshot: boolean;
    budgetDelta: number;
  }): Promise<(JobPostRecord & { categoryName: string }) | 'INSUFFICIENT'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.jobPost.update({
          where: { id: input.jobPostId },
          data: { ...input.patch, version: input.nextVersion },
          include: { category: { select: { name: true } } },
        });

        // 스냅샷은 **바뀐 뒤** 값이다. `version = 2`를 조회하면 v2 시점의
        // 조건이 나와야 하고, 등록 시점의 v1이 그 규칙을 이미 정했다.
        if (input.writeSnapshot) {
          await tx.jobPostVersion.create({
            data: {
              jobPostId: updated.id,
              version: updated.version,
              workAddress: updated.workAddress,
              workStartAt: updated.workStartAt,
              workEndAt: updated.workEndAt,
              headcount: updated.headcount,
              rewardPerPerson: updated.rewardPerPerson,
              requiredDescription: updated.requiredDescription,
            },
          });
        }

        if (input.budgetDelta > 0) {
          // 더 잠근다. 조건부 UPDATE 한 문장이라 잔액이 모자라면 0건이다.
          const affected = await tx.$executeRaw`
            UPDATE "User"
            SET "cachedBalance" = "cachedBalance" - ${input.budgetDelta}
            WHERE id = ${updated.employerId}
              AND "cachedBalance" - ${input.budgetDelta} >= 0
          `;
          if (affected === 0) throw new InsufficientBalance();

          await tx.pointTransaction.create({
            data: {
              userId: updated.employerId,
              type: 'HOLD',
              amount: -input.budgetDelta,
              idempotencyKey: holdKeyFor(updated.id, updated.version),
              referenceId: updated.id,
            },
          });
        } else if (input.budgetDelta < 0) {
          // 예산이 줄었으니 차액을 되돌린다. 안 되돌리면 쓸 수 없는 돈이 남는다.
          const released = -input.budgetDelta;
          await tx.$executeRaw`
            UPDATE "User"
            SET "cachedBalance" = "cachedBalance" + ${released}
            WHERE id = ${updated.employerId}
          `;
          await tx.pointTransaction.create({
            data: {
              userId: updated.employerId,
              type: 'RELEASE',
              amount: released,
              idempotencyKey: `release:${updated.id}:${updated.version}`,
              referenceId: updated.id,
            },
          });
        }

        return { ...toRecord(updated), categoryName: updated.category.name };
      });
    } catch (error) {
      if (error instanceof InsufficientBalance) return 'INSUFFICIENT';
      throw error;
    }
  }

  /**
   * 취소하고 잠긴 돈을 되돌린다. **한 트랜잭션이다** (#16).
   *
   * 되돌리는 금액을 예산에서 다시 계산하지 않는다. **그 공고를 참조하는
   * 원장 행들의 합**을 쓴다 — #15에서 예산을 고친 공고는 예산과 실제 잠금이
   * 다를 수 있고, `ADR-PAY-7`이 lot 잔여에서 내린 것과 같은 판단이다.
   */
  async cancelAndRelease(input: {
    jobPostId: string;
    employerId: string;
    expectedStatus: JobPostStatus;
    penalize: boolean;
    idempotencyKey: string;
    /** 관리자 강제 취소면 감사 로그를 같은 트랜잭션에 남긴다 (#35 AC4) */
    audit?: { adminId: string; reason: string };
  }): Promise<{ released: number; alreadyReleased: boolean } | 'STALE'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 실제로 잠긴 금액. HOLD는 음수, RELEASE는 양수라 합이 곧 잔여다.
        const { _sum } = await tx.pointTransaction.aggregate({
          where: { referenceId: input.jobPostId },
          _sum: { amount: true },
        });
        const released = -(_sum.amount ?? 0);

        // **상태를 `WHERE`에 건다.** 서비스가 읽은 뒤 누군가 상태를 바꿨으면
        // 0건이 되어 아무것도 안 바뀐다 — 조건부 UPDATE와 같은 방식이다.
        // 전이 자체가 표에 있는지는 `transition`이 판정한다 (ADR-JOB-3).
        const affected = await tx.jobPost.updateMany({
          where: { id: input.jobPostId, status: input.expectedStatus },
          data: { status: transition(input.expectedStatus, 'CANCELLED') },
        });
        if (affected.count === 0) {
          throw new StaleStatus();
        }

        if (released > 0) {
          await tx.$executeRaw`
            UPDATE "User"
            SET "cachedBalance" = "cachedBalance" + ${released}
            WHERE id = ${input.employerId}
          `;
          // 유니크 키가 최후 방어선이다. 두 요청이 동시에 와서 둘 다 OPEN을
          // 읽어도 원장은 한 번만 늘어난다 (#29에서 겪은 것과 같다).
          await tx.pointTransaction.create({
            data: {
              userId: input.employerId,
              type: 'RELEASE',
              amount: released,
              idempotencyKey: input.idempotencyKey,
              referenceId: input.jobPostId,
            },
          });
        }

        if (input.penalize) {
          // 레코드는 지우지 않는다. 분쟁 대응 근거다 (§5).
          await tx.penalty.create({
            data: {
              userId: input.employerId,
              reason: 'POSTER_CANCEL',
              jobPostId: input.jobPostId,
            },
          });
        }

        if (input.audit) {
          // **같은 트랜잭션이다** (#35 AC4). 뒤에 따로 쓰면 그 사이에 죽었을
          // 때 "취소는 됐는데 누가 왜 했는지 없는 공고"가 남는다.
          await tx.adminAuditLog.create({
            data: {
              adminId: input.audit.adminId,
              action: ADMIN_ACTIONS.JOB_POST_FORCE_CANCEL,
              targetType: 'JobPost',
              targetId: input.jobPostId,
              reason: input.audit.reason,
            },
          });
        }

        return { released, alreadyReleased: false };
      });
    } catch (error) {
      if (error instanceof StaleStatus) return 'STALE';
      if (isUniqueViolation(error)) {
        // 다른 요청이 먼저 풀었다. 오류가 아니라 "이미 됨"이다.
        return { released: 0, alreadyReleased: true };
      }
      throw error;
    }
  }

  async findVersion(
    jobPostId: string,
    version: number,
  ): Promise<JobPostVersionSnapshot | null> {
    const row = await this.prisma.jobPostVersion.findUnique({
      where: { jobPostId_version: { jobPostId, version } },
    });
    if (row === null) return null;

    return {
      version: row.version,
      workAddress: row.workAddress,
      workStartAt: row.workStartAt.toISOString(),
      workEndAt: row.workEndAt.toISOString(),
      headcount: row.headcount,
      rewardPerPerson: row.rewardPerPerson,
      requiredDescription: row.requiredDescription,
    };
  }
}

/** 가입 주소를 기본값으로 준다. 라벨이 여럿이면 먼저 등록한 것 (#3) */
@Injectable()
export class PrismaMemberAddressReader implements MemberAddressReader {
  constructor(private readonly prisma: PrismaService) {}

  async defaultAddressOf(userId: string): Promise<MemberAddress | null> {
    const row = await this.prisma.userAddress.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { roadAddress: true, sido: true, sigungu: true },
    });
    return row ?? null;
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

/**
 * 확정 인원. **`JobPost.acceptedCount` 컬럼을 읽는다** (#18, `ADR-APP-1`).
 *
 * 행을 세지 않는 이유는 정원을 막는 조건부 UPDATE가 그 컬럼을 보기 때문이다.
 * 여기서 행을 세면 화면에 보이는 수와 정원을 막는 수가 갈릴 수 있다.
 */
@Injectable()
export class PrismaAcceptedCounter implements AcceptedCounter {
  constructor(private readonly prisma: PrismaService) {}

  async countAccepted(jobPostId: string): Promise<number> {
    const post = await this.prisma.jobPost.findUnique({
      where: { id: jobPostId },
      select: { acceptedCount: true },
    });
    return post?.acceptedCount ?? 0;
  }
}

/** 트랜잭션을 되돌리기 위한 내부 신호. 밖으로 새지 않는다 */
class InsufficientBalance extends Error {}

/** 우리가 읽은 뒤 상태가 바뀌었다. 덮어쓰지 않고 되돌린다 */
class StaleStatus extends Error {}

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
  workSido: string;
  workSigungu: string;
  workStartAt: Date;
  workEndAt: Date;
  headcount: number;
  rewardPerPerson: number;
  requiredDescription: string;
  createdAt: Date;
}): JobPostRecord {
  return { ...row, status: row.status as JobPostRecord['status'] };
}
