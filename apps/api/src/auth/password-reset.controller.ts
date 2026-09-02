import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  PASSWORD_RESET_ERRORS,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from '@fixer/shared';
import { ZodError } from 'zod';
import {
  PasswordResetError,
  PasswordResetService,
} from './password-reset.service';

/**
 * 비밀번호 재설정의 HTTP 경계. (이슈 #6)
 *
 * 둘 다 204다. 본문에 실을 것이 없고, **있고 없고를 응답으로 구분하지 않는 것이
 * 이 기능의 요건**이기 때문이다.
 */
@Controller('auth')
export class PasswordResetController {
  constructor(private readonly service: PasswordResetService) {}

  /** 재설정 메일 요청. 회원이 없어도 204다 */
  @Post('password-reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  async request(@Body() body: unknown): Promise<void> {
    try {
      const input = passwordResetRequestSchema.parse(body);
      await this.service.requestReset(input.email, new Date());
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** 새 비밀번호 설정 */
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirm(@Body() body: unknown): Promise<void> {
    try {
      const input = passwordResetConfirmSchema.parse(body);
      await this.service.resetPassword(input, new Date());
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

/**
 * 도메인 에러를 HTTP로 옮긴다. 토큰이 왜 못 쓰는지는 구분하지 않는다 —
 * 구분하면 토큰을 넣어보며 상태를 알아낼 수 있고, 사용자가 할 일은 어느
 * 쪽이든 "다시 요청하기"로 같다.
 */
function toHttpError(error: unknown): unknown {
  if (error instanceof PasswordResetError) {
    return new BadRequestException({
      errorCode: error.code,
      message: '재설정 링크가 유효하지 않습니다. 다시 요청해 주세요.',
    });
  }

  if (error instanceof ZodError) {
    return new BadRequestException({
      errorCode: PASSWORD_RESET_ERRORS.TOKEN_INVALID,
      message: error.issues[0]?.message ?? '입력값을 확인해 주세요.',
      fieldErrors: Object.fromEntries(
        error.issues.map((issue) => [
          String(issue.path[0] ?? ''),
          issue.message,
        ]),
      ),
    });
  }

  return error;
}
