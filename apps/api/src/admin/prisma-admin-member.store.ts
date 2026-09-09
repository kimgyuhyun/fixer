import { Injectable } from '@nestjs/common';
import {
  isSuspensionActive,
  penaltyWindowStart,
  type AdminMemberFilter,
  type AdminMemberStatus,
} from '@fixer/shared';
import { PrismaService } from '../prisma/prisma.service';
import { activeSuspensionAtWhere } from '../penalty/penalty-transaction';
import type {
  AdminMemberDetailRow,
  AdminMemberRow,
  AdminMemberStore,
} from './admin-member.service';

/** 목록 한 줄에 필요한 `User` 컬럼. 목록과 상세가 같은 모양을 읽는다 */
const MEMBER_FIELDS = {
  id: true,
  name: true,
  email: true,
  createdAt: true,
  deactivatedAt: true,
  ratingAsPoster: true,
  ratingAsPosterCount: true,
  ratingAsWorker: true,
  ratingAsWorkerCount: true,
} as const;

/**
 * 관리자 회원 조회. (이슈 #32, `spec-fixed.md` §11.3)
 *
 * **새 테이블이 없다.** 회원 목록은 `User` 조회에 주소·평점 캐시·경고 집계를
 * 붙인 것이고, 상세는 거기에 AC5의 다섯 덩이를 더한 것이다.
 */
@Injectable()
export class PrismaAdminMemberStore implements AdminMemberStore {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    filter: AdminMemberFilter,
    pageSize: number,
    now: Date,
  ): Promise<{ items: AdminMemberRow[]; total: number }> {
    const where = {
      ...searchWhere(filter.q),
      ...regionWhere(filter),
      ...statusWhere(filter.status, now),
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          ...MEMBER_FIELDS,
          // 유효 제재가 **있는지만** 본다. 한 줄이면 충분하다 (§5.1)
          suspensions: {
            where: activeSuspensionAtWhere(now),
            select: { id: true },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        // 범위를 넘은 페이지는 오류가 아니라 빈 목록이다 (관리자 목록 셋과 같다).
        skip: (filter.page - 1) * pageSize,
        take: pageSize,
      }),
      // **필터를 적용한 뒤의** 건수다. 같은 where를 쓴다.
      this.prisma.user.count({ where }),
    ]);

    const counts = await this.penaltyCountsOf(
      rows.map((row) => row.id),
      now,
    );

    return {
      items: rows.map((row) => ({
        ...toRow(row),
        hasActiveSuspension: row.suspensions.length > 0,
        penaltyCount: counts.get(row.id) ?? 0,
      })),
      total,
    };
  }

  async findDetail(
    userId: string,
    now: Date,
  ): Promise<AdminMemberDetailRow | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...MEMBER_FIELDS,
        // 가입 주소 하나만 본다. 회원당 여러 주소가 쌓인다 (ADR-AUTH-2).
        addresses: {
          select: { sido: true, sigungu: true, roadAddress: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
        ratingsReceived: {
          select: {
            id: true,
            score: true,
            rateeRole: true,
            createdAt: true,
            rater: { select: { name: true } },
            application: { select: { jobPost: { select: { title: true } } } },
          },
          orderBy: { createdAt: 'desc' },
        },
        jobPosts: {
          select: { id: true, title: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
        applications: {
          select: {
            id: true,
            jobPostId: true,
            status: true,
            createdAt: true,
            jobPost: { select: { title: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        pointTransactions: {
          select: { id: true, type: true, amount: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
        // **창으로 자르지 않는다.** 상세의 경고 이력은 분쟁 대응 근거다 (§11.3).
        penalties: {
          select: {
            id: true,
            reason: true,
            jobPostId: true,
            occurredAt: true,
          },
          orderBy: { occurredAt: 'desc' },
        },
        suspensions: {
          select: {
            id: true,
            startAt: true,
            endAt: true,
            releasedAt: true,
          },
          orderBy: { startAt: 'desc' },
        },
      },
    });

    if (user === null) return null;

    const windowStart = penaltyWindowStart(now);

    return {
      ...toRow(user),
      // 목록과 같은 판정을 쓴다. 여기서 조건을 다시 적으면 두 화면이 갈린다.
      hasActiveSuspension: user.suspensions.some((suspension) =>
        isSuspensionActive(suspension, now),
      ),
      // 목록의 "경고 수(180일)"와 같은 창이다 (§5).
      penaltyCount: user.penalties.filter(
        (penalty) => penalty.occurredAt >= windowStart,
      ).length,
      address: user.addresses[0] ?? null,
      reviews: user.ratingsReceived.map((rating) => ({
        id: rating.id,
        score: rating.score,
        rateeRole: rating.rateeRole,
        raterName: rating.rater.name,
        jobPostTitle: rating.application.jobPost.title,
        createdAt: rating.createdAt,
      })),
      jobPosts: user.jobPosts,
      applications: user.applications.map((application) => ({
        id: application.id,
        jobPostId: application.jobPostId,
        jobPostTitle: application.jobPost.title,
        status: application.status,
        createdAt: application.createdAt,
      })),
      // **원장 합이다** (`ADR-PAY-1`). `cachedBalance`를 그대로 내면 캐시가
      // 틀어졌는지 확인하러 온 관리자가 확인할 방법이 없다.
      pointBalance: user.pointTransactions.reduce(
        (sum, entry) => sum + entry.amount,
        0,
      ),
      ledger: user.pointTransactions,
      penalties: user.penalties,
      suspensions: user.suspensions,
    };
  }

  /**
   * 한 페이지분 경고 집계를 **한 번에** 붙인다.
   *
   * 줄마다 세면 한 페이지에 스무 번을 더 부른다 (#33과 같은 자리).
   */
  private async penaltyCountsOf(
    userIds: string[],
    now: Date,
  ): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();

    const rows = await this.prisma.penalty.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds },
        occurredAt: { gte: penaltyWindowStart(now) },
      },
      _count: { _all: true },
    });

    return new Map(rows.map((row) => [row.userId, row._count._all]));
  }
}

/** 이름 **또는** 이메일 부분 일치 (§11.2). 검색칸은 하나다 */
function searchWhere(q: string | undefined) {
  if (q === undefined) return {};
  const contains = { contains: q, mode: 'insensitive' as const };
  return { OR: [{ name: contains }, { email: contains }] };
}

/**
 * 주소지 필터 (`ADR-AUTH-2`).
 *
 * **주소가 없는 회원은 빠진다.** 시/도를 고른 순간 "그 지역 회원"을 묻는
 * 것이므로, 주소가 없는 회원은 그 답이 아니다. 시/군/구만 골라도 걸린다.
 */
function regionWhere(filter: AdminMemberFilter) {
  const address = {
    ...(filter.sido === undefined ? {} : { sido: filter.sido }),
    ...(filter.sigungu === undefined ? {} : { sigungu: filter.sigungu }),
  };

  return Object.keys(address).length === 0
    ? {}
    : { addresses: { some: address } };
}

/**
 * 상태 필터 (§11.3).
 *
 * **상태 컬럼이 없다** (`ADR-AUTH-3`). `deactivatedAt`과 유효 제재 여부로
 * 거른다 — `memberStatusOf`가 같은 규칙을 표시 쪽에서 쓴다.
 */
function statusWhere(status: AdminMemberStatus | undefined, now: Date) {
  if (status === undefined) return {};
  if (status === 'DEACTIVATED') return { deactivatedAt: { not: null } };

  const active = { suspensions: { some: activeSuspensionAtWhere(now) } };
  return status === 'SUSPENDED'
    ? { deactivatedAt: null, ...active }
    : {
        deactivatedAt: null,
        suspensions: { none: activeSuspensionAtWhere(now) },
      };
}

/** `User` 컬럼을 목록 한 줄의 이름으로 옮긴다 */
function toRow(user: {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  deactivatedAt: Date | null;
  ratingAsPoster: number | null;
  ratingAsPosterCount: number;
  ratingAsWorker: number | null;
  ratingAsWorkerCount: number;
}): Omit<AdminMemberRow, 'hasActiveSuspension' | 'penaltyCount'> {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    joinedAt: user.createdAt,
    deactivatedAt: user.deactivatedAt,
    ratingAsPoster: user.ratingAsPoster,
    ratingAsPosterCount: user.ratingAsPosterCount,
    ratingAsWorker: user.ratingAsWorker,
    ratingAsWorkerCount: user.ratingAsWorkerCount,
  };
}
