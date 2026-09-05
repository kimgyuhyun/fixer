import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Put,
  Query,
} from '@nestjs/common';
import {
  ACCOUNT_ERRORS,
  maskedAccountSchema,
  registerAccountRequestSchema,
  type MaskedAccount,
} from '@fixer/shared';
import { ZodError } from 'zod';
import {
  AccountError,
  ExchangeAccountService,
} from './exchange-account.service';

/**
 * 환전 계좌의 HTTP 경계. (이슈 #30)
 *
 * **응답 스키마에 평문 계좌번호 자리가 없다.** 서비스가 실수로 얹어 보내도
 * `maskedAccountSchema.parse`에서 떨어져 나간다 — #2의 비밀번호 해시와 같다.
 */
@Controller('exchange-accounts')
export class ExchangeAccountController {
  constructor(private readonly service: ExchangeAccountService) {}

  /** 등록·변경. 회원당 하나라 PUT이다 */
  @Put()
  @HttpCode(HttpStatus.OK)
  async register(@Body() body: unknown): Promise<MaskedAccount> {
    const userId = userIdOf(body);
    try {
      const input = registerAccountRequestSchema.parse(body);
      return maskedAccountSchema.parse(
        await this.service.register(userId, input),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }

  @Get('me')
  async mine(@Query('userId') userId?: string): Promise<MaskedAccount> {
    if (!userId) {
      throw new BadRequestException({
        errorCode: 'VALIDATION_FAILED',
        message: '회원 정보가 없습니다.',
      });
    }
    try {
      return maskedAccountSchema.parse(await this.service.findMine(userId));
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

function userIdOf(body: unknown): string {
  const userId = (body as { userId?: unknown } | null)?.userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new BadRequestException({
      errorCode: 'VALIDATION_FAILED',
      message: '회원 정보가 없습니다.',
    });
  }
  return userId;
}

function toHttpError(error: unknown): unknown {
  if (error instanceof ZodError) {
    return new BadRequestException({
      errorCode: 'VALIDATION_FAILED',
      message: '입력값을 확인해 주세요.',
    });
  }

  if (error instanceof AccountError) {
    if (error.code === ACCOUNT_ERRORS.NOT_REGISTERED) {
      return new NotFoundException({
        errorCode: error.code,
        message: '등록된 계좌가 없습니다.',
      });
    }

    // 왜 거절됐는지 그대로 전한다. "실패했습니다"만 주면 무엇을 고칠지 모른다.
    return new BadRequestException({
      errorCode: error.code,
      message: error.reason ?? '계좌 정보를 확인해 주세요.',
    });
  }

  return error;
}
