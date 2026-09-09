import { Injectable } from '@nestjs/common';
import type { AdminMemberFilter } from '@fixer/shared';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AdminMemberDetailRow,
  AdminMemberRow,
  AdminMemberStore,
} from './admin-member.service';

/**
 * 관리자 회원 조회. (이슈 #32, `spec-fixed.md` §11.3)
 *
 * **새 테이블이 없다.** 회원 목록은 `User` 조회에 주소·평점 캐시·경고 집계를
 * 붙인 것이고, 상세는 거기에 다섯 덩이를 더한 것이다.
 */
@Injectable()
export class PrismaAdminMemberStore implements AdminMemberStore {
  constructor(private readonly prisma: PrismaService) {}

  list(
    _filter: AdminMemberFilter,
    _pageSize: number,
    _now: Date,
  ): Promise<{ items: AdminMemberRow[]; total: number }> {
    throw new Error('not implemented');
  }

  findDetail(
    _userId: string,
    _now: Date,
  ): Promise<AdminMemberDetailRow | null> {
    throw new Error('not implemented');
  }
}
