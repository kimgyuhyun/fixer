import {
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { WITHDRAWAL_ERRORS } from '@fixer/shared';
import { CurrentMember, MemberGuard } from './member.guard';
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
 *
 * **탈퇴하는 사람은 쿠키에서 온다** (#71). 요청에 실려 온 회원 id는 닿을 곳이
 * 없다 — 이 핸들러가 받는 것이 토큰의 주체 하나뿐이다. id만 알면 남의 계정을
 * 탈퇴시킬 수 있었고, 되돌리려면 재활성화(#10)를 거쳐야 한다.
 */
@Controller('auth')
export class WithdrawalController {
  constructor(private readonly service: WithdrawalService) {}

  @Post('withdraw')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(MemberGuard)
  async withdraw(@CurrentMember() userId: string): Promise<void> {
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
