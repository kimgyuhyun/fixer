import { describe, expect, it } from 'vitest';
import {
  adminJobPostFilterSchema,
  adminMemberFilterSchema,
  adminSuspensionFilterSchema,
  memberStatusOf,
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

describe('adminMemberFilterSchema', () => {
  // 관리자 목록 셋이 이미 "잘못된 page는 오류가 아니라 1"이다 (#33·#34·#35).
  // 회원 목록만 다르면 관리자 화면 안에서 규칙이 갈라진다.
  it('should fall back to page 1 when page is 0 or not a number', () => {
    expect(adminMemberFilterSchema.parse({ page: '0' }).page).toBe(1);
    expect(adminMemberFilterSchema.parse({ page: 'abc' }).page).toBe(1);
    expect(adminMemberFilterSchema.parse({}).page).toBe(1);
  });
});

describe('memberStatusOf', () => {
  it('should report ACTIVE when the member is neither deactivated nor suspended', () => {
    expect(
      memberStatusOf({ deactivatedAt: null, hasActiveSuspension: false }),
    ).toBe('ACTIVE');
  });

  it('should report SUSPENDED when an active suspension exists', () => {
    expect(
      memberStatusOf({ deactivatedAt: null, hasActiveSuspension: true }),
    ).toBe('SUSPENDED');
  });

  // 둘 다인 회원에게 "제재중"을 붙이면 관리자가 제재 해제를 눌러 볼 텐데
  // 그 계정은 애초에 로그인이 안 된다 (§2.6).
  it('should report DEACTIVATED even when an active suspension also exists', () => {
    expect(
      memberStatusOf({
        deactivatedAt: new Date('2026-09-01T00:00:00.000Z'),
        hasActiveSuspension: true,
      }),
    ).toBe('DEACTIVATED');
  });
});
