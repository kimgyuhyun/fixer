import { ConfigService } from '@nestjs/config';
import { ACCOUNT_ERRORS } from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import { EnvAccountCipher, type AccountCipher } from './account-cipher';
import {
  AccountError,
  ExchangeAccountService,
  StubAccountVerifier,
  type AccountRecord,
  type ExchangeAccountStore,
} from './exchange-account.service';

const USER = 'usr_1';
const VALID = {
  bankCode: '088',
  accountNumber: '11012345678',
  holderName: '김구직',
};

function configWith(secret: string | undefined): ConfigService {
  return { get: () => secret } as unknown as ConfigService;
}

function cipher(): AccountCipher {
  return new EnvAccountCipher(configWith('test-master-key'));
}

class FakeStore implements ExchangeAccountStore {
  rows: AccountRecord[] = [];

  upsert(record: AccountRecord): Promise<AccountRecord> {
    this.rows = this.rows.filter((r) => r.userId !== record.userId);
    this.rows.push(record);
    return Promise.resolve(record);
  }

  findByUser(userId: string): Promise<AccountRecord | null> {
    return Promise.resolve(this.rows.find((r) => r.userId === userId) ?? null);
  }
}

function setup(): {
  service: ExchangeAccountService;
  store: FakeStore;
  crypto: AccountCipher;
} {
  const store = new FakeStore();
  const crypto = cipher();
  const service = new ExchangeAccountService(
    store,
    crypto,
    new StubAccountVerifier(),
  );
  return { service, store, crypto };
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
  expect(error).toBeInstanceOf(AccountError);
  return (error as AccountError).code;
}

describe('cipher — 계좌번호 암복호화 (ADR-PAY-6)', () => {
  it('should read back what it encrypted', () => {
    const crypto = cipher();

    expect(crypto.decrypt(crypto.encrypt('11012345678'))).toBe('11012345678');
  });

  it('should produce a different ciphertext each time for the same number', () => {
    // 같으면 누가 누구와 같은 계좌를 쓰는지가 암호문만 봐도 드러난다.
    const crypto = cipher();

    expect(crypto.encrypt('11012345678')).not.toBe(
      crypto.encrypt('11012345678'),
    );
  });

  it('should refuse to decrypt a tampered ciphertext', () => {
    // GCM의 인증 태그가 변조를 여기서 잡는다.
    const crypto = cipher();
    const [iv, tag] = crypto.encrypt('11012345678').split(':');
    // 암호문만 바꿔치기한다. 태그는 그대로라 GCM이 여기서 잡아야 한다.
    const tampered = [iv, tag, Buffer.from('12345678901').toString('base64')];

    expect(() => crypto.decrypt(tampered.join(':'))).toThrow();
  });

  it('should refuse a ciphertext whose shape is wrong', () => {
    expect(() => cipher().decrypt('그냥문자열')).toThrow(/모양/);
  });

  it('should refuse to start without a key', () => {
    // 기본값을 주면 그 값으로 암호화된 계좌가 생기고, 나중에 진짜 키로
    // 바꾸면 그 계좌들을 아무도 못 읽는다.
    expect(() => new EnvAccountCipher(configWith(undefined))).toThrow(
      /ACCOUNT_ENCRYPTION_KEY/,
    );
  });
});

describe('register — 암호화해서 저장한다 (AC1)', () => {
  it('should store the account number encrypted, not in plain text', async () => {
    const { service, store } = setup();

    await service.register(USER, VALID);

    const saved = store.rows[0];
    expect(saved.accountNumberEncrypted).not.toContain('11012345678');
    expect(JSON.stringify(saved)).not.toContain('11012345678');
  });

  it('should be able to read the number back through the cipher', async () => {
    const { service, store, crypto } = setup();

    await service.register(USER, VALID);

    expect(crypto.decrypt(store.rows[0].accountNumberEncrypted)).toBe(
      '11012345678',
    );
  });

  it('should keep the last four digits for masking', async () => {
    // 목록을 그릴 때마다 복호화하면 전 회원의 계좌번호가 메모리에 올라온다.
    const { service, store } = setup();

    await service.register(USER, VALID);

    expect(store.rows[0].accountNumberLast4).toBe('5678');
  });

  it('should strip hyphens before storing', async () => {
    const { service, crypto, store } = setup();

    await service.register(USER, {
      ...VALID,
      accountNumber: '110-123-456789',
    });

    expect(crypto.decrypt(store.rows[0].accountNumberEncrypted)).toBe(
      '110123456789',
    );
  });
});

describe('register — 형식이 맞으면 즉시 VERIFIED (AC2)', () => {
  it('should mark a well-formed account VERIFIED right away', async () => {
    // 관리자 대기 단계를 만들지 않는다 — 실서비스와 단계 수가 같아야
    // 전환할 때 화면을 안 고친다 (§6.4.2).
    const { service } = setup();

    const account = await service.register(USER, VALID);

    expect(account.verificationStatus).toBe('VERIFIED');
  });

  it('should record no rejection reason when it passed', async () => {
    const { service } = setup();

    const account = await service.register(USER, VALID);

    expect(account.rejectedReason).toBeNull();
  });

  it('should accept the shortest allowed account number', async () => {
    const { service } = setup();

    const account = await service.register(USER, {
      ...VALID,
      accountNumber: '1234567890',
    });

    expect(account.verificationStatus).toBe('VERIFIED');
  });

  it('should accept the longest allowed account number', async () => {
    const { service } = setup();

    const account = await service.register(USER, {
      ...VALID,
      accountNumber: '12345678901234',
    });

    expect(account.verificationStatus).toBe('VERIFIED');
  });
});

describe('register — 형식이 틀리면 거절한다 (AC3)', () => {
  it('should reject an account number that is too short', async () => {
    const { service } = setup();

    const error = await rejectionOf(
      service.register(USER, { ...VALID, accountNumber: '123456789' }),
    );

    expect(codeOf(error)).toBe(ACCOUNT_ERRORS.INVALID_FORMAT);
  });

  it('should reject an account number with letters in it', async () => {
    const { service } = setup();

    const error = await rejectionOf(
      service.register(USER, { ...VALID, accountNumber: '1101234567a' }),
    );

    expect((error as AccountError).reason).toContain('숫자');
  });

  it('should reject an unknown bank code', async () => {
    const { service } = setup();

    const error = await rejectionOf(
      service.register(USER, { ...VALID, bankCode: '999' }),
    );

    expect((error as AccountError).reason).toContain('지원하지 않는 은행');
  });

  it('should say why it was rejected', async () => {
    // "실패했습니다"만 주면 무엇을 고쳐야 하는지 모른다.
    const { service } = setup();

    const error = await rejectionOf(
      service.register(USER, { ...VALID, accountNumber: '1' }),
    );

    expect((error as AccountError).reason).toContain('자리');
  });

  it('should store nothing when the format is wrong', async () => {
    // 형식이 틀린 계좌를 남겨 두면 나중에 그 행으로 송금 목록이 만들어진다.
    const { service, store } = setup();

    await rejectionOf(service.register(USER, { ...VALID, accountNumber: '1' }));

    expect(store.rows).toHaveLength(0);
  });
});

describe('findMine — 화면에서는 마스킹된다 (AC4)', () => {
  it('should never return the account number in plain text', async () => {
    const { service } = setup();
    await service.register(USER, VALID);

    const mine = await service.findMine(USER);

    expect(JSON.stringify(mine)).not.toContain('11012345678');
  });

  it('should return the masked number and the bank name', async () => {
    const { service } = setup();
    await service.register(USER, VALID);

    const mine = await service.findMine(USER);

    expect(mine).toMatchObject({
      maskedAccountNumber: '****5678',
      bankCode: '088',
      bankName: '신한은행',
      holderName: '김구직',
    });
  });

  it('should reject a member who registered no account', async () => {
    const { service } = setup();

    const error = await rejectionOf(service.findMine('usr_none'));

    expect(codeOf(error)).toBe(ACCOUNT_ERRORS.NOT_REGISTERED);
  });
});

describe('register — 덮어쓰기', () => {
  it('should replace the account when the member registers again', async () => {
    const { service, store } = setup();
    await service.register(USER, VALID);

    await service.register(USER, {
      ...VALID,
      bankCode: '004',
      accountNumber: '98765432109',
    });

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].accountNumberLast4).toBe('2109');
    expect(store.rows[0].bankCode).toBe('004');
  });

  it('should verify again from scratch after a replacement', async () => {
    // 계좌를 바꿨는데 옛 검증 상태가 남으면 검증 안 된 계좌로 송금이 나간다.
    const { service } = setup();
    await service.register(USER, VALID);

    const replaced = await service.register(USER, {
      ...VALID,
      accountNumber: '98765432109',
    });

    expect(replaced.verificationStatus).toBe('VERIFIED');
    expect(replaced.maskedAccountNumber).toBe('****2109');
  });
});

describe('revealForPayout — 송금할 때만 꺼낸다', () => {
  it('should return the plain number for a payout', async () => {
    const { service } = setup();
    await service.register(USER, VALID);

    expect(await service.revealForPayout(USER)).toBe('11012345678');
  });

  it('should reject a member who registered no account', async () => {
    const { service } = setup();

    const error = await rejectionOf(service.revealForPayout('usr_none'));

    expect(codeOf(error)).toBe(ACCOUNT_ERRORS.NOT_REGISTERED);
  });
});
