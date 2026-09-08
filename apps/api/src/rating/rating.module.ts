import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaRatingStore } from './prisma-rating.store';
import { RatingController } from './rating.controller';
import { RatingService } from './rating.service';

/** 평점 도메인. 거래 후 별점 입력과 역할별 평균 조회 (#26) */
@Module({
  imports: [PrismaModule],
  controllers: [RatingController],
  providers: [
    PrismaRatingStore,
    {
      provide: RatingService,
      useFactory: (store: PrismaRatingStore) => new RatingService(store),
      inject: [PrismaRatingStore],
    },
  ],
  exports: [RatingService],
})
export class RatingModule {}
