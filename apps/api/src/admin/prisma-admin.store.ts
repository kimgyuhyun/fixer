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

  roleOf(_userId: string): Promise<UserRole | null> {
    throw new Error('not implemented');
  }
}

/** 관리자 공고 목록. 구인자·카테고리 이름을 조인해서 함께 준다 */
@Injectable()
export class PrismaAdminJobPostStore implements AdminJobPostStore {
  constructor(private readonly prisma: PrismaService) {}

  listAll(
    _filter: AdminJobPostFilter,
    _pageSize: number,
  ): Promise<{ items: AdminJobPostRow[]; total: number }> {
    throw new Error('not implemented');
  }
}
