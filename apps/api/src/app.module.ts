import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgreementModule } from './agreement/agreement.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    // isGlobal이라 각 모듈에서 ConfigModule을 다시 import하지 않아도 ConfigService가 주입된다.
    // 환경변수는 저장소 루트 .env 하나만 쓴다.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    AgreementModule,
  ],
})
export class AppModule {}
