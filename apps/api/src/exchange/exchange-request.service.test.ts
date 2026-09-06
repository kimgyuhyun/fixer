import { EXCHANGE_ERRORS } from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import type {
  AccountRecord,
  ExchangeAccountStore,
} from './exchange-account.service';
import {
  ExchangeError,
  ExchangeRequestService,
  type ExchangeRequestRecord,
  type ExchangeRequestStore,
  type MaturedPointReader,
} from './exchange-request.service';

const USER = 'usr_worker';

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function account(
  verificationStatus: AccountRecord['verificationStatus'],
): AccountRecord {
  return {
    userId: USER,
    bankCode: '088',
    accountNumberEncrypted: 'iv:tag:cipher',
    accountNumberLast4: '5678',
    holderName: '김구직',
    verificationStatus,
    rejectedReason: null,
  };
}

/** 등록된 계좌를 들고 있는 가짜 저장소. **몇 번 읽혔는지 센다** */
class FakeAccounts implements ExchangeAccountStore {
  reads = 0;

  constructor(private readonly record: AccountRecord | null) {}

  upsert(record: AccountRecord): Promise<AccountRecord> {
    return Promise.resolve(record);
  }

  findByUser(): Promise<AccountRecord | null> {
    this.reads += 1;
    return Promise.resolve(this.record);
  }
}

/**
 * 지급 이력을 들고 성숙분만 세는 가짜 포트.
 *
 * 날짜로 거르는 이유는 "3일 전 지급"이 시나리오의 조건이기 때문이다 —
 * 숫자만 돌려주면 서비스가 `maturedBefore`를 제대로 넘기는지 안 보인다.
 */
class FakeMatured implements MaturedPointReader {
  constructor(
    private readonly payouts: readonly { amount: number; paidAt: Date }[],
  ) {}

  maturedBalanceOf(_userId: string, maturedBefore: Date): Promise<number> {
    return Promise.resolve(
      this.payouts
        .filter((payout) => payout.paidAt <= maturedBefore)
        .reduce((sum, payout) => sum + payout.amount, 0),
    );
  }
}

class FakeStore implements ExchangeRequestStore {
  calls: { userId: string; amount: number }[] = [];
  result: ExchangeRequestRecord | 'INSUFFICIENT' | 'NOT_MATURED' = {
    id: 'exr_1',
    userId: USER,
    amount: 10_000,
    status: 'REQUESTED',
    createdAt: new Date('2026-09-06T00:00:00.000Z'),
  };

  create(input: {
    userId: string;
    amount: number;
  }): Promise<ExchangeRequestRecord | 'INSUFFICIENT' | 'NOT_MATURED'> {
    this.calls.push(input);
    return Promise.resolve(this.result);
  }
}

function setup(
  options: {
    verification?: AccountRecord['verificationStatus'] | 'NONE';
    payouts?: readonly { amount: number; paidAt: Date }[];
  } = {},
): {
  service: ExchangeRequestService;
  store: FakeStore;
  accounts: FakeAccounts;
} {
  const verification = options.verification ?? 'VERIFIED';
  const accounts = new FakeAccounts(
    verification === 'NONE' ? null : account(verification),
  );
  const store = new FakeStore();
  const service = new ExchangeRequestService(
    store,
    accounts,
    new FakeMatured(
      options.payouts ?? [{ amount: 20_000, paidAt: daysAgo(8) }],
    ),
  );
  return { service, store, accounts };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

function codeOf(error: unknown): string {
  expect(error).toBeInstanceOf(ExchangeError);
  return (error as ExchangeError).code;
}

describe('request', () => {
  it('should return the id, amount, status and requestedAt of the stored request', async () => {
    const { service } = setup();

    const summary = await service.request({ userId: USER, amount: 10_000 });

    expect(summary).toEqual({
      id: 'exr_1',
      amount: 10_000,
      status: 'REQUESTED',
      requestedAt: '2026-09-06T00:00:00.000Z',
    });
  });

  // 성숙액과 요청액이 같은 지점까지는 통과해야 한다. 여기서 막으면 마지막
  // 한 푼을 영영 못 찾아간다.
  it('should accept when the matured amount equals the requested amount exactly', async () => {
    const { service, store } = setup({
      payouts: [{ amount: 10_000, paidAt: daysAgo(8) }],
    });

    await service.request({ userId: USER, amount: 10_000 });

    expect(store.calls).toEqual([{ userId: USER, amount: 10_000 }]);
  });

  it('should throw EXCHANGE_BELOW_MIN_AMOUNT when 4000 is requested', async () => {
    const { service } = setup();

    const error = await rejectionOf(
      service.request({ userId: USER, amount: 4_000 }),
    );

    expect(codeOf(error)).toBe(EXCHANGE_ERRORS.BELOW_MIN_AMOUNT);
  });

  it('should throw EXCHANGE_INVALID_UNIT when 10005 is requested', async () => {
    const { service } = setup();

    const error = await rejectionOf(
      service.request({ userId: USER, amount: 10_005 }),
    );

    expect(codeOf(error)).toBe(EXCHANGE_ERRORS.INVALID_UNIT);
  });

  it('should throw EXCHANGE_NOT_MATURED when the points were paid out 3 days ago', async () => {
    const { service } = setup({
      payouts: [{ amount: 20_000, paidAt: daysAgo(3) }],
    });

    const error = await rejectionOf(
      service.request({ userId: USER, amount: 10_000 }),
    );

    expect(codeOf(error)).toBe(EXCHANGE_ERRORS.NOT_MATURED);
  });

  it('should throw EXCHANGE_ACCOUNT_NOT_VERIFIED when the account is PENDING', async () => {
    const { service } = setup({ verification: 'PENDING' });

    const error = await rejectionOf(
      service.request({ userId: USER, amount: 10_000 }),
    );

    expect(codeOf(error)).toBe(EXCHANGE_ERRORS.ACCOUNT_NOT_VERIFIED);
  });

  it('should throw EXCHANGE_ACCOUNT_NOT_VERIFIED when the account is REJECTED', async () => {
    const { service } = setup({ verification: 'REJECTED' });

    const error = await rejectionOf(
      service.request({ userId: USER, amount: 10_000 }),
    );

    expect(codeOf(error)).toBe(EXCHANGE_ERRORS.ACCOUNT_NOT_VERIFIED);
  });

  // 미등록도 같은 코드다. 요청하는 쪽에서 "검증 안 됨"과 "등록 안 됨"의
  // 대응이 같다.
  it('should throw EXCHANGE_ACCOUNT_NOT_VERIFIED when no account is registered', async () => {
    const { service } = setup({ verification: 'NONE' });

    const error = await rejectionOf(
      service.request({ userId: USER, amount: 10_000 }),
    );

    expect(codeOf(error)).toBe(EXCHANGE_ERRORS.ACCOUNT_NOT_VERIFIED);
  });

  // 입력값이 전제조건보다 먼저다. 잘못 친 숫자 때문에 DB를 읽지 않는다.
  it('should throw EXCHANGE_BELOW_MIN_AMOUNT without reading the account when 4000 is requested by a member who has no account', async () => {
    const { service, accounts } = setup({ verification: 'NONE' });

    const error = await rejectionOf(
      service.request({ userId: USER, amount: 4_000 }),
    );

    expect(codeOf(error)).toBe(EXCHANGE_ERRORS.BELOW_MIN_AMOUNT);
    expect(accounts.reads).toBe(0);
  });
});

// 서비스가 센 뒤 같은 회원의 다른 요청이 먼저 커밋한 경우다. 경합 테스트는
// 저장소를 직접 부르므로 이 매핑을 지나지 않는다.
describe('request — 저장소가 늦게 거절할 때', () => {
  it('should throw EXCHANGE_NOT_MATURED when the store rejects the write after another request has committed', async () => {
    const { service, store } = setup();
    store.result = 'NOT_MATURED';

    const error = await rejectionOf(
      service.request({ userId: USER, amount: 10_000 }),
    );

    expect(codeOf(error)).toBe(EXCHANGE_ERRORS.NOT_MATURED);
  });
});
