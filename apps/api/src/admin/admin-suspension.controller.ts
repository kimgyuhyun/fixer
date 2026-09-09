import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type {
  AdminSuspensionList,
  ReleaseSuspensionResult,
} from '@fixer/shared';
import { CurrentAdmin } from './admin.guard';
import { AdminSuspensionService } from './admin-suspension.service';

/**
 * 관리자의 블랙리스트. (이슈 #33, `spec-fixed.md` §11.4)
 *
 * 가드는 클래스에 붙인다 — #35가 정한 모양을 그대로 쓴다.
 */
@Controller('admin/suspensions')
export class AdminSuspensionController {
  constructor(private readonly service: AdminSuspensionService) {}

  /** 현재 제재 중인 회원 목록. 필터는 쿼리스트링에서만 온다 (ADR-JOB-4) */
  @Get()
  list(@Query() query: unknown): Promise<AdminSuspensionList> {
    throw new Error('not implemented');
  }

  /** 사유를 적고 제재를 조기 해제한다 (§11.4) */
  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  release(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() adminId: string,
  ): Promise<ReleaseSuspensionResult> {
    throw new Error('not implemented');
  }
}
