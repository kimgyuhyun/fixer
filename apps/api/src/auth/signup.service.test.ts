/* eslint-disable @typescript-eslint/require-await --
 * 메모리 가짜 저장소는 동기 동작이지만, 실제 구현과 같은 Promise 인터페이스를
 * 지켜야 하므로 async로 선언한다.
 */
import { SIGNUP_ERRORS, SIGNUP_RULES } from '@fixer/shared';
import { compareSync } from 'bcrypt';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  SignupError,
  SignupService,
  type EmailVerificationChecker,
  type UserRecord,
  type UserStore,
} from './signup.service';

const EMAIL = 'worker@example.com';
const NAME = '김구직';
const PASSWORD = 'good-password';

/** 인증 발급 이력의 최소 형태. #1의 `EmailVerification` 행에서 필요한 것만 본다 */
interface VerificationRow {
  email: string;
  consumedAt: Date | null;
}

/**
 * 가짜 회원 저장소.
 *
 * `findByEmail`은 실제 DB의 `@unique` 컬럼처럼 **정확히 일치**할 때만 찾는다.
 * 그래서 대소문자 정규화를 서비스가 하지 않으면 중복 검사가 뚫린다.
 */
function createUserStore(seed: UserRecord[] = []) {
  const rows: UserRecord[] = [...seed];
  let seq = 0;

  const store: UserStore = {
    async findByEmail(email) {
      return rows.find((row) => row.email === email) ?? null;
    },
    async create({ email, name, passwordHash }) {
      const row: UserRecord = {
        id: `usr_${++seq}`,
        email,
        name,
        passwordHash,
        createdAt: new Date(),
      };
      rows.push(row);
      return row;
    },
  };

  return { store, rows };
}

/** 아무도 부르면 안 되는 저장소. "저장되지 않는다"를 증명할 때 쓴다 */
function createForbiddenUserStore(): UserStore {
  return {
    findByEmail() {
      throw new Error('저장소까지 오면 안 된다');
    },
    create() {
      throw new Error('저장소까지 오면 안 된다');
    },
  };
}

/**
 * 가짜 인증 확인기.
 *
 * #1이 정한 규칙을 그대로 옮긴다 — 그 이메일로 발급된 행 중 `consumedAt`이
 * 채워진 것이 하나라도 있으면 인증을 마친 것이다.
 */
function createVerificationChecker(
  rows: VerificationRow[] = [],
): EmailVerificationChecker {
  return {
    async isVerified(email) {
      return rows.some((row) => row.email === email && row.consumedAt !== null);
    },
  };
}

function verified(email = EMAIL): VerificationRow[] {
  return [{ email, consumedAt: new Date('2026-09-01T00:00:00.000Z') }];
}

function existingUser(email = EMAIL): UserRecord {
  return {
    id: 'usr_seed',
    email,
    name: '먼저가입한사람',
    passwordHash: '$2b$12$seedseedseedseedseedseedseedseedseedseedseedseedseed',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function serviceWith(options?: {
  users?: UserStore;
  verifications?: VerificationRow[];
}) {
  const users = options?.users ?? createUserStore().store;
  return new SignupService(
    users,
    createVerificationChecker(options?.verifications ?? verified()),
  );
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

describe('signup', () => {
  it('should create a User when the email is verified and the input is valid', async () => {
    const { store, rows } = createUserStore();
    const service = serviceWith({ users: store });

    await service.signup({ email: EMAIL, password: PASSWORD, name: NAME });

    expect(rows).toHaveLength(1);
  });

  it('should store the password as a bcrypt hash instead of plain text', async () => {
    const { store, rows } = createUserStore();
    const service = serviceWith({ users: store });

    await service.signup({ email: EMAIL, password: PASSWORD, name: NAME });

    expect(rows[0].passwordHash).toMatch(
      new RegExp(`^\\$2[aby]\\$${SIGNUP_RULES.bcryptCostFactor}\\$`),
    );
  });

  it('should store a hash that matches the original password', async () => {
    const { store, rows } = createUserStore();
    const service = serviceWith({ users: store });

    await service.signup({ email: EMAIL, password: PASSWORD, name: NAME });

    expect(compareSync(PASSWORD, rows[0].passwordHash)).toBe(true);
  });

  it('should return id, email, name and createdAt of the created member', async () => {
    const { store, rows } = createUserStore();
    const service = serviceWith({ users: store });

    const result = await service.signup({
      email: EMAIL,
      password: PASSWORD,
      name: NAME,
    });

    expect(result).toEqual({
      id: rows[0].id,
      email: EMAIL,
      name: NAME,
      createdAt: rows[0].createdAt.toISOString(),
    });
  });

  it('should trim the surrounding whitespace of the name before storing', async () => {
    const { store, rows } = createUserStore();
    const service = serviceWith({ users: store });

    await service.signup({
      email: EMAIL,
      password: PASSWORD,
      name: `  ${NAME}  `,
    });

    expect(rows[0].name).toBe(NAME);
  });

  it('should accept a password of exactly 8 characters', async () => {
    const { store, rows } = createUserStore();
    const service = serviceWith({ users: store });

    await service.signup({ email: EMAIL, password: '12345678', name: NAME });

    expect(rows).toHaveLength(1);
  });

  it('should reject a password of exactly 7 characters', async () => {
    const service = serviceWith({ users: createForbiddenUserStore() });

    const error = await rejectionOf(
      service.signup({ email: EMAIL, password: '1234567', name: NAME }),
    );

    expect(error).toBeInstanceOf(ZodError);
  });

  it('should accept a password of exactly 72 bytes', async () => {
    const { store, rows } = createUserStore();
    const service = serviceWith({ users: store });

    // 한글 24자 = 72바이트. 글자 수로 재면 이 값이 통과하지 못한다.
    await service.signup({
      email: EMAIL,
      password: '가'.repeat(24),
      name: NAME,
    });

    expect(rows).toHaveLength(1);
  });

  it('should reject a password of 73 bytes', async () => {
    const service = serviceWith({ users: createForbiddenUserStore() });

    const error = await rejectionOf(
      service.signup({
        email: EMAIL,
        password: `${'가'.repeat(24)}a`,
        name: NAME,
      }),
    );

    expect(error).toBeInstanceOf(ZodError);
  });

  it('should reject a name that is only whitespace', async () => {
    const service = serviceWith({ users: createForbiddenUserStore() });

    const error = await rejectionOf(
      service.signup({ email: EMAIL, password: PASSWORD, name: '   ' }),
    );

    expect(error).toBeInstanceOf(ZodError);
  });

  it('should treat the email case-insensitively when looking for an existing member', async () => {
    const { store } = createUserStore([existingUser()]);
    const service = serviceWith({ users: store });

    const error = await rejectionOf(
      service.signup({
        email: 'Worker@Example.COM',
        password: PASSWORD,
        name: NAME,
      }),
    );

    expect((error as SignupError).code).toBe(
      SIGNUP_ERRORS.EMAIL_ALREADY_EXISTS,
    );
  });

  it('should not touch the user store at all when the input fails validation', async () => {
    const service = serviceWith({ users: createForbiddenUserStore() });

    const error = await rejectionOf(
      service.signup({ email: EMAIL, password: 'short', name: NAME }),
    );

    expect(error).toBeInstanceOf(ZodError);
  });

  it('should throw AUTH_EMAIL_NOT_VERIFIED when the email was never verified', async () => {
    const service = serviceWith({ verifications: [] });

    const error = await rejectionOf(
      service.signup({ email: EMAIL, password: PASSWORD, name: NAME }),
    );

    expect((error as SignupError).code).toBe(SIGNUP_ERRORS.EMAIL_NOT_VERIFIED);
  });

  it('should throw AUTH_EMAIL_NOT_VERIFIED when a code was issued but never consumed', async () => {
    const service = serviceWith({
      verifications: [{ email: EMAIL, consumedAt: null }],
    });

    const error = await rejectionOf(
      service.signup({ email: EMAIL, password: PASSWORD, name: NAME }),
    );

    expect((error as SignupError).code).toBe(SIGNUP_ERRORS.EMAIL_NOT_VERIFIED);
  });

  it('should throw MEMBER_EMAIL_ALREADY_EXISTS when a member with that email exists', async () => {
    const { store } = createUserStore([existingUser()]);
    const service = serviceWith({ users: store });

    const error = await rejectionOf(
      service.signup({ email: EMAIL, password: PASSWORD, name: NAME }),
    );

    expect((error as SignupError).code).toBe(
      SIGNUP_ERRORS.EMAIL_ALREADY_EXISTS,
    );
  });

  it('should throw AUTH_EMAIL_NOT_VERIFIED before MEMBER_EMAIL_ALREADY_EXISTS when both apply', async () => {
    // 인증하지 않은 사람에게 "이미 가입된 이메일"이라고 알려주면
    // 아무나 이메일만 넣어보고 가입 여부를 알아낼 수 있다.
    const { store } = createUserStore([existingUser()]);
    const service = serviceWith({ users: store, verifications: [] });

    const error = await rejectionOf(
      service.signup({ email: EMAIL, password: PASSWORD, name: NAME }),
    );

    expect((error as SignupError).code).toBe(SIGNUP_ERRORS.EMAIL_NOT_VERIFIED);
  });

  it('should reject when the email format is invalid', async () => {
    const service = serviceWith({ users: createForbiddenUserStore() });

    const error = await rejectionOf(
      service.signup({
        email: 'not-an-email',
        password: PASSWORD,
        name: NAME,
      }),
    );

    expect(error).toBeInstanceOf(ZodError);
  });

  it('should reject a password shorter than 8 characters', async () => {
    const service = serviceWith({ users: createForbiddenUserStore() });

    const error = await rejectionOf(
      service.signup({ email: EMAIL, password: 'abc', name: NAME }),
    );

    expect(error).toBeInstanceOf(ZodError);
  });
});
