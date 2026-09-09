import { Injectable } from '@nestjs/common';
import {
  ADMIN_ACTIONS,
  PENALTY_REASONS,
  penaltyWindowStart,
  type AdminJobPostFilter,
  type AdminSuspensionFilter,
  type PenaltyReason,
  type UserRole,
} from '@fixer/shared';
import { PrismaService } from '../prisma/prisma.service';
import { activeSuspensionAtWhere } from '../penalty/penalty-transaction';
import type {
  AdminJobPostRow,
  AdminJobPostStore,
} from './admin-job-post.service';
import type {
  AdminSuspensionRow,
  AdminSuspensionStore,
  ReleasedSuspension,
} from './admin-suspension.service';
import type { RoleReader } from './admin.guard';

/** 회원의 등급을 DB에서 읽는다. 토큰에 복사하지 않는 이유는 가드 주석에 */
@Injectable()
export class PrismaRoleReader implements RoleReader {
  constructor(private readonly prisma: PrismaService) {}

  async roleOf(userId: string): Promise<UserRole | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return row?.role ?? null;
  }
}

/** 관리자 공고 목록. 구인자·카테고리 이름을 조인해서 함께 준다 */
@Injectable()
export class PrismaAdminJobPostStore implements AdminJobPostStore {
  constructor(private readonly prisma: PrismaService) {}

  async listAll(
    filter: AdminJobPostFilter,
    pageSize: number,
  ): Promise<{ items: AdminJobPostRow[]; total: number }> {
    const where = {
      // **상태를 고정하지 않는다.** 관리자 목록은 OPEN만 보는 화면이 아니다.
      deletedAt: null,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.category ? { categoryId: filter.category } : {}),
      ...(filter.q
        ? {
            // 제목과 구인자 이름 **양쪽**에 건다 (AC2). 검색칸이 하나이므로
            // 관리자는 어느 쪽을 쳤는지 신경 쓰지 않아도 된다.
            OR: [
              { title: { contains: filter.q, mode: 'insensitive' as const } },
              {
                employer: {
                  name: { contains: filter.q, mode: 'insensitive' as const },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.jobPost.findMany({
        where,
        // 이름을 함께 가져온다. 목록을 그린 뒤 화면이 따로 부르면 한 페이지에
        // 스무 번을 더 부르게 된다.
        include: {
          employer: { select: { name: true } },
          category: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        // 범위를 넘은 페이지는 오류가 아니라 빈 목록이다 (일반 목록과 같다).
        skip: (filter.page - 1) * pageSize,
        take: pageSize,
      }),
      // **필터를 적용한 뒤의** 건수다. 같은 where를 쓴다.
      this.prisma.jobPost.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        employerId: row.employerId,
        categoryId: row.categoryId,
        title: row.title,
        status: row.status,
        version: row.version,
        workAddress: row.workAddress,
        workSido: row.workSido,
        workSigungu: row.workSigungu,
        workStartAt: row.workStartAt,
        workEndAt: row.workEndAt,
        headcount: row.headcount,
        rewardPerPerson: row.rewardPerPerson,
        requiredDescription: row.requiredDescription,
        createdAt: row.createdAt,
        employerName: row.employer.name,
        categoryName: row.category.name,
      })),
      total,
    };
  }
}

/**
 * 블랙리스트 = `Suspension` 조회. **새 테이블을 만들지 않는다** (§5.1).
 */
@Injectable()
export class PrismaAdminSuspensionStore implements AdminSuspensionStore {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(
    filter: AdminSuspensionFilter,
    pageSize: number,
    now: Date,
  ): Promise<{ items: AdminSuspensionRow[]; total: number }> {
    const where = {
      // **판정 규칙은 여기서 다시 적지 않는다** (§5.1).
      ...activeSuspensionAtWhere(now),
      ...(filter.q
        ? {
            user: {
              name: { contains: filter.q, mode: 'insensitive' as const },
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.suspension.findMany({
        where,
        include: { user: { select: { name: true } } },
        orderBy: { startAt: 'desc' },
        // 범위를 넘은 페이지는 오류가 아니라 빈 목록이다 (관리자 공고 목록과 같다).
        skip: (filter.page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.suspension.count({ where }),
    ]);

    return { items: await this.withPenalties(rows, now), total };
  }

  /**
   * 한 페이지분 경고 집계를 **한 번에** 붙인다.
   *
   * 줄마다 세면 한 페이지에 스무 번을 더 부른다. 창은 §5의 180일 그대로다 —
   * 창 밖 경고까지 세면 §11.3 회원 목록의 "경고 수(180일)"와 숫자가 어긋난다.
   */
  private async withPenalties(
    rows: {
      id: string;
      userId: string;
      startAt: Date;
      endAt: Date;
      user: { name: string };
    }[],
    now: Date,
  ): Promise<AdminSuspensionRow[]> {
    const userIds = rows.map((row) => row.userId);
    const penalties =
      userIds.length === 0
        ? []
        : await this.prisma.penalty.findMany({
            where: {
              userId: { in: userIds },
              occurredAt: { gte: penaltyWindowStart(now) },
            },
            select: { userId: true, reason: true },
          });

    // 회원별로 한 번만 가른다. 줄마다 전체를 훑으면 "한 번에 붙인다"는
    // 위 설명과 코드가 어긋난다.
    const byUser = new Map<string, PenaltyReason[]>();
    for (const penalty of penalties) {
      const mine = byUser.get(penalty.userId) ?? [];
      mine.push(penalty.reason);
      byUser.set(penalty.userId, mine);
    }

    return rows.map((row) => {
      const mine = byUser.get(row.userId) ?? [];
      return {
        id: row.id,
        userId: row.userId,
        userName: row.user.name,
        startAt: row.startAt,
        endAt: row.endAt,
        // 선언 순서로 고정한다. 조회 순서에 맡기면 같은 회원이 새로고침마다
        // 다른 순서로 보인다.
        reasons: PENALTY_REASONS.filter((reason) => mine.includes(reason)),
        penaltyCount: mine.length,
      };
    });
  }

  async release(input: {
    suspensionId: string;
    adminId: string;
    reason: string;
    now: Date;
  }): Promise<ReleasedSuspension | 'NOT_FOUND' | 'ALREADY_RELEASED'> {
    return await this.prisma.$transaction(async (tx) => {
      // **조건부 갱신이 경합에서 이기는 지점이다.** 동시에 둘이 눌러도
      // `releasedAt IS NULL`을 만족하는 쪽은 하나뿐이다.
      const updated = await tx.suspension.updateMany({
        where: { id: input.suspensionId, releasedAt: null },
        data: {
          releasedAt: input.now,
          releasedBy: input.adminId,
          releaseReason: input.reason,
        },
      });

      if (updated.count === 0) {
        // 없는 건과 이미 풀린 건을 여기서 가른다. 화면이 "다시 시도"와
        // "이미 처리됨"을 다르게 안내해야 한다.
        const existing = await tx.suspension.findUnique({
          where: { id: input.suspensionId },
          select: { id: true },
        });
        return existing === null ? 'NOT_FOUND' : 'ALREADY_RELEASED';
      }

      const row = await tx.suspension.findUniqueOrThrow({
        where: { id: input.suspensionId },
        select: { id: true, userId: true },
      });

      // **같은 트랜잭션이다** (§11.5). 뒤에 따로 쓰면 그 사이에 죽었을 때
      // "풀렸는데 누가 풀었는지 없는" 상태가 남는다.
      await tx.adminAuditLog.create({
        data: {
          adminId: input.adminId,
          action: ADMIN_ACTIONS.SUSPENSION_RELEASE,
          targetType: 'Suspension',
          targetId: input.suspensionId,
          reason: input.reason,
        },
      });

      return {
        id: row.id,
        userId: row.userId,
        releasedAt: input.now,
        releasedBy: input.adminId,
      };
    });
  }
}
