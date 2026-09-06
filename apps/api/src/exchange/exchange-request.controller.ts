import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { ExchangeRequestSummary } from '@fixer/shared';
import { ExchangeRequestService } from './exchange-request.service';

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
  request(@Body() body: unknown): Promise<ExchangeRequestSummary> {
    throw new Error('not implemented');
  }
}
