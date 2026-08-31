import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import type { RegisteredAddress } from '@fixer/shared';
import { UserAddressService } from './user-address.service';

/**
 * 주소 등록. 가입 흐름 4단계(`spec-fixed.md` §2.2)에서 불린다.
 *
 * FIXME(#4): `userId`를 경로에서 그대로 받는다. 주소 입력은 로그인 이전
 * 단계라 아직 토큰이 없기 때문이다(#3의 선행은 #2이지 #4가 아니다).
 * #4가 인증 가드를 들고 오면 경로 대신 토큰의 주체를 쓴다.
 * `docs/result/security-exceptions.md`에 기록돼 있다.
 */
@Controller('members/:userId/addresses')
export class UserAddressController {
  constructor(private readonly service: UserAddressService) {}

  /** 주소 등록 */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  register(
    @Param('userId') _userId: string,
    @Body() _body: unknown,
  ): Promise<RegisteredAddress> {
    throw new Error('not implemented');
  }
}
