import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { EnvAccountCipher } from './account-cipher';
import { ExchangeAccountController } from './exchange-account.controller';
import {
  ExchangeAccountService,
  StubAccountVerifier,
} from './exchange-account.service';
import { PrismaExchangeAccountStore } from './prisma-exchange-account.store';

/**
 * 환전. 지금은 계좌 등록(#30)까지다.
 *
 * 검증기와 암복호화가 **둘 다 포트 뒤에 있다** (ADR-PAY-5 · ADR-PAY-6).
 * 실결제 전환은 `StubAccountVerifier`를 `PortOneAccountVerifier`로,
 * 키 관리를 강화할 때는 `EnvAccountCipher`를 KMS 구현체로 바꿔 끼운다.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ExchangeAccountController],
  providers: [
    PrismaExchangeAccountStore,
    StubAccountVerifier,
    {
      provide: EnvAccountCipher,
      useFactory: (config: ConfigService) => new EnvAccountCipher(config),
      inject: [ConfigService],
    },
    {
      provide: ExchangeAccountService,
      useFactory: (
        store: PrismaExchangeAccountStore,
        cipher: EnvAccountCipher,
        verifier: StubAccountVerifier,
      ) => new ExchangeAccountService(store, cipher, verifier),
      inject: [
        PrismaExchangeAccountStore,
        EnvAccountCipher,
        StubAccountVerifier,
      ],
    },
  ],
  exports: [ExchangeAccountService],
})
export class ExchangeModule {}
