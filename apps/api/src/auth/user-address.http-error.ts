import { HttpException, HttpStatus } from '@nestjs/common';
import { ADDRESS_ERRORS, type AddressErrorCode } from '@fixer/shared';

/**
 * 화면이 보여줄 문구와 프로그램이 분기할 코드를 함께 담는다.
 *
 * `SignupHttpError`(#2)와 같은 모양이다. 문구는 바뀌어도 코드는 바뀌지 않으므로,
 * 웹은 errorCode로만 분기하고 message는 그대로 출력한다.
 */
export class UserAddressHttpError extends HttpException {
  constructor(errorCode: AddressErrorCode, status: HttpStatus) {
    super({ errorCode, message: MESSAGES[errorCode] }, status);
  }
}

const MESSAGES: Record<AddressErrorCode, string> = {
  [ADDRESS_ERRORS.MEMBER_NOT_FOUND]: '회원을 찾을 수 없습니다.',
};
