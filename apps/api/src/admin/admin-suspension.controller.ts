import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
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
  adminSuspensionFilterSchema,
  adminSuspensionListSchema,
  releaseSuspensionRequestSchema,
  releaseSuspensionResultSchema,
  type AdminSuspensionList,
  type ReleaseSuspensionResult,
} from '@fixer/shared';
import { ZodError } from 'zod';
import { AdminError } from './admin-job-post.service';
import { AdminGuard, CurrentAdmin } from './admin.guard';
import { AdminSuspensionService } from './admin-suspension.service';

/**
 * 관리자의 블랙리스트. (이슈 #33, `spec-fixed.md` §11.4)
 *
 * 가드는 클래스에 붙인다 — #35가 정한 모양을 그대로 쓴다. 메서드마다 붙이면
 * 새 라우트를 더할 때 빠뜨린다.
 */
@Controller('admin/suspensions')
@UseGuards(AdminGuard)
export class AdminSuspensionController {
  constructor(private readonly service: AdminSuspensionService) {}

  /** 현재 제재 중인 회원 목록. 필터는 쿼리스트링에서만 온다 (ADR-JOB-4) */
  @Get()
  async list(@Query() query: unknown): Promise<AdminSuspensionList> {
    const filter = adminSuspensionFilterSchema.parse(query ?? {});
    return adminSuspensionListSchema.parse(await this.service.list(filter));
  }

  /** 사유를 적고 제재를 조기 해제한다. 사유 없는 해제는 막힌다 (§11.4) */
  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  async release(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() adminId: string,
  ): Promise<ReleaseSuspensionResult> {
    try {
      const { reason } = releaseSuspensionRequestSchema.parse(body ?? {});
      return releaseSuspensionResultSchema.parse(
        await this.service.release({ adminId, suspensionId: id, reason }),
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
      message: '해제 사유를 입력해 주세요.',
    });
  }

  if (error instanceof AdminError) {
    if (error.code === ADMIN_ERRORS.SUSPENSION_NOT_FOUND) {
      return new NotFoundException({
        errorCode: error.code,
        message: '제재 건을 찾을 수 없습니다.',
      });
    }

    if (error.code === ADMIN_ERRORS.SUSPENSION_ALREADY_RELEASED) {
      // 동시에 두 관리자가 눌렀을 때 진 쪽도 여기로 온다.
      return new ConflictException({
        errorCode: error.code,
        message: '이미 해제된 제재입니다.',
      });
    }

    return new BadRequestException({
      errorCode: error.code,
      message: '해제 사유를 입력해 주세요.',
    });
  }

  return error;
}
