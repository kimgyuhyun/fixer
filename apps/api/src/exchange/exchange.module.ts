import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationModule } from '../notification/notification.module';
import { NotificationService } from '../notification/notification.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EnvAccountCipher } from './account-cipher';
import { ExchangeAccountController } from './exchange-account.controller';
import {
  ExchangeAccountService,
  StubAccountVerifier,
} from './exchange-account.service';
import { ExchangeRequestController } from './exchange-request.controller';
import { ExchangeRequestService } from './exchange-request.service';
import { PrismaExchangeAccountStore } from './prisma-exchange-account.store';
import { PrismaExchangeRequestStore } from './prisma-exchange-request.store';

/**
 * 환전. 지금은 계좌 등록(#30)까지다.
 *
 * 검증기와 암복호화가 **둘 다 포트 뒤에 있다** (ADR-PAY-5 · ADR-PAY-6).
 * 실결제 전환은 `StubAccountVerifier`를 `PortOneAccountVerifier`로,
 * 키 관리를 강화할 때는 `EnvAccountCipher`를 KMS 구현체로 바꿔 끼운다.
 */
@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [ExchangeAccountController, ExchangeRequestController],
  providers: [
    PrismaExchangeAccountStore,
    PrismaExchangeRequestStore,
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
        // 포트로 받는다. 이 서비스는 알림이 인앱인지 메일인지 모른다 (#36).
        notifications: NotificationService,
      ) => new ExchangeAccountService(store, cipher, verifier, notifications),
      inject: [
        PrismaExchangeAccountStore,
        EnvAccountCipher,
        StubAccountVerifier,
        NotificationService,
      ],
    },
    {
      // 저장소 하나가 요청 쓰기와 성숙액 읽기 둘 다 한다. 성숙액이 읽기 전용
      // 집계라 파일을 나눌 이유가 없다 (#31).
      provide: ExchangeRequestService,
      useFactory: (
        requests: PrismaExchangeRequestStore,
        accounts: PrismaExchangeAccountStore,
      ) => new ExchangeRequestService(requests, accounts, requests),
      inject: [PrismaExchangeRequestStore, PrismaExchangeAccountStore],
    },
  ],
  exports: [ExchangeAccountService],
})
export class ExchangeModule {}
