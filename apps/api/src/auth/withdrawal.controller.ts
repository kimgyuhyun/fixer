import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { WITHDRAWAL_ERRORS } from '@fixer/shared';
import {
  MemberNotFoundError,
  WithdrawalBlockedError,
  WithdrawalService,
} from './withdrawal.service';

/**
 * 탈퇴의 HTTP 경계. (이슈 #9)
 *
 * 보류 사유를 **전부** 응답에 담는다. 하나씩 알려주면 사용자가 고치고 다시
 * 시도하기를 세 번 반복한다. 본인 계정의 상태라 감출 정보도 아니다.
 */
@Controller('auth')
export class WithdrawalController {
  constructor(private readonly service: WithdrawalService) {}

  @Post('withdraw')
  @HttpCode(HttpStatus.NO_CONTENT)
  async withdraw(@Body() body: unknown): Promise<void> {
    // TODO(#4 머지 후): 토큰의 주체로 바꾼다. 지금은 본문에서 읽는다.
    const userId = (body as { userId?: unknown }).userId;
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new BadRequestException({
        errorCode: 'VALIDATION_FAILED',
        message: '회원 정보가 없습니다.',
      });
    }

    try {
      await this.service.withdraw(userId, new Date());
    } catch (error) {
      if (error instanceof WithdrawalBlockedError) {
        // 409다. 요청 자체는 옳고 지금 상태가 아닐 뿐이다.
        throw new ConflictException({
          errorCode: error.code,
          message: '아직 탈퇴할 수 없습니다.',
          reasons: error.reasons,
        });
      }
      if (error instanceof MemberNotFoundError) {
        throw new NotFoundException({
          errorCode: WITHDRAWAL_ERRORS.NOT_FOUND,
          message: '회원을 찾을 수 없습니다.',
        });
      }
      throw error;
    }
  }
}
