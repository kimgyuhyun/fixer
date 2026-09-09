import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ADMIN_ERRORS,
  adminMemberDetailSchema,
  adminMemberFilterSchema,
  adminMemberListSchema,
  type AdminMemberDetail,
  type AdminMemberList,
} from '@fixer/shared';
import { AdminError } from './admin-job-post.service';
import { AdminMemberService } from './admin-member.service';
import { AdminGuard } from './admin.guard';

/**
 * 관리자의 회원 조회. (이슈 #32, `spec-fixed.md` §11.3)
 *
 * 읽기 두 개뿐이다. 관리자 화면에서 회원 정보를 고치는 기능은 PRD §4가
 * 명시적으로 뺐다 — 개인정보 임의 수정은 사고 위험이다.
 *
 * 가드는 클래스에 붙인다 — #33·#35가 정한 모양을 그대로 쓴다. 메서드마다
 * 붙이면 새 라우트를 더할 때 빠뜨린다.
 */
@Controller('admin/members')
@UseGuards(AdminGuard)
export class AdminMemberController {
  constructor(private readonly service: AdminMemberService) {}

  /** 회원 목록. 필터는 쿼리스트링에서만 온다 (`ADR-JOB-4`) */
  @Get()
  async list(@Query() query: unknown): Promise<AdminMemberList> {
    const filter = adminMemberFilterSchema.parse(query ?? {});
    return adminMemberListSchema.parse(await this.service.list(filter));
  }

  /** 회원 상세. AC5의 다섯 덩이를 한 번에 준다 */
  @Get(':id')
  async detail(@Param('id') id: string): Promise<AdminMemberDetail> {
    try {
      return adminMemberDetailSchema.parse(await this.service.detail(id));
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

function toHttpError(error: unknown): unknown {
  if (
    error instanceof AdminError &&
    error.code === ADMIN_ERRORS.MEMBER_NOT_FOUND
  ) {
    // 500으로 나가면 화면이 "잘못된 링크"와 "서버 고장"을 구분하지 못한다.
    return new NotFoundException({
      errorCode: error.code,
      message: '회원을 찾을 수 없습니다.',
    });
  }

  return error;
}
