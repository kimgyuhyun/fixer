import { REACTIVATION_ERRORS, SIGNUP_ERRORS } from '@fixer/shared';
import { compare } from 'bcrypt';
import { describe, expect, it } from 'vitest';
import {
  ReactivationService,
  type ReactivationStore,
} from './reactivation.service';
import type { EmailVerificationChecker, UserRecord } from './signup.service';

const CREATED_AT = new Date('2026-01-15T09:00:00.000Z');
const WITHDRAWN_AT = new Date('2026-08-01T00:00:00.000Z');

const EXISTING: UserRecord = {
  id: 'usr_original',
  email: 'worker@example.com',
  name: '김구직',
  passwordHash: 'old-hash',
  createdAt: CREATED_AT,
  deactivatedAt: WITHDRAWN_AT,
};

/**
 * 되살리기가 **행을 새로 만들지 않는지**를 보려면 저장소가 그 사실을
 * 드러내야 한다. 그래서 가짜가 `create`를 아예 갖지 않는다 — 서비스가
 * 만들려 들면 타입에서 먼저 걸린다.
 */
class FakeStore implements ReactivationStore {
  member: UserRecord | null;
  /** 몇 번 되살렸나 */
  reactivateCount = 0;

  constructor(member: UserRecord | null = { ...EXISTING }) {
    this.member = member;
  }

  findByEmail(email: string): Promise<UserRecord | null> {
    if (!this.member) return Promise.resolve(null);
    return Promise.resolve(
      this.member.email === email ? { ...this.member } : null,
    );
  }

  reactivate(userId: string, passwordHash: string): Promise<UserRecord> {
    if (!this.member || this.member.id !== userId) {
      throw new Error('없는 회원을 되살리려 했다');
    }
    this.reactivateCount += 1;
    this.member = { ...this.member, deactivatedAt: null, passwordHash };
    return Promise.resolve({ ...this.member });
  }
}

function checker(verified: boolean): EmailVerificationChecker {
  return { isVerified: () => Promise.resolve(verified) };
}

function setup(opts: { member?: UserRecord | null; verified?: boolean } = {}): {
  service: ReactivationService;
  store: FakeStore;
} {
  const store = new FakeStore(
    opts.member === undefined ? { ...EXISTING } : opts.member,
  );
  const service = new ReactivationService(
    store,
    checker(opts.verified ?? true),
  );
  return { service, store };
}

const REQUEST = { email: 'worker@example.com', password: 'new-Password-1!' };

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

describe('reactivate — 되살린다 (AC2)', () => {
  it('should clear deactivatedAt', async () => {
    const { service, store } = setup();

    await service.reactivate(REQUEST);

    expect(store.member?.deactivatedAt).toBeNull();
  });

  it('should replace the password hash with the newly given password', async () => {
    // 사용자는 방금 가입 화면에서 비밀번호를 입력했다. 옛것을 유지하면
    // 바로 다음 로그인에서 틀린다.
    const { service, store } = setup();

    await service.reactivate(REQUEST);

    const stored = store.member?.passwordHash ?? '';
    expect(stored).not.toBe('old-hash');
    await expect(compare(REQUEST.password, stored)).resolves.toBe(true);
  });

  it('should reject with AUTH_EMAIL_NOT_VERIFIED when the email was not verified', async () => {
    const { service } = setup({ verified: false });

    const error = await rejectionOf(service.reactivate(REQUEST));

    expect(codeOf(error)).toBe(REACTIVATION_ERRORS.EMAIL_NOT_VERIFIED);
  });

  it('should not touch the member when the email was not verified', async () => {
    const { service, store } = setup({ verified: false });

    await rejectionOf(service.reactivate(REQUEST));

    expect(store.reactivateCount).toBe(0);
  });

  it('should reject when the account is already active', async () => {
    const { service } = setup({
      member: { ...EXISTING, deactivatedAt: null },
    });

    const error = await rejectionOf(service.reactivate(REQUEST));

    expect(codeOf(error)).toBe(REACTIVATION_ERRORS.NOT_DEACTIVATED);
  });

  it('should reject when no member has that email', async () => {
    const { service } = setup({ member: null });

    const error = await rejectionOf(service.reactivate(REQUEST));

    expect(codeOf(error)).toBe(REACTIVATION_ERRORS.NOT_DEACTIVATED);
  });

  it('should find the member case-insensitively when the email case differs', async () => {
    // 가입이 소문자로 저장하므로(#2) 되살리기도 같은 규칙을 써야 한다.
    const { service, store } = setup();

    await service.reactivate({ ...REQUEST, email: 'Worker@Example.com' });

    expect(store.member?.deactivatedAt).toBeNull();
  });
});

describe('reactivate — 이력이 그대로 남는다 (AC3)', () => {
  it('should keep the same member id instead of creating a new row', async () => {
    // 이 이슈의 존재 이유다. id가 바뀌면 그 id를 참조하던 경고·평점이
    // 통째로 끊겨 세탁이 성공한다.
    const { service, store } = setup();

    const revived = await service.reactivate(REQUEST);

    expect(revived.id).toBe('usr_original');
    expect(store.reactivateCount).toBe(1);
  });

  it('should keep the original name and createdAt', async () => {
    const { service } = setup();

    const revived = await service.reactivate(REQUEST);

    expect(revived.name).toBe('김구직');
    expect(revived.createdAt).toBe(CREATED_AT.toISOString());
  });
});

describe('signup — 비활성 계정 이메일 (AC1)', () => {
  it('should have a distinct error code from AUTH_EMAIL_ALREADY_EXISTS', async () => {
    // 두 경우에 같은 코드를 주면 웹이 재활성화 안내를 띄울 수 없다.
    expect(SIGNUP_ERRORS.REACTIVATION_AVAILABLE).not.toBe(
      SIGNUP_ERRORS.EMAIL_ALREADY_EXISTS,
    );
    await Promise.resolve();
  });
});
