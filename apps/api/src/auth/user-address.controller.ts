import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ADDRESS_ERRORS,
  registerAddressRequestSchema,
  registeredAddressSchema,
  type AddressErrorCode,
  type RegisteredAddress,
} from '@fixer/shared';
import { ZodError } from 'zod';
import { CurrentMember, MemberGuard } from './member.guard';
import { UserAddressError, UserAddressService } from './user-address.service';
import { UserAddressHttpError } from './user-address.http-error';

/**
 * 주소 등록. 가입 흐름 4단계(`spec-fixed.md` §2.2)와 마이페이지에서 불린다.
 *
 * 회원은 경로가 아니라 **세션의 주체**다. 가입이 성공하면 세션이 열리므로
 * (ADR-AUTH-5) 가입 직후에도 가드를 지난다. 경로에 `:userId`를 남기지 않는
 * 이유는, 남겨 두면 "경로의 id는 무시된다"는 함정이 되기 때문이다. (#82)
 */
@Controller('members/me/addresses')
export class UserAddressController {
  constructor(private readonly service: UserAddressService) {}

  /** 주소 등록 */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(MemberGuard)
  async register(
    @CurrentMember() userId: string,
    @Body() body: unknown,
  ): Promise<RegisteredAddress> {
    try {
      // 컨트롤러가 입력을 먼저 검증한다. 서비스는 이미 검증된 값을 받는다.
      const input = registerAddressRequestSchema.parse(body);
      const result = await this.service.register(userId, input);
      // 응답도 공유 스키마로 파싱한다. 스키마에 자리가 없는 값은 여기서
      // 떨어져 나가므로 서비스가 실수로 얹어 보내도 밖으로 새지 않는다.
      return registeredAddressSchema.parse(result);
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

/**
 * 도메인 에러를 HTTP 상태로 옮긴다. 서비스는 HTTP를 모른다.
 *
 * 좌표 변환 실패는 여기에 없다. AC3이 그것을 실패로 보지 않기로 했으므로
 * `lat`/`lng`가 `null`인 201로 나간다.
 */
const STATUS_BY_CODE: Record<AddressErrorCode, HttpStatus> = {
  [ADDRESS_ERRORS.MEMBER_NOT_FOUND]: HttpStatus.NOT_FOUND,
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

  if (error instanceof UserAddressError) {
    return new UserAddressHttpError(error.code, STATUS_BY_CODE[error.code]);
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
