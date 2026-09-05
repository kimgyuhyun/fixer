import { describe, expect, it } from 'vitest';
import { categorySchema } from './category.js';

const VALID = {
  id: 'cat_1',
  name: '청소',
  slug: 'cleaning',
  sortOrder: 1,
  placeholderText: '평수와 방 개수, 필요한 청소 도구를 적어 주세요.',
};

describe('categorySchema', () => {
  it('should carry placeholderText through unchanged', () => {
    // 이 문구가 그대로 화면에 뜬다. 중간에서 다듬지 않는다.
    expect(categorySchema.parse(VALID).placeholderText).toBe(
      VALID.placeholderText,
    );
  });

  it('should reject a category whose placeholderText is empty', () => {
    // 문구가 없으면 이 카테고리는 이 기능의 목적을 못 채운다.
    expect(() =>
      categorySchema.parse({ ...VALID, placeholderText: '' }),
    ).toThrow();
  });
});
