import { describe, expect, it } from 'vitest';
import {
  adminJobPostFilterSchema,
  adminSuspensionFilterSchema,
} from './admin.js';

describe('adminJobPostFilterSchema', () => {
  it('should fall back to page 1 when page is 0 or not a number', () => {
    expect(adminJobPostFilterSchema.parse({ page: '0' }).page).toBe(1);
    expect(adminJobPostFilterSchema.parse({ page: 'abc' }).page).toBe(1);
    expect(adminJobPostFilterSchema.parse({}).page).toBe(1);
  });
});

describe('adminSuspensionFilterSchema', () => {
  // 관리자 공고 목록이 이미 "잘못된 page는 오류가 아니라 1"이다 (#35).
  // 블랙리스트만 다르면 관리자 화면 안에서 규칙이 갈라진다.
  it('should fall back to page 1 when page is 0 or not a number', () => {
    expect(adminSuspensionFilterSchema.parse({ page: '0' }).page).toBe(1);
    expect(adminSuspensionFilterSchema.parse({ page: 'abc' }).page).toBe(1);
    expect(adminSuspensionFilterSchema.parse({}).page).toBe(1);
  });
});
