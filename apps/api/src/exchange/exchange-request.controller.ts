import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  EXCHANGE_ERRORS,
  exchangeRequestSummarySchema,
  requestExchangeSchema,
  type ExchangeErrorCode,
  type ExchangeRequestSummary,
} from '@fixer/shared';
import { ZodError } from 'zod';
import { PointError } from '../point/point-ledger.service';
import {
  ExchangeError,
  ExchangeRequestService,
} from './exchange-request.service';

/**
 * 환전 요청의 HTTP 경계. (이슈 #31)
 *
 * 회원 식별은 #30과 마찬가지로 아직 본문으로 받는다. #4의 토큰 주체로 바꾸는
 * 것은 그 배선이 머지된 뒤다.
 */
@Controller('exchange-requests')
export class ExchangeRequestController {
  constructor(private readonly service: ExchangeRequestService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async request(@Body() body: unknown): Promise<ExchangeRequestSummary> {
    try {
      const input = requestExchangeSchema.parse(body);
      return exchangeRequestSummarySchema.parse(
        await this.service.request(input),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

/** 에러 코드별 안내 문구 */
const MESSAGES: Record<ExchangeErrorCode, string> = {
  [EXCHANGE_ERRORS.BELOW_MIN_AMOUNT]: '5,000원부터 환전할 수 있습니다.',
  [EXCHANGE_ERRORS.INVALID_UNIT]: '10원 단위로 입력해 주세요.',
  [EXCHANGE_ERRORS.NOT_MATURED]:
    '지급받은 지 7일이 지난 포인트만 환전할 수 있습니다.',
  [EXCHANGE_ERRORS.ACCOUNT_NOT_VERIFIED]: '검증된 계좌를 먼저 등록해 주세요.',
};

function toHttpError(error: unknown): unknown {
  if (error instanceof ZodError) {
    return new BadRequestException({
      errorCode: 'VALIDATION_FAILED',
      message: '입력값을 확인해 주세요.',
    });
  }

  if (error instanceof ExchangeError) {
    const body = { errorCode: error.code, message: MESSAGES[error.code] };

    // 금액은 사용자가 그 자리에서 고칠 수 있다. 상태로 막힌 것과 구분한다.
    if (
      error.code === EXCHANGE_ERRORS.BELOW_MIN_AMOUNT ||
      error.code === EXCHANGE_ERRORS.INVALID_UNIT
    ) {
      return new BadRequestException(body);
    }

    return new ConflictException(body);
  }

  if (error instanceof PointError) {
    return new ConflictException({
      errorCode: error.code,
      message: '환전할 수 있는 잔액이 모자랍니다.',
    });
  }

  return error;
}
