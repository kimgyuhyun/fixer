import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  EMAIL_VERIFICATION_ERRORS,
  emailVerificationRequestSchema,
  emailVerificationSentSchema,
  emailVerifiedSchema,
  verifyEmailCodeRequestSchema,
  type EmailVerificationErrorCode,
  type EmailVerificationSent,
  type EmailVerified,
} from '@fixer/shared';
import { BadRequestException } from '@nestjs/common';
import { ZodError } from 'zod';
import { EmailVerificationService } from './email-verification.service';
import { EmailVerificationHttpError } from './email-verification.http-error';

@Controller('auth/email-verification')
export class EmailVerificationController {
  constructor(private readonly service: EmailVerificationService) {}

  /** 인증 코드 발급 요청 */
  @Post()
  @HttpCode(HttpStatus.OK)
  async request(@Body() body: unknown): Promise<EmailVerificationSent> {
    try {
      // 컨트롤러가 입력을 먼저 검증한다. 서비스는 이미 검증된 값을 받는다.
      const { email } = emailVerificationRequestSchema.parse(body);
      const result = await this.service.requestCode(email);
      // 응답도 공유 스키마로 파싱해 웹과 규격이 어긋나지 않게 한다.
      return emailVerificationSentSchema.parse(result);
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** 코드 검증 */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(@Body() body: unknown): Promise<EmailVerified> {
    try {
      const { email, code } = verifyEmailCodeRequestSchema.parse(body);
      const result = await this.service.verifyCode(email, code);
      return emailVerifiedSchema.parse(result);
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

/**
 * 도메인 에러의 메시지에 담긴 코드를 HTTP 상태로 옮긴다.
 *
 * 서비스는 HTTP를 모른다. 상태 코드 매핑은 이 경계에서만 한다.
 */
const STATUS_BY_CODE: Record<EmailVerificationErrorCode, HttpStatus> = {
  [EMAIL_VERIFICATION_ERRORS.EXPIRED]: HttpStatus.BAD_REQUEST,
  [EMAIL_VERIFICATION_ERRORS.INVALID]: HttpStatus.BAD_REQUEST,
  [EMAIL_VERIFICATION_ERRORS.ATTEMPTS_EXCEEDED]: HttpStatus.TOO_MANY_REQUESTS,
  [EMAIL_VERIFICATION_ERRORS.RESEND_COOLDOWN]: HttpStatus.TOO_MANY_REQUESTS,
  [EMAIL_VERIFICATION_ERRORS.RESEND_LIMIT_EXCEEDED]:
    HttpStatus.TOO_MANY_REQUESTS,
};

function toHttpError(error: unknown): unknown {
  // 입력 검증 실패는 사용자 잘못이므로 400이다. 그대로 두면 500이 되어
  // "서버가 고장났다"는 잘못된 신호를 준다.
  if (error instanceof ZodError) {
    return new BadRequestException({
      errorCode: 'VALIDATION_FAILED',
      message: '입력값을 확인해 주세요.',
    });
  }

  const message = error instanceof Error ? error.message : '';
  const matched = (
    Object.values(EMAIL_VERIFICATION_ERRORS) as EmailVerificationErrorCode[]
  ).find((code) => message.includes(code));

  if (!matched) {
    // 우리가 아는 도메인 에러가 아니면 그대로 올려보내 500이 되게 둔다.
    // 여기서 삼키면 원인 모를 400이 되어 디버깅이 어려워진다.
    return error;
  }

  return new EmailVerificationHttpError(matched, STATUS_BY_CODE[matched]);
}
