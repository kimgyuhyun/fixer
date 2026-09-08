import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaSuspensionReader } from './suspension.reader';

/**
 * 제재 도메인. (이슈 #25, `spec-fixed.md` §5)
 *
 * 컨트롤러가 없다. 이 이슈의 표면은 **공고 등록·지원을 막는 판정 하나**뿐이고,
 * 경고를 쓰는 것은 신청 도메인의 트랜잭션이다(`penalty-transaction.ts`).
 * 블랙리스트 화면과 조기 해제 API는 #33이 여기 붙인다.
 */
@Module({
  imports: [PrismaModule],
  providers: [PrismaSuspensionReader],
  exports: [PrismaSuspensionReader],
})
export class PenaltyModule {}
