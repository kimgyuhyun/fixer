import { describe, expect, it } from 'vitest';
import {
  CategoryService,
  type CategoryRecord,
  type CategoryStore,
} from './category.service';

function category(overrides: Partial<CategoryRecord> = {}): CategoryRecord {
  return {
    id: 'cat_1',
    name: '청소',
    slug: 'cleaning',
    sortOrder: 1,
    placeholderText: '평수와 방 개수를 적어 주세요.',
    isActive: true,
    ...overrides,
  };
}

/**
 * 활성 필터와 정렬을 **저장소가** 한다. 서비스가 다시 거르면 어느 쪽이
 * 책임인지 흐려지므로, 가짜 저장소도 진짜와 같은 일을 한다.
 */
class FakeCategoryStore implements CategoryStore {
  constructor(private readonly rows: CategoryRecord[]) {}

  listActive(): Promise<CategoryRecord[]> {
    return Promise.resolve(
      this.rows
        .filter((row) => row.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    );
  }
}

function setup(rows: CategoryRecord[]) {
  const store = new FakeCategoryStore(rows);
  return { service: new CategoryService(store), store };
}

describe('listActive', () => {
  it('should return only active categories', async () => {
    const { service } = setup([
      category({ id: 'cat_1', slug: 'cleaning', isActive: true }),
      category({ id: 'cat_2', slug: 'moving', isActive: false }),
    ]);

    const list = await service.listActive();

    expect(list.map((c) => c.slug)).toEqual(['cleaning']);
  });

  it('should order the categories by sortOrder ascending', async () => {
    const { service } = setup([
      category({ id: 'cat_1', slug: 'moving', sortOrder: 3 }),
      category({ id: 'cat_2', slug: 'cleaning', sortOrder: 1 }),
      category({ id: 'cat_3', slug: 'delivery', sortOrder: 2 }),
    ]);

    const list = await service.listActive();

    expect(list.map((c) => c.slug)).toEqual(['cleaning', 'delivery', 'moving']);
  });

  it('should return an empty array when every category is inactive', async () => {
    const { service } = setup([
      category({ id: 'cat_1', isActive: false }),
      category({ id: 'cat_2', slug: 'moving', isActive: false }),
    ]);

    await expect(service.listActive()).resolves.toEqual([]);
  });
});
