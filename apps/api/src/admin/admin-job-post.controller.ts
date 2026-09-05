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

  /**
   * 목록. 필터는 **쿼리스트링에서만** 온다 (ADR-JOB-4).
   *
   * 잘못된 `page`는 오류로 만들지 않고 1로 본다 — 일반 목록과 같은 규칙이다.
   */
  @Get()
  async list(@Query() query: unknown): Promise<AdminJobPostList> {
    const filter = adminJobPostFilterSchema.parse(query ?? {});
    return adminJobPostListSchema.parse(await this.service.list(filter));
  }

  /** 사유를 적고 강제 취소한다. 잠긴 포인트는 전액 되돌아간다 (§11.6) */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() adminId: string,
  ): Promise<CancelJobPostResult> {
    try {
      const { reason } = forceCancelRequestSchema.parse(body ?? {});
      return cancelJobPostResultSchema.parse(
        await this.service.forceCancel({ adminId, jobPostId: id, reason }),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

function toHttpError(error: unknown): unknown {
  if (error instanceof ZodError) {
    // 사유가 비었거나 안 왔다. 어느 칸이 문제인지는 스키마가 이미 안다.
    return new BadRequestException({
      errorCode: ADMIN_ERRORS.REASON_REQUIRED,
      message: '취소 사유를 입력해 주세요.',
    });
  }

  if (error instanceof AdminError) {
    return new BadRequestException({
      errorCode: error.code,
      message: '취소 사유를 입력해 주세요.',
    });
  }

  if (error instanceof JobPostError) {
    if (error.code === JOB_POST_ERRORS.NOT_FOUND) {
      return new NotFoundException({
        errorCode: error.code,
        message: '공고를 찾을 수 없습니다.',
      });
    }

    if (error.code === JOB_POST_ERRORS.INVALID_TRANSITION) {
      return new ConflictException({
        errorCode: error.code,
        message: '지금 상태에서는 취소할 수 없습니다.',
      });
    }

    return new ConflictException({
      errorCode: error.code,
      message: '지금은 처리할 수 없습니다.',
    });
  }

  return error;
}
