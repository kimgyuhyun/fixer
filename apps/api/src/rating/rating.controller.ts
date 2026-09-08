import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { type RatingResult, type RatingSummary } from '@fixer/shared';
import { RatingService } from './rating.service';

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
  async rate(@Body() _body: unknown): Promise<RatingResult> {
    throw new Error('not implemented');
  }

  /** 한 회원의 두 평점 (AC4~AC6) */
  @Get(':userId')
  async summary(@Param('userId') _userId: string): Promise<RatingSummary> {
    throw new Error('not implemented');
  }
}
