import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ADMIN_ERRORS,
  JOB_POST_ERRORS,
  adminJobPostFilterSchema,
  adminJobPostListSchema,
  cancelJobPostResultSchema,
  forceCancelRequestSchema,
  type AdminJobPostList,
  type CancelJobPostResult,
} from '@fixer/shared';
import { ZodError } from 'zod';
import { JobPostError } from '../job-post/job-post.service';
import { AdminGuard, CurrentAdmin } from './admin.guard';
import { AdminError, AdminJobPostService } from './admin-job-post.service';

/**
 * 관리자의 공고 관리. (이슈 #35, `spec-fixed.md` §11.6)
 *
 * **가드는 클래스에 붙인다.** 메서드마다 붙이면 새 라우트를 더할 때 빠뜨린다 —
 * #32·#33·#34가 같은 방식으로 자기 컨트롤러를 만든다.
 */
@Controller('admin/job-posts')
@UseGuards(AdminGuard)
export class AdminJobPostController {
  constructor(private readonly service: AdminJobPostService) {}

  @Get()
  async list(@Query() _query: unknown): Promise<AdminJobPostList> {
    throw new Error('not implemented');
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id') _id: string,
    @Body() _body: unknown,
    @CurrentAdmin() _adminId: string,
  ): Promise<CancelJobPostResult> {
    throw new Error('not implemented');
  }
}
