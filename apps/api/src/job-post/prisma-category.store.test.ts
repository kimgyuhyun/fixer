import { describe, expect, it, vi } from 'vitest';
import { PrismaCategoryStore } from './prisma-category.store';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * **실제로 거르고 정렬하는 코드는 여기 하나뿐이다.**
 *
 * 서비스 테스트의 가짜 저장소는 자기가 필터·정렬을 하므로 이 쿼리의 정확성을
 * 증명하지 못한다. 그래서 `findMany`에 무엇을 넘기는지를 직접 단언한다.
 * 실제 DB로 확인하는 것은 Testcontainers 통합 테스트의 몫이다.
 */
function storeWith(findMany: ReturnType<typeof vi.fn>) {
  return new PrismaCategoryStore({
    category: { findMany },
  } as unknown as PrismaService);
}

describe('PrismaCategoryStore.listActive', () => {
  it('should ask only for active categories', async () => {
    const findMany = vi.fn().mockResolvedValue([]);

    await storeWith(findMany).listActive();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it('should ask for them ordered by sortOrder ascending', async () => {
    const findMany = vi.fn().mockResolvedValue([]);

    await storeWith(findMany).listActive();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { sortOrder: 'asc' } }),
    );
  });

  it('should return the rows as the database gave them', async () => {
    // 저장소가 다시 거르거나 정렬하지 않는다. 그건 DB가 할 일이다.
    const rows = [
      {
        id: 'cat_1',
        name: '청소',
        slug: 'cleaning',
        sortOrder: 1,
        placeholderText: '평수와 방 개수를 적어 주세요.',
        isActive: true,
      },
    ];
    const findMany = vi.fn().mockResolvedValue(rows);

    await expect(storeWith(findMany).listActive()).resolves.toBe(rows);
  });
});
