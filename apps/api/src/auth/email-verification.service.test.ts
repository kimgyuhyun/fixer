/* eslint-disable @typescript-eslint/require-await --
 * 메모리 가짜 저장소와 가짜 메일러는 동기 동작이지만, 실제 구현과 같은
 * Promise 인터페이스를 지켜야 하므로 async로 선언한다.
 */
import {
  EMAIL_VERIFICATION_ERRORS,
  EMAIL_VERIFICATION_RULES,
} from '@fixer/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import {
  EmailVerificationService,
  type EmailVerificationRecord,
  type EmailVerificationStore,
  type MailProvider,
} from './email-verification.service';

const EMAIL = 'worker@example.com';
const OTHER_EMAIL = 'poster@example.com';
const NOW = new Date('2026-09-01T00:00:00.000Z');

/**
 * 메모리 저장소. 시간·횟수 판정을 DB 없이 검증하기 위한 가짜다.
 * 동시성은 이 가짜로 증명되지 않으므로, 해당 시나리오는 Green에서
 * Testcontainers 통합 테스트로 옮긴다.
 */
function createStore() {
  const rows: EmailVerificationRecord[] = [];
  let seq = 0;

  const store: EmailVerificationStore = {
    async create({ email, codeHash, expiresAt }) {
      const row: EmailVerificationRecord = {
        id: `evc_${++seq}`,
        email,
        codeHash,
        expiresAt,
        consumedAt: null,
        attemptCount: 0,
        createdAt: new Date(),
      };
      rows.push(row);
      return row;
    },
    async findLatest(email) {
      const found = rows.filter((r) => r.email === email);
      return found.length === 0 ? null : found[found.length - 1];
    },
    async countSince(email, since) {
      return rows.filter((r) => r.email === email && r.createdAt >= since)
        .length;
    },
    async markConsumed(id, consumedAt) {
      const row = rows.find((r) => r.id === id);
      if (row) row.consumedAt = consumedAt;
    },
    async incrementAttempt(id) {
      const row = rows.find((r) => r.id === id);
      if (row) row.attemptCount += 1;
    },
  };

  return { store, rows };
}

function createMail() {
  const sent: { email: string; code: string }[] = [];
  const mail: MailProvider = {
    async sendVerificationCode(email, code) {
      sent.push({ email, code });
    },
    // 이 서비스는 재설정 링크를 보내지 않는다. 포트를 채우기 위한 자리다.
    sendPasswordResetLink: () => Promise.resolve(),
  };
  return { mail, sent };
}

function setup() {
  const { store, rows } = createStore();
  const { mail, sent } = createMail();
  // 생성 방식이 바뀌면 이 함수 하나만 고치면 되도록 한 곳에 모은다.
  const service = new EmailVerificationService(store, mail);
  return { service, store, rows, mail, sent };
}

/** 마지막으로 발송된 코드. 테스트가 코드를 알아야 검증할 수 있다 */
function lastCode(sent: { code: string }[]): string {
  return sent[sent.length - 1].code;
}

const COOLDOWN_MS = EMAIL_VERIFICATION_RULES.resendCooldownSeconds * 1000;
const EXPIRY_MS = EMAIL_VERIFICATION_RULES.expiryMinutes * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('requestCode', () => {
  it('should issue a 6-digit code when the email has no prior request', async () => {
    const { service, sent } = setup();

    await service.requestCode(EMAIL);

    expect(lastCode(sent)).toMatch(/^\d{6}$/);
  });

  it('should set expiresAt to 10 minutes ahead when a code is issued', async () => {
    const { service } = setup();

    const result = await service.requestCode(EMAIL);

    expect(new Date(result.expiresAt).getTime()).toBe(
      NOW.getTime() + EXPIRY_MS,
    );
  });

  it('should set resendAvailableAt to 60 seconds ahead when a code is issued', async () => {
    const { service } = setup();

    const result = await service.requestCode(EMAIL);

    expect(new Date(result.resendAvailableAt).getTime()).toBe(
      NOW.getTime() + COOLDOWN_MS,
    );
  });

  it('should store the code hashed when a code is issued', async () => {
    const { service, rows, sent } = setup();

    await service.requestCode(EMAIL);

    expect(rows[0].codeHash).not.toBe(lastCode(sent));
  });

  it('should send the code through MailProvider when a code is issued', async () => {
    const { service, sent } = setup();

    await service.requestCode(EMAIL);

    expect(sent).toHaveLength(1);
    expect(sent[0].email).toBe(EMAIL);
  });

  it('should reject when exactly 59 seconds have passed since the last send', async () => {
    const { service } = setup();
    await service.requestCode(EMAIL);

    vi.setSystemTime(new Date(NOW.getTime() + 59_000));

    await expect(service.requestCode(EMAIL)).rejects.toThrow(
      EMAIL_VERIFICATION_ERRORS.RESEND_COOLDOWN,
    );
  });

  it('should succeed when exactly 60 seconds have passed since the last send', async () => {
    const { service, sent } = setup();
    await service.requestCode(EMAIL);

    vi.setSystemTime(new Date(NOW.getTime() + COOLDOWN_MS));
    await service.requestCode(EMAIL);

    expect(sent).toHaveLength(2);
  });

  it('should succeed on the 5th send within one hour', async () => {
    const { service, sent } = setup();

    for (let i = 0; i < EMAIL_VERIFICATION_RULES.maxSendsPerHour; i++) {
      vi.setSystemTime(new Date(NOW.getTime() + i * COOLDOWN_MS));
      await service.requestCode(EMAIL);
    }

    expect(sent).toHaveLength(EMAIL_VERIFICATION_RULES.maxSendsPerHour);
  });

  it('should reject on the 6th send within one hour', async () => {
    const { service } = setup();
    for (let i = 0; i < EMAIL_VERIFICATION_RULES.maxSendsPerHour; i++) {
      vi.setSystemTime(new Date(NOW.getTime() + i * COOLDOWN_MS));
      await service.requestCode(EMAIL);
    }

    vi.setSystemTime(
      new Date(
        NOW.getTime() + EMAIL_VERIFICATION_RULES.maxSendsPerHour * COOLDOWN_MS,
      ),
    );

    await expect(service.requestCode(EMAIL)).rejects.toThrow(
      EMAIL_VERIFICATION_ERRORS.RESEND_LIMIT_EXCEEDED,
    );
  });

  it('should succeed when the oldest of 5 sends falls outside the 1-hour window', async () => {
    const { service, sent } = setup();
    for (let i = 0; i < EMAIL_VERIFICATION_RULES.maxSendsPerHour; i++) {
      vi.setSystemTime(new Date(NOW.getTime() + i * COOLDOWN_MS));
      await service.requestCode(EMAIL);
    }

    // 첫 발송이 1시간 밖으로 밀려나는 시점
    vi.setSystemTime(new Date(NOW.getTime() + 60 * 60 * 1000 + 1_000));
    await service.requestCode(EMAIL);

    expect(sent).toHaveLength(EMAIL_VERIFICATION_RULES.maxSendsPerHour + 1);
  });

  it('should invalidate the previous unconsumed code when a new one is issued', async () => {
    const { service, sent } = setup();
    await service.requestCode(EMAIL);
    const previousCode = lastCode(sent);

    vi.setSystemTime(new Date(NOW.getTime() + COOLDOWN_MS));
    await service.requestCode(EMAIL);

    await expect(service.verifyCode(EMAIL, previousCode)).rejects.toThrow(
      EMAIL_VERIFICATION_ERRORS.INVALID,
    );
  });

  it('should throw MEMBER_RESEND_COOLDOWN when requested within 60 seconds', async () => {
    const { service } = setup();
    await service.requestCode(EMAIL);

    vi.setSystemTime(new Date(NOW.getTime() + 10_000));

    await expect(service.requestCode(EMAIL)).rejects.toThrow(
      EMAIL_VERIFICATION_ERRORS.RESEND_COOLDOWN,
    );
  });

  it('should throw MEMBER_RESEND_LIMIT_EXCEEDED when 5 sends already happened within the hour', async () => {
    const { service } = setup();
    for (let i = 0; i < EMAIL_VERIFICATION_RULES.maxSendsPerHour; i++) {
      vi.setSystemTime(new Date(NOW.getTime() + i * COOLDOWN_MS));
      await service.requestCode(EMAIL);
    }

    vi.setSystemTime(new Date(NOW.getTime() + 10 * COOLDOWN_MS));

    await expect(service.requestCode(EMAIL)).rejects.toThrow(
      EMAIL_VERIFICATION_ERRORS.RESEND_LIMIT_EXCEEDED,
    );
  });

  it('should reject when the email format is invalid', async () => {
    const { service } = setup();

    await expect(service.requestCode('not-an-email')).rejects.toBeInstanceOf(
      ZodError,
    );
  });
});

describe('verifyCode', () => {
  it('should mark the email verified when the code matches', async () => {
    const { service, sent } = setup();
    await service.requestCode(EMAIL);

    const result = await service.verifyCode(EMAIL, lastCode(sent));

    expect(result.email).toBe(EMAIL);
  });

  it('should return verifiedAt when verification succeeds', async () => {
    const { service, sent } = setup();
    await service.requestCode(EMAIL);

    const result = await service.verifyCode(EMAIL, lastCode(sent));

    expect(new Date(result.verifiedAt).getTime()).toBe(NOW.getTime());
  });

  it('should consume the code when verification succeeds', async () => {
    const { service, sent, rows } = setup();
    await service.requestCode(EMAIL);

    await service.verifyCode(EMAIL, lastCode(sent));

    expect(rows[0].consumedAt).not.toBeNull();
  });

  it('should succeed when the code is 1 second before expiry', async () => {
    const { service, sent } = setup();
    await service.requestCode(EMAIL);

    vi.setSystemTime(new Date(NOW.getTime() + EXPIRY_MS - 1_000));
    const result = await service.verifyCode(EMAIL, lastCode(sent));

    expect(result.email).toBe(EMAIL);
  });

  it('should reject when the code is exactly at expiry', async () => {
    const { service, sent } = setup();
    await service.requestCode(EMAIL);

    vi.setSystemTime(new Date(NOW.getTime() + EXPIRY_MS));

    await expect(service.verifyCode(EMAIL, lastCode(sent))).rejects.toThrow(
      EMAIL_VERIFICATION_ERRORS.EXPIRED,
    );
  });

  it('should succeed on the 3rd attempt when the first two were wrong', async () => {
    const { service, sent } = setup();
    await service.requestCode(EMAIL);
    const code = lastCode(sent);

    await expect(service.verifyCode(EMAIL, '000000')).rejects.toThrow();
    await expect(service.verifyCode(EMAIL, '111111')).rejects.toThrow();
    const result = await service.verifyCode(EMAIL, code);

    expect(result.email).toBe(EMAIL);
  });

  it('should discard the code on the 3rd wrong attempt', async () => {
    const { service, sent } = setup();
    await service.requestCode(EMAIL);
    const code = lastCode(sent);

    await expect(service.verifyCode(EMAIL, '000000')).rejects.toThrow();
    await expect(service.verifyCode(EMAIL, '111111')).rejects.toThrow();
    await expect(service.verifyCode(EMAIL, '222222')).rejects.toThrow();

    // 올바른 코드를 넣어도 이미 폐기됐으므로 통과하지 않는다
    await expect(service.verifyCode(EMAIL, code)).rejects.toThrow(
      EMAIL_VERIFICATION_ERRORS.ATTEMPTS_EXCEEDED,
    );
  });

  it('should consume the code only once when called twice concurrently', async () => {
    const { service, sent, rows } = setup();
    await service.requestCode(EMAIL);
    const code = lastCode(sent);

    const results = await Promise.allSettled([
      service.verifyCode(EMAIL, code),
      service.verifyCode(EMAIL, code),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rows[0].consumedAt).not.toBeNull();
  });

  it('should throw MEMBER_VERIFICATION_CODE_INVALID when the code does not match', async () => {
    const { service } = setup();
    await service.requestCode(EMAIL);

    await expect(service.verifyCode(EMAIL, '999999')).rejects.toThrow(
      EMAIL_VERIFICATION_ERRORS.INVALID,
    );
  });

  it('should throw MEMBER_VERIFICATION_CODE_EXPIRED when the code is past expiry', async () => {
    const { service, sent } = setup();
    await service.requestCode(EMAIL);

    vi.setSystemTime(new Date(NOW.getTime() + EXPIRY_MS + 1_000));

    await expect(service.verifyCode(EMAIL, lastCode(sent))).rejects.toThrow(
      EMAIL_VERIFICATION_ERRORS.EXPIRED,
    );
  });

  it('should throw MEMBER_VERIFICATION_ATTEMPTS_EXCEEDED when 3 wrong attempts were already made', async () => {
    const { service } = setup();
    await service.requestCode(EMAIL);

    for (let i = 0; i < EMAIL_VERIFICATION_RULES.maxAttempts; i++) {
      await expect(service.verifyCode(EMAIL, '000000')).rejects.toThrow();
    }

    await expect(service.verifyCode(EMAIL, '000000')).rejects.toThrow(
      EMAIL_VERIFICATION_ERRORS.ATTEMPTS_EXCEEDED,
    );
  });

  it('should throw when the code was already consumed', async () => {
    const { service, sent } = setup();
    await service.requestCode(EMAIL);
    const code = lastCode(sent);
    await service.verifyCode(EMAIL, code);

    await expect(service.verifyCode(EMAIL, code)).rejects.toThrow(
      EMAIL_VERIFICATION_ERRORS.INVALID,
    );
  });

  it('should throw when no code was ever issued for the email', async () => {
    const { service } = setup();

    await expect(service.verifyCode(EMAIL, '123456')).rejects.toThrow(
      EMAIL_VERIFICATION_ERRORS.INVALID,
    );
  });

  it('should throw when the code was issued for a different email', async () => {
    const { service, sent } = setup();
    await service.requestCode(EMAIL);
    const codeForOther = lastCode(sent);

    await expect(service.verifyCode(OTHER_EMAIL, codeForOther)).rejects.toThrow(
      EMAIL_VERIFICATION_ERRORS.INVALID,
    );
  });
});

/**
 * AC 4의 뒷절 — "남은 시간이 안내된다".
 *
 * 거절만 하고 얼마나 기다려야 하는지 알려주지 않으면 사용자는 버튼을 계속
 * 누르게 된다. 남은 초를 에러에 실어 경계 밖(HTTP·화면)이 쓸 수 있게 한다.
 */
describe('requestCode 쿨다운 남은 시간', () => {
  it('should carry the remaining cooldown seconds when rejected within the cooldown', async () => {
    const { service } = setup();
    await service.requestCode(EMAIL);

    vi.setSystemTime(new Date(NOW.getTime() + 1_000));

    await expect(service.requestCode(EMAIL)).rejects.toMatchObject({
      code: EMAIL_VERIFICATION_ERRORS.RESEND_COOLDOWN,
      retryAfterSeconds: EMAIL_VERIFICATION_RULES.resendCooldownSeconds - 1,
    });
  });

  it('should round the remaining seconds up so the client does not retry too early', async () => {
    // 0.5초 남았는데 0으로 내림하면 곧바로 다시 눌러 또 거절당한다.
    const { service } = setup();
    await service.requestCode(EMAIL);

    vi.setSystemTime(new Date(NOW.getTime() + COOLDOWN_MS - 500));

    await expect(service.requestCode(EMAIL)).rejects.toMatchObject({
      retryAfterSeconds: 1,
    });
  });
});
