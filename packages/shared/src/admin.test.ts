import { describe, expect, it } from 'vitest';
import { adminJobPostFilterSchema } from './admin.js';

describe('adminJobPostFilterSchema', () => {
  it('should fall back to page 1 when page is 0 or not a number', () => {
    expect(adminJobPostFilterSchema.parse({ page: '0' }).page).toBe(1);
    expect(adminJobPostFilterSchema.parse({ page: 'abc' }).page).toBe(1);
    expect(adminJobPostFilterSchema.parse({}).page).toBe(1);
  });
});
