import { Controller, Get, Param, Query } from '@nestjs/common';
import type { AdminMemberDetail, AdminMemberList } from '@fixer/shared';
import { AdminMemberService } from './admin-member.service';

/**
 * 관리자의 회원 조회. (이슈 #32, `spec-fixed.md` §11.3)
 *
 * 읽기 두 개뿐이다. 관리자 화면에서 회원 정보를 고치는 기능은 PRD §4가
 * 명시적으로 뺐다 — 개인정보 임의 수정은 사고 위험이다.
 */
@Controller('admin/members')
export class AdminMemberController {
  constructor(private readonly service: AdminMemberService) {}

  /** 회원 목록. 필터는 쿼리스트링에서만 온다 (`ADR-JOB-4`) */
  @Get()
  list(@Query() _query: unknown): Promise<AdminMemberList> {
    throw new Error('not implemented');
  }

  /** 회원 상세. AC5의 다섯 덩이를 한 번에 준다 */
  @Get(':id')
  detail(@Param('id') _id: string): Promise<AdminMemberDetail> {
    throw new Error('not implemented');
  }
}
