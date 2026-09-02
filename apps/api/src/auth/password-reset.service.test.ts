import { compare, hash } from 'bcrypt';
import {
  PASSWORD_RESET_ERRORS,
  PASSWORD_RESET_RULES,
  SIGNUP_RULES,
} from '@fixer/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PasswordResetService,
  type PasswordResetRecord,
  type PasswordResetStore,
} from './password-reset.service';
import type { AuthUserStore, RefreshTokenStore } from './login.service';
import type { MailProvider } from './email-verification.service';
import type { UserRecord } from './signup.service';

const EMAIL = 'worker@example.com';
const NAME = '김구직';
const OLD_PASSWORD = 'old-password';
const NEW_PASSWORD = 'new-good-password';
const NOW = new Date('2026-09-03T00:00:00.000Z');
const MINUTE_MS = 60 * 1000;
const EXPIRY_MS = PASSWORD_RESET_RULES.expiryMinutes * MINUTE_MS;

let oldHash: string;
beforeAll(async () => {
  // cost 4로 충분하다. 재설정이 cost 12로 저장하는지는 별도로 단언한다.
  oldHash = await hash(OLD_PASSWORD, 4);
});

function member(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'usr_1',
    email: EMAIL,
    name: NAME,
    passwordHash: oldHash,
    createdAt: NOW,
    ...overrides,
  };
}

class FakeUserStore {
  constructor(readonly members: UserRecord[]) {}
  findByEmail(email: string): Promise<UserRecord | null> {
    return Promise.resolve(this.members.find((m) => m.email === email) ?? null);
  }
  findById(id: string): Promise<UserRecord | null> {
    return Promise.resolve(this.members.find((m) => m.id === id) ?? null);
  }
  updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    const found = this.members.find((m) => m.id === userId);
    if (found) found.passwordHash = passwordHash;
    return Promise.resolve();
  }
}

class FakeRefreshTokenStore {
  readonly deletedFor: string[] = [];
  deleteAllForUser(userId: string): Promise<void> {
    this.deletedFor.push(userId);
    return Promise.resolve();
  }
}

class FakeResetStore implements PasswordResetStore {
  readonly rows: PasswordResetRecord[] = [];
  create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    this.rows.push({
      id: `pr_${this.rows.length + 1}`,
      consumedAt: null,
      createdAt: NOW,
      ...input,
    });
    return Promise.resolve();
  }
  findByTokenHash(tokenHash: string): Promise<PasswordResetRecord | null> {
    return Promise.resolve(
      this.rows.find((row) => row.tokenHash === tokenHash) ?? null,
    );
  }
  consume(id: string, at: Date): Promise<void> {
    const found = this.rows.find((row) => row.id === id);
    if (found) found.consumedAt = at;
    return Promise.resolve();
  }
}

class FakeMailProvider {
  readonly sent: { email: string; token: string }[] = [];
  sendVerificationCode(): Promise<void> {
    return Promise.resolve();
  }
  sendPasswordResetLink(email: string, token: string): Promise<void> {
    this.sent.push({ email, token });
    return Promise.resolve();
  }
}

function setup(members: UserRecord[] = [member()]) {
  const users = new FakeUserStore(members);
  const resets = new FakeResetStore();
  const refreshTokens = new FakeRefreshTokenStore();
  const mail = new FakeMailProvider();
  const service = new PasswordResetService(
    users as unknown as AuthUserStore,
    resets,
    refreshTokens as unknown as RefreshTokenStore,
    mail as unknown as MailProvider,
  );
  return { service, users, resets, refreshTokens, mail };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

function codeOf(error: unknown): unknown {
  return (error as { code?: unknown }).code;
}

describe('requestReset', () => {
  it('should store a hashed token that expires in 30 minutes', async () => {
    const { service, resets, mail } = setup();

    await service.requestReset(EMAIL, NOW);

    expect(resets.rows).toHaveLength(1);
    expect(resets.rows[0].expiresAt).toEqual(
      new Date(NOW.getTime() + EXPIRY_MS),
    );
    // 평문이 저장되면 안 된다
    expect(resets.rows[0].tokenHash).not.toBe(mail.sent[0].token);
  });

  it('should send the reset link to the member email', async () => {
    const { service, mail } = setup();

    await service.requestReset(EMAIL, NOW);

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].email).toBe(EMAIL);
    expect(mail.sent[0].token.length).toBeGreaterThan(20);
  });

  it('should resolve without sending anything when no member has that email', async () => {
    // 없다고 알려주면 이메일만 넣어보고 가입 여부를 알아낼 수 있다 (#4 AC2와 같은 이유)
    const { service, resets, mail } = setup();

    await expect(
      service.requestReset('nobody@example.com', NOW),
    ).resolves.toBeUndefined();

    expect(resets.rows).toHaveLength(0);
    expect(mail.sent).toHaveLength(0);
  });

  it('should find the member case-insensitively', async () => {
    const { service, mail } = setup();

    await service.requestReset('Worker@Example.COM', NOW);

    expect(mail.sent).toHaveLength(1);
  });
});

describe('resetPassword', () => {
  /** 요청부터 해서 실제 토큰을 얻는다 */
  async function issued() {
    const kit = setup();
    await kit.service.requestReset(EMAIL, NOW);
    return { ...kit, token: kit.mail.sent[0].token };
  }

  it('should replace the password hash with a bcrypt hash of the new password', async () => {
    const { service, users, token } = await issued();

    await service.resetPassword({ token, newPassword: NEW_PASSWORD }, NOW);

    const stored = users.members[0].passwordHash;
    expect(stored).not.toBe(oldHash);
    expect(stored).toMatch(
      new RegExp('^\\$2[aby]\\$' + SIGNUP_RULES.bcryptCostFactor + '\\$'),
    );
    await expect(compare(NEW_PASSWORD, stored)).resolves.toBe(true);
  });

  it('should delete every refresh token of that member', async () => {
    // spec-fixed §2.4. 그 기기만이 아니라 전부다 — 비밀번호가 털린 상황이다.
    const { service, refreshTokens, token } = await issued();

    await service.resetPassword({ token, newPassword: NEW_PASSWORD }, NOW);

    expect(refreshTokens.deletedFor).toEqual(['usr_1']);
  });

  it('should mark the token consumed', async () => {
    const { service, resets, token } = await issued();

    await service.resetPassword({ token, newPassword: NEW_PASSWORD }, NOW);

    expect(resets.rows[0].consumedAt).toEqual(NOW);
  });

  it('should reject a new password shorter than 8 characters and change nothing', async () => {
    const { service, users, refreshTokens, token } = await issued();

    await rejectionOf(
      service.resetPassword({ token, newPassword: 'short12' }, NOW),
    );

    expect(users.members[0].passwordHash).toBe(oldHash);
    expect(refreshTokens.deletedFor).toHaveLength(0);
  });

  it('should reject with AUTH_RESET_TOKEN_INVALID when the token was already consumed', async () => {
    const { service, token } = await issued();
    await service.resetPassword({ token, newPassword: NEW_PASSWORD }, NOW);

    const error = await rejectionOf(
      service.resetPassword({ token, newPassword: 'another-password' }, NOW),
    );

    expect(codeOf(error)).toBe(PASSWORD_RESET_ERRORS.TOKEN_INVALID);
  });

  it('should reject when the token has expired', async () => {
    const { service, token } = await issued();
    const late = new Date(NOW.getTime() + EXPIRY_MS + 1000);

    const error = await rejectionOf(
      service.resetPassword({ token, newPassword: NEW_PASSWORD }, late),
    );

    expect(codeOf(error)).toBe(PASSWORD_RESET_ERRORS.TOKEN_INVALID);
  });

  it('should reject when the token does not exist', async () => {
    const { service } = setup();

    const error = await rejectionOf(
      service.resetPassword(
        { token: 'never-issued-token', newPassword: NEW_PASSWORD },
        NOW,
      ),
    );

    expect(codeOf(error)).toBe(PASSWORD_RESET_ERRORS.TOKEN_INVALID);
  });

  it('should reject exactly at the expiry instant', async () => {
    // 경계는 닫힌 쪽이다. 정확히 만료 시각이면 이미 지난 것으로 본다.
    const { service, token } = await issued();
    const exactly = new Date(NOW.getTime() + EXPIRY_MS);

    const error = await rejectionOf(
      service.resetPassword({ token, newPassword: NEW_PASSWORD }, exactly),
    );

    expect(codeOf(error)).toBe(PASSWORD_RESET_ERRORS.TOKEN_INVALID);
  });
});
