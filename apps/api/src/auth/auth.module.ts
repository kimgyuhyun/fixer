import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConsoleMailProvider } from './console-mail.provider';
import { EmailVerificationController } from './email-verification.controller';
import { EmailVerificationService } from './email-verification.service';
import { PrismaEmailVerificationStore } from './prisma-email-verification.store';
import { PrismaUserStore } from './prisma-user.store';
import { SignupController } from './signup.controller';
import { SignupService } from './signup.service';

/**
 * 서비스는 포트(인터페이스)만 알고 구현체는 여기서 꽂는다.
 * 나중에 메일러를 Resend로 바꿀 때(#37) 이 파일 한 줄만 고치면 된다.
 */
@Module({
  imports: [PrismaModule],
  controllers: [EmailVerificationController, SignupController],
  providers: [
    PrismaEmailVerificationStore,
    PrismaUserStore,
    ConsoleMailProvider,
    {
      provide: EmailVerificationService,
      useFactory: (
        store: PrismaEmailVerificationStore,
        mail: ConsoleMailProvider,
      ) => new EmailVerificationService(store, mail),
      inject: [PrismaEmailVerificationStore, ConsoleMailProvider],
    },
    {
      provide: SignupService,
      // 인증 여부는 #1이 쌓은 발급 이력에서 읽는다. 새 테이블을 만들지 않는다.
      useFactory: (
        users: PrismaUserStore,
        verification: PrismaEmailVerificationStore,
      ) => new SignupService(users, verification),
      inject: [PrismaUserStore, PrismaEmailVerificationStore],
    },
  ],
  exports: [EmailVerificationService, SignupService],
})
export class AuthModule {}
