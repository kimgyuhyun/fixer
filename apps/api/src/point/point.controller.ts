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
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  PAYMENT_ERRORS,
  chargeResultSchema,
  confirmChargeRequestSchema,
  pointHistorySchema,
  refundRequestSchema,
  refundResultSchema,
  startedChargeSchema,
  type ChargeResult,
  type PointHistory,
  type RefundResult,
  type StartedCharge,
} from '@fixer/shared';
import type { Request } from 'express';
import { ZodError } from 'zod';
import { CurrentMember, MemberGuard } from '../auth/member.guard';
import { ChargeService, PaymentError } from './charge.service';
import { PointHistoryService } from './point-history.service';
import { RefundService } from './refund.service';

/**
 * 충전과 포인트 내역의 HTTP 경계. (이슈 #28)
 *
 * **회원은 쿠키에서 온다** (#69). 웹훅만 예외다 — 포트원은 쿠키를 들고
 * 오지 않고, 그쪽은 서명 검증이 인증 역할을 한다 (ADR-PAY-3).
 */
@Controller()
export class PointController {
  constructor(
    private readonly charge: ChargeService,
    private readonly history: PointHistoryService,
    private readonly refunds: RefundService,
  ) {}

  /** 결제창을 열기 전에 서버가 금액을 정한다 */
  @Post('payments')
  @UseGuards(MemberGuard)
  @HttpCode(HttpStatus.CREATED)
  async start(
    @CurrentMember() userId: string,
    @Body() body: unknown,
  ): Promise<StartedCharge> {
    try {
      return startedChargeSchema.parse(await this.charge.start(userId, body));
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** 결제 확정. 클라이언트가 보내는 것은 식별자 하나뿐이다 */
  @Post('payments/confirm')
  @UseGuards(MemberGuard)
  @HttpCode(HttpStatus.OK)
  async confirm(
    @CurrentMember() userId: string,
    @Body() body: unknown,
  ): Promise<ChargeResult> {
    try {
      const input = confirmChargeRequestSchema.parse(body);
      return chargeResultSchema.parse(
        await this.charge.confirm({ paymentId: input.paymentId, userId }),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /**
   * 포트원 웹훅.
   *
   * **본문을 문자열 그대로 받아야 한다.** 파싱한 뒤 다시 직렬화하면 키 순서나
   * 공백이 달라져 서명이 맞지 않는다. `main.ts`가 이 경로만 raw로 남긴다.
   */
  @Post('payments/webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Req() req: Request): Promise<{ received: true }> {
    const rawBody = rawBodyOf(req);
    try {
      await this.charge.handleWebhook(rawBody, headersOf(req));
    } catch (error) {
      // 서명이 틀린 것만 거절한다. 나머지는 200을 준다 — 아니면 포트원이
      // 계속 재전송한다 (ADR-PAY-3).
      if (
        error instanceof PaymentError &&
        error.code === PAYMENT_ERRORS.WEBHOOK_SIGNATURE_INVALID
      ) {
        throw new UnauthorizedException({
          errorCode: error.code,
          message: '서명이 올바르지 않습니다.',
        });
      }
      if (!(error instanceof PaymentError)) throw error;
    }
    return { received: true };
  }

  /** 결제 건 하나를 통째로 취소한다. 두 번 불러도 한 번만 반영된다 (#29) */
  @Post('payments/:id/cancel')
  @UseGuards(MemberGuard)
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentMember() userId: string,
    @Param('id') paymentId: string,
  ): Promise<RefundResult> {
    try {
      return refundResultSchema.parse(
        await this.refunds.cancelPayment({ userId, paymentId }),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** 금액만큼 환불한다. 오래된 결제 건부터 소진한다 (ADR-PAY-7) */
  @Post('refunds')
  @UseGuards(MemberGuard)
  @HttpCode(HttpStatus.OK)
  async refund(
    @CurrentMember() userId: string,
    @Body() body: unknown,
  ): Promise<RefundResult> {
    try {
      const input = refundRequestSchema.parse(body);
      return refundResultSchema.parse(
        await this.refunds.refund({ userId, amount: input.amount }),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** 포인트 잔액과 내역 */
  @Get('points/me')
  @UseGuards(MemberGuard)
  async myPoints(@CurrentMember() userId: string): Promise<PointHistory> {
    return pointHistorySchema.parse(await this.history.read(userId));
  }
}

function rawBodyOf(req: Request): string {
  const raw = (req as { rawBody?: unknown }).rawBody;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (typeof raw === 'string') return raw;
  // raw가 없으면 서명이 맞을 수 없다. 빈 문자열로 두면 검증에서 걸린다.
  return '';
}

function headersOf(req: Request): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    headers[name] = Array.isArray(value) ? value[0] : value;
  }
  return headers;
}

function toHttpError(error: unknown): unknown {
  if (error instanceof ZodError) {
    return new BadRequestException({
      errorCode: 'VALIDATION_FAILED',
      message: '입력값을 확인해 주세요.',
    });
  }

  if (error instanceof PaymentError) {
    switch (error.code) {
      case PAYMENT_ERRORS.NOT_FOUND:
        return new NotFoundException({
          errorCode: error.code,
          message: '결제 건을 찾을 수 없습니다.',
        });
      case PAYMENT_ERRORS.NOT_OWNED:
        // 없다고 하지 않는다. 본인 것이 아니라는 사실만 말한다.
        return new ForbiddenException({
          errorCode: error.code,
          message: '본인의 결제 건이 아닙니다.',
        });
      case PAYMENT_ERRORS.NO_REFUNDABLE_LOT:
        // 잔액은 있는데 취소 기한이 지난 lot만 남았다. 상태 문제라 409다.
        return new ConflictException({
          errorCode: error.code,
          message: '취소 기한이 지나 환불할 수 있는 결제 건이 없습니다.',
        });
      case PAYMENT_ERRORS.INVALID_AMOUNT:
        return new BadRequestException({
          errorCode: error.code,
          message: '1,000원 단위로 100만원까지 충전할 수 있습니다.',
        });
      default:
        // 금액 불일치와 미결제는 요청이 옳고 상태가 아닌 것이라 409다.
        return new ConflictException({
          errorCode: error.code,
          message: MESSAGES[error.code],
        });
    }
  }

  return error;
}

const MESSAGES: Record<string, string> = {
  [PAYMENT_ERRORS.AMOUNT_MISMATCH]:
    '결제 금액이 맞지 않아 충전하지 않았습니다.',
  [PAYMENT_ERRORS.NOT_PAID]: '아직 결제가 완료되지 않았습니다.',
  [PAYMENT_ERRORS.INSUFFICIENT_BALANCE]:
    '이미 사용한 포인트는 환불할 수 없습니다. 잔액을 확인해 주세요.',
};
