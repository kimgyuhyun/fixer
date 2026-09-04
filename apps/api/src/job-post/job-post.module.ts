import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';
import { PrismaCategoryStore } from './prisma-category.store';

/** 공고 도메인. 지금은 카테고리(#11)뿐이고 공고 자체는 #12가 붙인다 */
@Module({
  imports: [PrismaModule],
  controllers: [CategoryController],
  providers: [
    PrismaCategoryStore,
    {
      provide: CategoryService,
      useFactory: (store: PrismaCategoryStore) => new CategoryService(store),
      inject: [PrismaCategoryStore],
    },
  ],
  exports: [CategoryService],
})
export class JobPostModule {}
