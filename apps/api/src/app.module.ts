import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgreementModule } from './agreement/agreement.module';
import { ApplicationModule } from './application/application.module';
import { AuthModule } from './auth/auth.module';
import { PointModule } from './point/point.module';
import { JobPostModule } from './job-post/job-post.module';
import { NotificationModule } from './notification/notification.module';
import { HealthModule } from './health/health.module';
import { ExchangeModule } from './exchange/exchange.module';
import { PrismaModule } from './prisma/prisma.module';
import { RetentionModule } from './retention/retention.module';

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
    PointModule,
    AgreementModule,
    RetentionModule,
    JobPostModule,
    ApplicationModule,
    ExchangeModule,
    NotificationModule,
  ],
})
export class AppModule {}
