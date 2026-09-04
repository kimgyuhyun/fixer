import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { ChargeService } from './charge.service';
import { PointController } from './point.controller';
import { PointHistoryService } from './point-history.service';
import { PointLedgerService } from './point-ledger.service';
import { FakePaymentGateway, PortOneWebhookVerifier } from './portone.gateway';
import { PrismaPaymentStore } from './prisma-payment.store';
import { PrismaPointLedgerStore } from './prisma-point-ledger.store';
import { PrismaRefundStore } from './prisma-refund.store';
import { RefundService } from './refund.service';

/**
 * 포인트 원장과 충전. (이슈 #27, #28)
 *
 * 원장 쓰기가 한 곳에 모여 있어야 잔액이 어긋날 자리가 없다. 충전도 환전도
 * 이 모듈의 `PointLedgerService`를 거친다.
 *
 * 결제 게이트웨이는 **포트 뒤에 있다** (ADR-PAY-5). 실결제 전환은
 * `FakePaymentGateway`를 `PortOneGateway`로 바꿔 끼우는 것으로 끝난다.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PointController],
  providers: [
    PrismaPointLedgerStore,
    PrismaPaymentStore,
    PrismaRefundStore,
    {
      provide: PointLedgerService,
      useFactory: (store: PrismaPointLedgerStore) =>
        new PointLedgerService(store),
      inject: [PrismaPointLedgerStore],
    },
    {
      provide: PointHistoryService,
      useFactory: (store: PrismaPointLedgerStore) =>
        new PointHistoryService(store),
      inject: [PrismaPointLedgerStore],
    },
    {
      provide: FakePaymentGateway,
      useFactory: (payments: PrismaPaymentStore) =>
        new FakePaymentGateway(payments),
      inject: [PrismaPaymentStore],
    },
    {
      provide: PortOneWebhookVerifier,
      useFactory: (config: ConfigService) => new PortOneWebhookVerifier(config),
      inject: [ConfigService],
    },
    {
      provide: ChargeService,
      useFactory: (
        payments: PrismaPaymentStore,
        gateway: FakePaymentGateway,
        ledger: PointLedgerService,
        webhooks: PortOneWebhookVerifier,
      ) => new ChargeService(payments, gateway, ledger, webhooks),
      inject: [
        PrismaPaymentStore,
        FakePaymentGateway,
        PointLedgerService,
        PortOneWebhookVerifier,
      ],
    },
    {
      provide: RefundService,
      useFactory: (lots: PrismaRefundStore, ledger: PointLedgerService) =>
        new RefundService(lots, ledger),
      inject: [PrismaRefundStore, PointLedgerService],
    },
  ],
  exports: [PointLedgerService, ChargeService, RefundService],
})
export class PointModule {}
