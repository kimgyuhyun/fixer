import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AccessTokenSigner } from './access-token';
import { ConsoleMailProvider } from './console-mail.provider';
import { LoginController } from './login.controller';
import { LoginService } from './login.service';
import { PrismaRefreshTokenStore } from './prisma-refresh-token.store';
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
  controllers: [EmailVerificationController, SignupController, LoginController],
  providers: [
    PrismaEmailVerificationStore,
    PrismaUserStore,
    PrismaRefreshTokenStore,
    ConsoleMailProvider,
    {
      // 서명 비밀키는 코드에 두지 않는다. 없으면 켜지지 않게 한다 —
      // 기본값을 주면 그 값으로 서명된 토큰을 누구나 만들 수 있다.
      provide: AccessTokenSigner,
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('AUTH_JWT_SECRET');
        if (!secret) {
          throw new Error(
            'AUTH_JWT_SECRET이 없습니다. 저장소 루트의 .env를 확인하세요 (.env.example 참고).',
          );
        }
        return new AccessTokenSigner({ secret });
      },
      inject: [ConfigService],
    },
    {
      provide: LoginService,
      useFactory: (
        users: PrismaUserStore,
        refreshTokens: PrismaRefreshTokenStore,
        accessTokens: AccessTokenSigner,
      ) => new LoginService(users, refreshTokens, accessTokens),
      inject: [PrismaUserStore, PrismaRefreshTokenStore, AccessTokenSigner],
    },
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
  exports: [EmailVerificationService, SignupService, LoginService],
})
export class AuthModule {}
