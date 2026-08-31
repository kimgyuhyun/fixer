import { HttpException, HttpStatus } from '@nestjs/common';
import { SIGNUP_ERRORS, type SignupErrorCode } from '@fixer/shared';

/**
 * 화면이 보여줄 문구와 프로그램이 분기할 코드를 함께 담는다.
 *
 * `EmailVerificationHttpError`(#1)와 같은 모양이다. 문구는 바뀌어도 코드는
 * 바뀌지 않으므로, 웹은 errorCode로만 분기하고 message는 그대로 출력한다.
 */
export class SignupHttpError extends HttpException {
  constructor(errorCode: SignupErrorCode, status: HttpStatus) {
    super({ errorCode, message: MESSAGES[errorCode] }, status);
  }
}

const MESSAGES: Record<SignupErrorCode, string> = {
  [SIGNUP_ERRORS.EMAIL_NOT_VERIFIED]: '이메일 인증을 먼저 마쳐 주세요.',
  [SIGNUP_ERRORS.EMAIL_ALREADY_EXISTS]: '이미 가입된 이메일입니다.',
};
