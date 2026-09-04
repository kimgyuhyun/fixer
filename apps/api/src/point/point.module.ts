import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PointLedgerService } from './point-ledger.service';
import { PrismaPointLedgerStore } from './prisma-point-ledger.store';

/**
 * 포인트 원장. (이슈 #27)
 *
 * **화면도 컨트롤러도 없다.** 충전(#28)·환전(#31) 같은 이슈가 이 서비스를
 * 가져다 쓴다. 원장 쓰기가 한 곳에 모여 있어야 잔액이 어긋날 자리가 없다.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    PrismaPointLedgerStore,
    {
      provide: PointLedgerService,
      useFactory: (store: PrismaPointLedgerStore) =>
        new PointLedgerService(store),
      inject: [PrismaPointLedgerStore],
    },
  ],
  exports: [PointLedgerService],
})
export class PointModule {}
