import { hash } from 'bcrypt';
import { AUTH_TOKEN_RULES, LOGIN_ERRORS } from '@fixer/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AccessTokenSigner } from './access-token';
import {
  LoginService,
  type AuthUserStore,
  type RefreshTokenRecord,
  type RefreshTokenStore,
} from './login.service';
import type { UserRecord } from './signup.service';

/**
 * `compare` 호출 횟수만 센다. 실제 bcrypt를 그대로 부르므로 대조 결과는
 * 진짜다 — 세는 것 말고는 아무것도 바꾸지 않는다.
 *
 * 시간을 재서 단언하면 기계가 느린 날 깨진다. "몇 번 불렀나"는 같은 것을
 * 확인하면서도 항상 같은 답이 나온다.
 */
const bcryptCalls = vi.hoisted(() => ({ compare: 0 }));

vi.mock('bcrypt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bcrypt')>();
  return {
    ...actual,
    compare: (data: string, encrypted: string) => {
      bcryptCalls.compare += 1;
      return actual.compare(data, encrypted);
    },
  };
});

const SECRET = 'test-secret-value-for-hs256-signing';
const EMAIL = 'worker@example.com';
const NAME = '김구직';
const PASSWORD = 'good-password';
const NOW = new Date('2026-09-01T00:00:00.000Z');

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * cost 4로 해시한다. 로그인은 `compare`만 하므로 cost가 몇이든 대조는 같고,
 * 사양값 12는 한 번에 0.2초씩 걸려 16개 테스트를 느리게 만든다.
 * (가입이 cost 12로 저장하는지는 #2의 테스트가 이미 본다)
 */
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hash(PASSWORD, 4);
});

function member(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'usr_1',
    email: EMAIL,
    name: NAME,
    passwordHash,
    createdAt: NOW,
    ...overrides,
  };
}

/** 가입(#2)이 소문자로 정규화해서 저장하므로 가짜 저장소도 그 상태를 흉내낸다 */
class FakeUserStore implements AuthUserStore {
  constructor(private readonly members: UserRecord[]) {}

  findByEmail(email: string): Promise<UserRecord | null> {
    return Promise.resolve(this.members.find((m) => m.email === email) ?? null);
  }

  findById(id: string): Promise<UserRecord | null> {
    return Promise.resolve(this.members.find((m) => m.id === id) ?? null);
  }
}

class FakeRefreshTokenStore implements RefreshTokenStore {
  readonly rows: RefreshTokenRecord[] = [];

  create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshTokenRecord> {
    const row: RefreshTokenRecord = {
      id: `rt_${this.rows.length + 1}`,
      createdAt: NOW,
      ...input,
    };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return Promise.resolve(
      this.rows.find((row) => row.tokenHash === tokenHash) ?? null,
    );
  }

  deleteByTokenHash(tokenHash: string): Promise<void> {
    const at = this.rows.findIndex((row) => row.tokenHash === tokenHash);
    if (at !== -1) {
      this.rows.splice(at, 1);
    }
    return Promise.resolve();
  }
}

function setup(members: UserRecord[] = [member()]) {
  const users = new FakeUserStore(members);
  const refreshTokens = new FakeRefreshTokenStore();
  const accessTokens = new AccessTokenSigner({ secret: SECRET });
  const service = new LoginService(users, refreshTokens, accessTokens);
  return { service, users, refreshTokens, accessTokens };
}

/** 거절될 때까지 기다렸다가 던져진 값을 돌려준다 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

/** 던져진 값에서 도메인 에러 코드를 꺼낸다 */
function codeOf(error: unknown): unknown {
  return (error as { code?: unknown }).code;
}

describe('login', () => {
  it('should issue an access token and a refresh token when the email and password match', async () => {
    const { service } = setup();

    const session = await service.login(
      { email: EMAIL, password: PASSWORD },
      NOW,
    );

    expect(session.accessToken.value).not.toBe('');
    expect(session.refreshToken.value).not.toBe('');
  });

  it('should store the refresh token as a hash instead of the raw value', async () => {
    const { service, refreshTokens } = setup();

    const session = await service.login(
      { email: EMAIL, password: PASSWORD },
      NOW,
    );

    const stored = refreshTokens.rows[0];
    expect(stored.tokenHash).not.toBe(session.refreshToken.value);
    // sha256 16진수. `EmailVerification.codeHash`(#1)와 같은 방식이다.
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should add one refresh token row per login instead of replacing the previous one', async () => {
    const { service, refreshTokens } = setup();

    await service.login({ email: EMAIL, password: PASSWORD }, NOW);
    await service.login({ email: EMAIL, password: PASSWORD }, NOW);

    // ADR-AUTH-1. 덮어쓰면 휴대폰 로그인이 PC를 조용히 끊는다.
    expect(refreshTokens.rows).toHaveLength(2);
  });

  it('should find the member case-insensitively when the email case differs from signup', async () => {
    const { service } = setup();

    const session = await service.login(
      { email: 'Worker@Example.COM', password: PASSWORD },
      NOW,
    );

    expect(session.user.email).toBe(EMAIL);
  });

  it('should expire the access token in 15 minutes and the refresh token in 14 days', async () => {
    const { service } = setup();

    const session = await service.login(
      { email: EMAIL, password: PASSWORD },
      NOW,
    );

    expect(session.accessToken.expiresAt.getTime()).toBe(
      NOW.getTime() + AUTH_TOKEN_RULES.accessTokenMinutes * MINUTE_MS,
    );
    expect(session.refreshToken.expiresAt.getTime()).toBe(
      NOW.getTime() + AUTH_TOKEN_RULES.refreshTokenDays * DAY_MS,
    );
  });

  it('should throw AUTH_INVALID_CREDENTIALS when no member has that email', async () => {
    const { service } = setup();

    const error = await rejectionOf(
      service.login({ email: 'nobody@example.com', password: PASSWORD }, NOW),
    );

    expect(codeOf(error)).toBe(LOGIN_ERRORS.INVALID_CREDENTIALS);
  });

  it('should throw AUTH_INVALID_CREDENTIALS when the password does not match', async () => {
    const { service } = setup();

    const error = await rejectionOf(
      service.login({ email: EMAIL, password: 'wrong-password' }, NOW),
    );

    expect(codeOf(error)).toBe(LOGIN_ERRORS.INVALID_CREDENTIALS);
  });

  it('should still run a password comparison when no member has that email', async () => {
    const { service } = setup();
    bcryptCalls.compare = 0;

    await rejectionOf(
      service.login({ email: 'nobody@example.com', password: PASSWORD }, NOW),
    );

    // 회원이 없다고 대조를 건너뛰면 그 경로만 눈에 띄게 빨라진다. 코드와
    // 문구가 같아도 걸린 시간이 가입 여부를 알려준다. (AC2)
    expect(bcryptCalls.compare).toBe(1);
  });

  it('should give the same error code and message for a wrong email and a wrong password', async () => {
    const { service } = setup();

    const unknownEmail = await rejectionOf(
      service.login({ email: 'nobody@example.com', password: PASSWORD }, NOW),
    );
    const wrongPassword = await rejectionOf(
      service.login({ email: EMAIL, password: 'wrong-password' }, NOW),
    );

    // 구분되면 이메일만 넣어보고 가입 여부를 알아낼 수 있다. (AC2)
    expect(codeOf(unknownEmail)).toBe(codeOf(wrongPassword));
    expect((unknownEmail as Error).message).toBe(
      (wrongPassword as Error).message,
    );
  });
});

describe('authenticate', () => {
  it('should return the member id when the access token is still valid', async () => {
    const { service } = setup();
    const session = await service.login(
      { email: EMAIL, password: PASSWORD },
      NOW,
    );

    const authenticated = await service.authenticate(
      { accessToken: session.accessToken.value },
      new Date(NOW.getTime() + MINUTE_MS),
    );

    expect(authenticated.userId).toBe('usr_1');
  });

  it('should renew the access token when it expired and the refresh token is valid', async () => {
    const { service } = setup();
    const session = await service.login(
      { email: EMAIL, password: PASSWORD },
      NOW,
    );
    const afterExpiry = new Date(
      NOW.getTime() + (AUTH_TOKEN_RULES.accessTokenMinutes + 1) * MINUTE_MS,
    );

    const authenticated = await service.authenticate(
      {
        accessToken: session.accessToken.value,
        refreshToken: session.refreshToken.value,
      },
      afterExpiry,
    );

    expect(authenticated.userId).toBe('usr_1');
    expect(authenticated.renewedAccessToken?.value).not.toBe(
      session.accessToken.value,
    );
  });

  it('should still accept the access token one second before its 15-minute expiry without renewing it', async () => {
    const { service } = setup();
    const session = await service.login(
      { email: EMAIL, password: PASSWORD },
      NOW,
    );

    const authenticated = await service.authenticate(
      {
        accessToken: session.accessToken.value,
        refreshToken: session.refreshToken.value,
      },
      new Date(session.accessToken.expiresAt.getTime() - 1000),
    );

    // 아직 살아 있으므로 갱신하지 않는다. 여기서 갱신하면 15분이 사실상
    // 무의미해지고, 만료 경계가 밀려도 아무도 눈치채지 못한다.
    expect(authenticated.userId).toBe('usr_1');
    expect(authenticated.renewedAccessToken).toBeUndefined();
  });

  it('should renew the access token exactly at its 15-minute expiry', async () => {
    const { service } = setup();
    const session = await service.login(
      { email: EMAIL, password: PASSWORD },
      NOW,
    );

    const authenticated = await service.authenticate(
      {
        accessToken: session.accessToken.value,
        refreshToken: session.refreshToken.value,
      },
      // 만료 시각 그 자체는 이미 만료다. Refresh 판정과 같은 경계를 쓴다.
      session.accessToken.expiresAt,
    );

    expect(authenticated.userId).toBe('usr_1');
    expect(authenticated.renewedAccessToken?.value).not.toBe(
      session.accessToken.value,
    );
  });

  it('should keep the refresh token value unchanged when it renews the access token', async () => {
    const { service, refreshTokens } = setup();
    const session = await service.login(
      { email: EMAIL, password: PASSWORD },
      NOW,
    );
    const hashesBeforeRenewal = refreshTokens.rows.map((row) => row.tokenHash);

    await service.authenticate(
      {
        accessToken: session.accessToken.value,
        refreshToken: session.refreshToken.value,
      },
      new Date(
        NOW.getTime() + (AUTH_TOKEN_RULES.accessTokenMinutes + 1) * MINUTE_MS,
      ),
    );

    // 회전하지 않는다. (ADR-AUTH-1)
    expect(refreshTokens.rows.map((row) => row.tokenHash)).toEqual(
      hashesBeforeRenewal,
    );
  });

  it('should reject a refresh token whose expiresAt is exactly the current time', async () => {
    const { service } = setup();
    const session = await service.login(
      { email: EMAIL, password: PASSWORD },
      NOW,
    );

    const error = await rejectionOf(
      service.authenticate(
        {
          accessToken: session.accessToken.value,
          refreshToken: session.refreshToken.value,
        },
        session.refreshToken.expiresAt,
      ),
    );

    expect(codeOf(error)).toBe(LOGIN_ERRORS.UNAUTHENTICATED);
  });

  it('should throw AUTH_UNAUTHENTICATED when neither cookie is present', async () => {
    const { service } = setup();

    const error = await rejectionOf(service.authenticate({}, NOW));

    expect(codeOf(error)).toBe(LOGIN_ERRORS.UNAUTHENTICATED);
  });

  it('should throw AUTH_UNAUTHENTICATED when the access token expired and the refresh token is unknown', async () => {
    const { service } = setup();
    const session = await service.login(
      { email: EMAIL, password: PASSWORD },
      NOW,
    );

    const error = await rejectionOf(
      service.authenticate(
        {
          accessToken: session.accessToken.value,
          refreshToken: 'never-issued-refresh-token',
        },
        new Date(
          NOW.getTime() + (AUTH_TOKEN_RULES.accessTokenMinutes + 1) * MINUTE_MS,
        ),
      ),
    );

    expect(codeOf(error)).toBe(LOGIN_ERRORS.UNAUTHENTICATED);
  });
});

describe('getMyProfile', () => {
  it('should return the email and name of the logged-in member', async () => {
    const { service } = setup();

    const profile = await service.getMyProfile('usr_1');

    expect(profile).toMatchObject({ email: EMAIL, name: NAME });
  });

  it('should return a null address until the address feature exists', async () => {
    const { service } = setup();

    const profile = await service.getMyProfile('usr_1');

    // 주소 컬럼은 #3이 들고 온다. 그전까지 자리만 있고 값은 없다.
    expect(profile.address).toBeNull();
  });
});

describe('logout', () => {
  it('should delete the refresh token row that matches the given token', async () => {
    const { service, refreshTokens } = setup();
    const session = await service.login(
      { email: EMAIL, password: PASSWORD },
      NOW,
    );
    expect(refreshTokens.rows).toHaveLength(1);

    await service.logout(session.refreshToken.value);

    expect(refreshTokens.rows).toHaveLength(0);
  });

  it('should leave the refresh tokens of other sessions untouched', async () => {
    // ADR-AUTH-1: 세션당 한 행이다. 로그아웃은 그 기기만 끊는다.
    const { service, refreshTokens } = setup();
    const phone = await service.login(
      { email: EMAIL, password: PASSWORD },
      NOW,
    );
    await service.login({ email: EMAIL, password: PASSWORD }, NOW);
    expect(refreshTokens.rows).toHaveLength(2);

    await service.logout(phone.refreshToken.value);

    expect(refreshTokens.rows).toHaveLength(1);
  });

  it('should succeed when no refresh token was given', async () => {
    // 로그아웃은 멱등하다. 이미 로그아웃된 상태는 사용자의 잘못이 아니다.
    const { service } = setup();

    await expect(service.logout(undefined)).resolves.toBeUndefined();
  });

  it('should succeed when the refresh token is already gone', async () => {
    const { service } = setup();
    const session = await service.login(
      { email: EMAIL, password: PASSWORD },
      NOW,
    );
    await service.logout(session.refreshToken.value);

    await expect(
      service.logout(session.refreshToken.value),
    ).resolves.toBeUndefined();
  });

  it('should reject authenticate with AUTH_UNAUTHENTICATED after the refresh token row was deleted', async () => {
    // AC4. 행이 없으면 findByTokenHash가 못 찾으므로 갱신이 막힌다.
    const { service, accessTokens } = setup();
    const session = await service.login(
      { email: EMAIL, password: PASSWORD },
      NOW,
    );
    await service.logout(session.refreshToken.value);

    const expired = new Date(
      NOW.getTime() + AUTH_TOKEN_RULES.accessTokenMinutes * MINUTE_MS + 1000,
    );
    const error = await rejectionOf(
      service.authenticate(
        {
          accessToken: session.accessToken.value,
          refreshToken: session.refreshToken.value,
        },
        expired,
      ),
    );

    expect(codeOf(error)).toBe(LOGIN_ERRORS.UNAUTHENTICATED);
    expect(accessTokens).toBeDefined();
  });
});
