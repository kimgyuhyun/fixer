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
} from '@nestjs/common';
import {
  RATING_ERRORS,
  rateRequestSchema,
  ratingResultSchema,
  ratingSummarySchema,
  type RatingErrorCode,
  type RatingResult,
  type RatingSummary,
} from '@fixer/shared';
import { ZodError } from 'zod';
import { RatingError, RatingService } from './rating.service';

/**
 * 별점의 HTTP 경계. (이슈 #26)
 *
 * 회원 식별은 #12와 마찬가지로 아직 본문으로 받는다. #4의 토큰 주체로
 * 바꾸는 것은 그 배선이 머지된 뒤다.
 */
@Controller('ratings')
export class RatingController {
  constructor(private readonly service: RatingService) {}

  /** 거래 후 별점을 남긴다 (AC1~AC3) */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async rate(@Body() body: unknown): Promise<RatingResult> {
    try {
      const input = rateRequestSchema.parse(body);
      return ratingResultSchema.parse(await this.service.rate(input));
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** 한 회원의 두 평점 (AC4~AC6) */
  @Get(':userId')
  async summary(@Param('userId') userId: string): Promise<RatingSummary> {
    try {
      return ratingSummarySchema.parse(await this.service.summaryOf(userId));
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

/** 에러 코드별 안내 문구 */
const MESSAGES: Record<RatingErrorCode, string> = {
  [RATING_ERRORS.APPLICATION_NOT_FOUND]: '거래를 찾을 수 없습니다.',
  [RATING_ERRORS.NOT_PARTICIPANT]: '이 거래의 당사자가 아닙니다.',
  [RATING_ERRORS.NOT_COMPLETED]: '완료된 거래에만 별점을 남길 수 있습니다.',
  [RATING_ERRORS.ALREADY_RATED]: '이미 별점을 남긴 거래입니다.',
  [RATING_ERRORS.USER_NOT_FOUND]: '회원을 찾을 수 없습니다.',
};

function toHttpError(error: unknown): unknown {
  if (error instanceof ZodError) {
    return new BadRequestException({
      errorCode: 'VALIDATION_FAILED',
      message: '입력값을 확인해 주세요.',
    });
  }

  if (error instanceof RatingError) {
    const body = { errorCode: error.code, message: MESSAGES[error.code] };

    if (
      error.code === RATING_ERRORS.APPLICATION_NOT_FOUND ||
      error.code === RATING_ERRORS.USER_NOT_FOUND
    ) {
      return new NotFoundException(body);
    }

    if (error.code === RATING_ERRORS.NOT_PARTICIPANT) {
      return new ForbiddenException(body);
    }

    // 사람이 아니라 **거래의 지금 상태** 때문에 막혔다. 완료되면 줄 수 있고,
    // 이미 준 것은 상태 충돌이다.
    return new ConflictException(body);
  }

  return error;
}
