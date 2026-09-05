import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CategoryRecord, CategoryStore } from './category.service';

/**
 * `Category` 테이블에 붙는 어댑터.
 *
 * **거르고 정렬하는 것을 여기서 한다.** 화면이 전부 받아서 거르면 비활성
 * 카테고리의 이름과 문구가 응답에 실려 나간다 — 보이지 않을 뿐 브라우저에서는 보인다.
 */
@Injectable()
export class PrismaCategoryStore implements CategoryStore {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(): Promise<CategoryRecord[]> {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
