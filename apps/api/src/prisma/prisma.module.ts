import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * @Global이라 다른 모듈은 imports에 PrismaModule을 적지 않아도 PrismaService를 주입받는다.
 * 애플리케이션 전체가 하나의 커넥션 풀을 공유하게 하려는 의도다.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
