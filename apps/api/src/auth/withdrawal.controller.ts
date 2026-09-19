import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { WithdrawalService } from './withdrawal.service';

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
  async withdraw(_userId: string): Promise<void> {
    throw new Error('not implemented');
  }
}
