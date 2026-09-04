import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  SIGNUP_ERRORS,
  signedUpSchema,
  signupRequestSchema,
  type SignedUp,
  type SignupErrorCode,
} from '@fixer/shared';
import { ZodError } from 'zod';
import { SignupError, SignupService } from './signup.service';
import { SignupHttpError } from './signup.http-error';

@Controller('auth/signup')
export class SignupController {
  constructor(private readonly service: SignupService) {}

  /** 가입 */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body() body: unknown): Promise<SignedUp> {
    try {
      // 컨트롤러가 입력을 먼저 검증한다. 서비스는 이미 검증된 값을 받는다.
      const input = signupRequestSchema.parse(body);
      const result = await this.service.signup(input);
      // 응답도 공유 스키마로 파싱한다. 서비스가 실수로 해시를 얹어 보내도
      // 스키마에 자리가 없어 여기서 떨어져 나간다.
      return signedUpSchema.parse(result);
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

/**
 * 도메인 에러를 HTTP 상태로 옮긴다. 서비스는 HTTP를 모른다.
 *
 * 인증 안 됨이 400이 아닌 이유: 요청의 *모양*은 옳고 계정 *상태*가 허락하지
 * 않는 것이라 403이다. 409는 "이미 있다"는 충돌이므로 중복에 쓴다.
 */
const STATUS_BY_CODE: Record<SignupErrorCode, HttpStatus> = {
  [SIGNUP_ERRORS.EMAIL_NOT_VERIFIED]: HttpStatus.FORBIDDEN,
  [SIGNUP_ERRORS.EMAIL_ALREADY_EXISTS]: HttpStatus.CONFLICT,
  // 중복과 같은 409다. 상태가 아니라 코드로 갈라야 웹이 안내를 바꾼다.
  [SIGNUP_ERRORS.REACTIVATION_AVAILABLE]: HttpStatus.CONFLICT,
};

function toHttpError(error: unknown): unknown {
  // 입력 검증 실패는 사용자 잘못이므로 400이다. 그대로 두면 500이 되어
  // "서버가 고장났다"는 잘못된 신호를 준다.
  if (error instanceof ZodError) {
    return new BadRequestException({
      errorCode: 'VALIDATION_FAILED',
      message: '입력값을 확인해 주세요.',
      // 어느 칸이 잘못됐는지 화면이 그 칸 아래에 표시할 수 있어야 한다.
      fieldErrors: toFieldErrors(error),
    });
  }

  if (error instanceof SignupError) {
    return new SignupHttpError(error.code, STATUS_BY_CODE[error.code]);
  }

  // 우리가 아는 도메인 에러가 아니면 그대로 올려보내 500이 되게 둔다.
  // 여기서 삼키면 원인 모를 400이 되어 디버깅이 어려워진다.
  return error;
}

/** zod 오류를 `{ 필드명: [문구] }` 모양으로 모은다 */
function toFieldErrors(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = issue.path.join('.');
    if (field === '') continue;
    (fieldErrors[field] ??= []).push(issue.message);
  }

  return fieldErrors;
}
