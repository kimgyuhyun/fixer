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
  AdminExchangeList,
  ExchangeActionResult,
  RejectExchangeResult,
  RevealedAccount,
} from '@fixer/shared';
import { CurrentAdmin } from './admin.guard';
import { AdminExchangeService } from './admin-exchange.service';

/**
 * 관리자의 환전 관리. (이슈 #34, `spec-fixed.md` §11.5)
 *
 * **가드는 클래스에 붙인다** — #35와 같은 모양이다. 메서드마다 붙이면 새
 * 라우트를 더할 때 빠뜨린다.
 */
@Controller('admin/exchange-requests')
export class AdminExchangeController {
  constructor(private readonly service: AdminExchangeService) {}

  @Get()
  list(@Query() query: unknown): Promise<AdminExchangeList> {
    throw new Error('not implemented');
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id') id: string,
    @CurrentAdmin() adminId: string,
  ): Promise<ExchangeActionResult> {
    throw new Error('not implemented');
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @Param('id') id: string,
    @CurrentAdmin() adminId: string,
  ): Promise<ExchangeActionResult> {
    throw new Error('not implemented');
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() adminId: string,
  ): Promise<RejectExchangeResult> {
    throw new Error('not implemented');
  }

  /**
   * 계좌번호 전체 열람. **`POST`다** — 감사 로그를 쓰므로 `GET`으로 두면
   * 프리페치나 새로고침에 열람 기록이 늘어난다 (§11.5).
   */
  @Post(':id/reveal-account')
  @HttpCode(HttpStatus.OK)
  reveal(
    @Param('id') id: string,
    @CurrentAdmin() adminId: string,
  ): Promise<RevealedAccount> {
    throw new Error('not implemented');
  }
}
