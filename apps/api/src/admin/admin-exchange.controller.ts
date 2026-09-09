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
  ACCOUNT_ERRORS,
  ADMIN_ERRORS,
  EXCHANGE_ERRORS,
  adminExchangeFilterSchema,
  adminExchangeListSchema,
  exchangeActionResultSchema,
  rejectExchangeRequestSchema,
  rejectExchangeResultSchema,
  revealedAccountSchema,
  type AdminExchangeList,
  type ExchangeActionResult,
  type RejectExchangeResult,
  type RevealedAccount,
} from '@fixer/shared';
import { ZodError } from 'zod';
import { AccountError } from '../exchange/exchange-account.service';
import { ExchangeError } from '../exchange/exchange-request.service';
import { AdminError } from './admin-job-post.service';
import { AdminGuard, CurrentAdmin } from './admin.guard';
import { AdminExchangeService } from './admin-exchange.service';

/**
 * 관리자의 환전 관리. (이슈 #34, `spec-fixed.md` §11.5)
 *
 * **가드는 클래스에 붙인다** — #35와 같은 모양이다. 메서드마다 붙이면 새
 * 라우트를 더할 때 빠뜨린다.
 */
@Controller('admin/exchange-requests')
@UseGuards(AdminGuard)
export class AdminExchangeController {
  constructor(private readonly service: AdminExchangeService) {}

  /** 목록. 잘못된 `page`는 오류로 만들지 않고 1로 본다 (#35와 같다) */
  @Get()
  async list(@Query() query: unknown): Promise<AdminExchangeList> {
    const filter = adminExchangeFilterSchema.parse(query ?? {});
    return adminExchangeListSchema.parse(await this.service.list(filter));
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id') id: string,
    @CurrentAdmin() adminId: string,
  ): Promise<ExchangeActionResult> {
    try {
      return exchangeActionResultSchema.parse(
        await this.service.approve({ adminId, requestId: id }),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  async complete(
    @Param('id') id: string,
    @CurrentAdmin() adminId: string,
  ): Promise<ExchangeActionResult> {
    try {
      return exchangeActionResultSchema.parse(
        await this.service.complete({ adminId, requestId: id }),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() adminId: string,
  ): Promise<RejectExchangeResult> {
    try {
      const { reason } = rejectExchangeRequestSchema.parse(body ?? {});
      return rejectExchangeResultSchema.parse(
        await this.service.reject({ adminId, requestId: id, reason }),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /**
   * 계좌번호 전체 열람. **`POST`다** — 감사 로그를 쓰므로 `GET`으로 두면
   * 프리페치나 새로고침에 열람 기록이 늘어난다 (§11.5).
   */
  @Post(':id/reveal-account')
  @HttpCode(HttpStatus.OK)
  async reveal(
    @Param('id') id: string,
    @CurrentAdmin() adminId: string,
  ): Promise<RevealedAccount> {
    try {
      return revealedAccountSchema.parse(
        await this.service.revealAccount({ adminId, requestId: id }),
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
      message: '반려 사유를 입력해 주세요.',
    });
  }

  if (error instanceof AdminError) {
    return new BadRequestException({
      errorCode: error.code,
      message: '반려 사유를 입력해 주세요.',
    });
  }

  if (error instanceof ExchangeError) {
    if (error.code === EXCHANGE_ERRORS.REQUEST_NOT_FOUND) {
      return new NotFoundException({
        errorCode: error.code,
        message: '환전 요청을 찾을 수 없습니다.',
      });
    }

    return new ConflictException({
      errorCode: error.code,
      message: '지금 상태에서는 처리할 수 없습니다.',
    });
  }

  if (error instanceof AccountError) {
    return new NotFoundException({
      errorCode: ACCOUNT_ERRORS.NOT_REGISTERED,
      message: '등록된 계좌가 없습니다.',
    });
  }

  return error;
}
