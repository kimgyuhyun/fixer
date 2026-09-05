import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common';
import {
  REACTIVATION_ERRORS,
  reactivateRequestSchema,
  signedUpSchema,
  type SignedUp,
} from '@fixer/shared';
import { ZodError } from 'zod';
import { ReactivationError, ReactivationService } from './reactivation.service';

/**
 * 재활성화의 HTTP 경계. (이슈 #10)
 *
 * 201이 아니라 200이다. **새로 만든 것이 아니라 되살린 것**이므로
 * 상태 코드부터 그렇게 말한다.
 */
@Controller('auth/reactivate')
export class ReactivationController {
  constructor(private readonly service: ReactivationService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async reactivate(@Body() body: unknown): Promise<SignedUp> {
    try {
      const input = reactivateRequestSchema.parse(body);
      return signedUpSchema.parse(
        await this.service.reactivate(input, new Date()),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

function toHttpError(error: unknown): unknown {
  if (error instanceof ZodError) {
    return new BadRequestException({
      errorCode: 'VALIDATION_FAILED',
      message: '입력값을 확인해 주세요.',
      fieldErrors: toFieldErrors(error),
    });
  }

  if (error instanceof ReactivationError) {
    // 인증 안 됨은 403이다 — 요청의 모양은 옳고 계정 상태가 허락하지 않는다.
    if (error.code === REACTIVATION_ERRORS.EMAIL_NOT_VERIFIED) {
      return new ForbiddenException({
        errorCode: error.code,
        message: '이메일 인증을 먼저 마쳐 주세요.',
      });
    }
    return new NotFoundException({
      errorCode: error.code,
      message: '되살릴 계정이 없습니다.',
    });
  }

  return error;
}

function toFieldErrors(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = issue.path.join('.');
    if (field === '') continue;
    (fieldErrors[field] ??= []).push(issue.message);
  }

  return fieldErrors;
}
