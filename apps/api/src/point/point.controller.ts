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
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  PAYMENT_ERRORS,
  chargeResultSchema,
  confirmChargeRequestSchema,
  pointHistorySchema,
  startedChargeSchema,
  type ChargeResult,
  type PointHistory,
  type StartedCharge,
} from '@fixer/shared';
import type { Request } from 'express';
import { ZodError } from 'zod';
import { ChargeService, PaymentError } from './charge.service';
import { PointHistoryService } from './point-history.service';

/**
 * 충전과 포인트 내역의 HTTP 경계. (이슈 #28)
 *
 * 회원 식별은 아직 본문·쿼리로 받는다. #4의 토큰 주체로 바꾸는 것은 그
 * 브랜치가 머지된 뒤다 — 지금 흉내 내면 두 벌이 된다.
 */
@Controller()
export class PointController {
  constructor(
    private readonly charge: ChargeService,
    private readonly history: PointHistoryService,
  ) {}

  /** 결제창을 열기 전에 서버가 금액을 정한다 */
  @Post('payments')
  @HttpCode(HttpStatus.CREATED)
  async start(@Body() body: unknown): Promise<StartedCharge> {
    const userId = userIdOf(body);
    try {
      return startedChargeSchema.parse(await this.charge.start(userId, body));
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** 결제 확정. 클라이언트가 보내는 것은 식별자 하나뿐이다 */
  @Post('payments/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@Body() body: unknown): Promise<ChargeResult> {
    const userId = userIdOf(body);
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

  /** 포인트 잔액과 내역 */
  @Get('points/me')
  async myPoints(@Query('userId') userId?: string): Promise<PointHistory> {
    if (!userId) {
      throw new BadRequestException({
        errorCode: 'VALIDATION_FAILED',
        message: '회원 정보가 없습니다.',
      });
    }
    return pointHistorySchema.parse(await this.history.read(userId));
  }
}

/** 본문에서 회원 id를 꺼낸다. #4 머지 후 토큰 주체로 바뀐다 */
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
};
