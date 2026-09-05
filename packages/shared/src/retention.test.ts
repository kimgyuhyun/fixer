import { describe, expect, it } from 'vitest';
import { PURGED_NAME, RETENTION, purgedEmailFor } from './retention.js';

describe('보관 기간 상수', () => {
  it('should keep personal info for four months', () => {
    const days = RETENTION.PERSONAL_INFO_MS / (24 * 60 * 60 * 1000);
    expect(days).toBe(120);
  });

  it('should keep payment records far longer than personal info', () => {
    // 법정 보관 대상이 먼저 지워지면 파기 순서가 뒤집힌다.
    expect(RETENTION.PAYMENT_MS).toBeGreaterThan(RETENTION.PERSONAL_INFO_MS);
    expect(RETENTION.CONTRACT_MS).toBeGreaterThan(RETENTION.PERSONAL_INFO_MS);
    expect(RETENTION.DISPUTE_MS).toBeGreaterThan(RETENTION.PERSONAL_INFO_MS);
  });
});

describe('파기된 계정의 식별자', () => {
  it('should build an address that can never receive mail', () => {
    // `.invalid`는 예약 TLD다 (RFC 2606).
    expect(purgedEmailFor('usr_1')).toBe('deleted_usr_1@invalid');
  });

  it('should stay unique per member so the unique index survives', () => {
    expect(purgedEmailFor('usr_1')).not.toBe(purgedEmailFor('usr_2'));
  });

  it('should not leak the original name', () => {
    expect(PURGED_NAME).not.toContain('@');
    expect(PURGED_NAME).toBe('탈퇴회원');
  });
});
