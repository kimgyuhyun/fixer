import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConsoleMailProvider } from './console-mail.provider';
import { EmailVerificationController } from './email-verification.controller';
import { EmailVerificationService } from './email-verification.service';
import { PrismaEmailVerificationStore } from './prisma-email-verification.store';

/**
 * 서비스는 포트(인터페이스)만 알고 구현체는 여기서 꽂는다.
 * 나중에 메일러를 Resend로 바꿀 때(#37) 이 파일 한 줄만 고치면 된다.
 */
@Module({
  imports: [PrismaModule],
  controllers: [EmailVerificationController],
  providers: [
    PrismaEmailVerificationStore,
    ConsoleMailProvider,
    {
      provide: EmailVerificationService,
      useFactory: (
        store: PrismaEmailVerificationStore,
        mail: ConsoleMailProvider,
      ) => new EmailVerificationService(store, mail),
      inject: [PrismaEmailVerificationStore, ConsoleMailProvider],
    },
  ],
  exports: [EmailVerificationService],
})
export class AuthModule {}
