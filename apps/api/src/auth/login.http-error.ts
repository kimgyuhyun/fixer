import { HttpException, HttpStatus } from '@nestjs/common';
import { LOGIN_ERRORS, type LoginErrorCode } from '@fixer/shared';

/**
 * 화면이 보여줄 문구와 프로그램이 분기할 코드를 함께 담는다.
 *
 * `SignupHttpError`(#2)와 같은 모양이다. 문구는 바뀌어도 코드는 바뀌지
 * 않으므로, 웹은 errorCode로만 분기하고 message는 그대로 출력한다.
 */
export class LoginHttpError extends HttpException {
  constructor(errorCode: LoginErrorCode) {
    super(
      { errorCode, message: MESSAGES[errorCode] },
      // 둘 다 "당신이 누구인지 확인되지 않았다"는 뜻이라 401이다.
      HttpStatus.UNAUTHORIZED,
    );
  }
}

const MESSAGES: Record<LoginErrorCode, string> = {
  // 어느 쪽이 틀렸는지 좁혀 말하지 않는다. 좁히는 순간 이메일만 넣어보고
  // 가입 여부를 알아낼 수 있다. (AC2)
  [LOGIN_ERRORS.INVALID_CREDENTIALS]:
    '이메일 또는 비밀번호가 올바르지 않습니다.',
  [LOGIN_ERRORS.UNAUTHENTICATED]: '로그인이 필요합니다.',
};
