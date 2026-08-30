import { HttpException, HttpStatus } from '@nestjs/common';
import {
  EMAIL_VERIFICATION_ERRORS,
  type EmailVerificationErrorCode,
} from '@fixer/shared';

/**
 * 화면이 보여줄 문구와 프로그램이 분기할 코드를 함께 담는다.
 *
 * 문구는 바뀌어도 코드는 바뀌지 않으므로, 웹은 errorCode로만 분기하고
 * message는 그대로 출력한다.
 */
export class EmailVerificationHttpError extends HttpException {
  constructor(errorCode: EmailVerificationErrorCode, status: HttpStatus) {
    super({ errorCode, message: MESSAGES[errorCode] }, status);
  }
}

const MESSAGES: Record<EmailVerificationErrorCode, string> = {
  [EMAIL_VERIFICATION_ERRORS.EXPIRED]:
    '인증 코드가 만료되었습니다. 다시 요청해 주세요.',
  [EMAIL_VERIFICATION_ERRORS.INVALID]: '인증 코드가 올바르지 않습니다.',
  [EMAIL_VERIFICATION_ERRORS.ATTEMPTS_EXCEEDED]:
    '입력 횟수를 초과했습니다. 코드를 다시 요청해 주세요.',
  [EMAIL_VERIFICATION_ERRORS.RESEND_COOLDOWN]:
    '조금 뒤에 다시 요청할 수 있습니다.',
  [EMAIL_VERIFICATION_ERRORS.RESEND_LIMIT_EXCEEDED]:
    '요청이 너무 많습니다. 한 시간 뒤에 다시 시도해 주세요.',
};
