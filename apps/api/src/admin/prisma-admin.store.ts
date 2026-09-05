import { Injectable } from '@nestjs/common';
import type { AdminJobPostFilter, UserRole } from '@fixer/shared';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AdminJobPostRow,
  AdminJobPostStore,
} from './admin-job-post.service';
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
