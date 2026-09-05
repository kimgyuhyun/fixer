import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { CategoryController } from './category.controller';
import type { CategoryService } from './category.service';

const ACTIVE = [
  {
    id: 'cat_1',
    name: '청소',
    slug: 'cleaning',
    sortOrder: 1,
    placeholderText: '평수와 방 개수를 적어 주세요.',
  },
];

describe('GET /categories', () => {
  it('should return 200 with the active categories', async () => {
    const listActive = vi.fn().mockResolvedValue(ACTIVE);
    const controller = new CategoryController({
      listActive,
    } as unknown as CategoryService);

    await expect(controller.list()).resolves.toEqual(ACTIVE);
  });

  it('should not leak isActive to the response', async () => {
    // 비활성 여부는 서버가 판단할 일이다. 응답에 실으면 보이지 않을 뿐
    // 브라우저에서는 보인다.
    const listActive = vi
      .fn()
      .mockResolvedValue([{ ...ACTIVE[0], isActive: true }]);
    const controller = new CategoryController({
      listActive,
    } as unknown as CategoryService);

    const list = await controller.list();

    expect(list[0]).not.toHaveProperty('isActive');
  });
});
