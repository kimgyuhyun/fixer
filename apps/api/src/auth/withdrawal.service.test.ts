import {
  WITHDRAWAL_BLOCKERS,
  WITHDRAWAL_ERRORS,
  type WithdrawalBlocker,
} from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import {
  WithdrawalService,
  type WithdrawalGuard,
  type WithdrawalMemberStore,
} from './withdrawal.service';

const USER = 'usr_1';
const NOW = new Date('2026-09-04T00:00:00.000Z');

class FakeMemberStore implements WithdrawalMemberStore {
  deactivatedAt: Date | null = null;
  constructor(private readonly exists = true) {}

  /** 몇 번 찍혔는지. 두 번째 탈퇴가 기한을 미루지 않는지 보는 데 쓴다 */
  stampCount = 0;

  findDeactivatedAt(): Promise<Date | null | undefined> {
    return Promise.resolve(this.exists ? this.deactivatedAt : undefined);
  }
  deactivate(_userId: string, at: Date): Promise<void> {
    this.deactivatedAt = at;
    this.stampCount += 1;
    return Promise.resolve();
  }
}

class FakeRefreshTokenStore {
  readonly deletedFor: string[] = [];
  deleteAllForUser(userId: string): Promise<void> {
    this.deletedFor.push(userId);
    return Promise.resolve();
  }
  create(): never {
    throw new Error('탈퇴는 토큰을 발급하지 않는다');
  }
  findByTokenHash(): never {
    throw new Error('탈퇴는 토큰을 조회하지 않는다');
  }
  deleteByTokenHash(): never {
    throw new Error('탈퇴는 세션 하나만 지우지 않는다. 전부 지운다');
  }
}

/**
 * 원장은 **합계만** 본다. 캐시가 아니다 — `ADR-PAY-1`대로 금전 판정은
 * 원장 합산이고, 캐시가 틀렸는데 0인 줄 알고 탈퇴시키면 돈이 묶인 채
 * 계정이 잠긴다.
 */
class FakeLedgerStore {
  constructor(
    private readonly sum: number,
    /** 일부러 어긋뜨린다. 서비스가 이쪽을 보면 테스트가 잡는다 */
    private readonly cached = 0,
  ) {}
  sumBalance(): Promise<number> {
    return Promise.resolve(this.sum);
  }
  readCachedBalance(): Promise<number> {
    return Promise.resolve(this.cached);
  }
  append(): never {
    throw new Error('탈퇴는 원장에 쓰지 않는다');
  }
  findByIdempotencyKey(): never {
    throw new Error('탈퇴는 원장을 조회하지 않는다');
  }
}

/** 아직 없는 도메인(#12·#17)을 흉내 낸다 */
function guard(
  opts: { contract?: boolean; jobPost?: boolean } = {},
): WithdrawalGuard {
  return {
    hasActiveContract: () => Promise.resolve(opts.contract ?? false),
    hasOpenJobPost: () => Promise.resolve(opts.jobPost ?? false),
  };
}

function setup(
  opts: {
    balance?: number;
    cachedBalance?: number;
    contract?: boolean;
    jobPost?: boolean;
    exists?: boolean;
    alreadyWithdrawnAt?: Date;
  } = {},
) {
  const members = new FakeMemberStore(opts.exists ?? true);
  members.deactivatedAt = opts.alreadyWithdrawnAt ?? null;
  const refreshTokens = new FakeRefreshTokenStore();
  const ledger = new FakeLedgerStore(
    opts.balance ?? 0,
    opts.cachedBalance ?? 0,
  );
  const service = new WithdrawalService(
    members,
    refreshTokens,
    ledger,
    guard(opts),
  );
  return { service, members, refreshTokens };
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

function reasonsOf(error: unknown): WithdrawalBlocker[] {
  return (error as { reasons?: WithdrawalBlocker[] }).reasons ?? [];
}

describe('withdraw — 성공', () => {
  it('should stamp deactivatedAt', async () => {
    const { service, members } = setup();

    await service.withdraw(USER, NOW);

    expect(members.deactivatedAt).toEqual(NOW);
  });

  it('should delete every refresh token of that member', async () => {
    // §2.6 — 비활성화 시 모든 Refresh 토큰 삭제
    const { service, refreshTokens } = setup();

    await service.withdraw(USER, NOW);

    expect(refreshTokens.deletedFor).toEqual([USER]);
  });
});

describe('withdraw — 잔액이 남으면 막힌다', () => {
  it('should reject with AUTH_WITHDRAWAL_BLOCKED when the balance is positive', async () => {
    const { service } = setup({ balance: 5_000 });

    const error = await rejectionOf(service.withdraw(USER, NOW));

    expect(codeOf(error)).toBe(WITHDRAWAL_ERRORS.BLOCKED);
  });

  it('should say 남은 포인트를 환전한 뒤 as the reason', async () => {
    const { service } = setup({ balance: 5_000 });

    const error = await rejectionOf(service.withdraw(USER, NOW));

    expect(reasonsOf(error)).toContain(WITHDRAWAL_BLOCKERS.POSITIVE_BALANCE);
  });

  it('should allow withdrawing when the balance is exactly zero', async () => {
    const { service, members } = setup({ balance: 0 });

    await service.withdraw(USER, NOW);

    expect(members.deactivatedAt).toEqual(NOW);
  });

  it('should check the ledger sum, not the cached balance', async () => {
    // 캐시는 0이라고 하지만 원장에는 5000이 남아 있다. 캐시를 믿으면
    // 돈이 묶인 채 계정이 잠긴다.
    const { service } = setup({ balance: 5_000, cachedBalance: 0 });

    const error = await rejectionOf(service.withdraw(USER, NOW));

    expect(reasonsOf(error)).toContain(WITHDRAWAL_BLOCKERS.POSITIVE_BALANCE);
  });
});

describe('withdraw — 진행 중 계약이 있으면 막힌다', () => {
  it('should reject when an active contract exists', async () => {
    const { service } = setup({ contract: true });

    const error = await rejectionOf(service.withdraw(USER, NOW));

    expect(codeOf(error)).toBe(WITHDRAWAL_ERRORS.BLOCKED);
  });

  it('should say 진행 중인 일거리 as the reason', async () => {
    const { service } = setup({ contract: true });

    const error = await rejectionOf(service.withdraw(USER, NOW));

    expect(reasonsOf(error)).toContain(WITHDRAWAL_BLOCKERS.ACTIVE_CONTRACT);
  });
});

describe('withdraw — 본인 공고가 있으면 막힌다', () => {
  it('should reject when an open job post exists', async () => {
    const { service } = setup({ jobPost: true });

    const error = await rejectionOf(service.withdraw(USER, NOW));

    expect(codeOf(error)).toBe(WITHDRAWAL_ERRORS.BLOCKED);
  });

  it('should say 등록한 공고를 마감한 뒤 as the reason', async () => {
    const { service } = setup({ jobPost: true });

    const error = await rejectionOf(service.withdraw(USER, NOW));

    expect(reasonsOf(error)).toContain(WITHDRAWAL_BLOCKERS.OPEN_JOB_POST);
  });
});

describe('withdraw — 회원이 그 상태가 아닐 때', () => {
  it('should reject with AUTH_MEMBER_NOT_FOUND when the member does not exist', async () => {
    // 토큰은 살아 있는데 행이 사라진 경우다. 그냥 두면 Prisma가 P2025로
    // 터져 500이 나간다 — 사용자 잘못이 아닌 것처럼 보인다.
    const { service } = setup({ exists: false });

    const error = await rejectionOf(service.withdraw(USER, NOW));

    expect(codeOf(error)).toBe(WITHDRAWAL_ERRORS.NOT_FOUND);
  });

  it('should not re-stamp deactivatedAt when the member already withdrew', async () => {
    // 다시 찍으면 파기 기한(#39, 비활성 4개월)이 그만큼 미뤄져
    // 개인정보가 더 오래 남는다.
    const first = new Date('2026-05-01T00:00:00.000Z');
    const { service, members } = setup({ alreadyWithdrawnAt: first });

    await service.withdraw(USER, NOW);

    expect(members.deactivatedAt).toEqual(first);
    expect(members.stampCount).toBe(0);
  });
});

describe('withdraw — 여러 조건에 걸릴 때', () => {
  it('should report every blocking reason, not just the first', async () => {
    // 하나씩 알려주면 고치고 다시 시도하기를 세 번 반복하게 된다
    const { service } = setup({
      balance: 5_000,
      contract: true,
      jobPost: true,
    });

    const error = await rejectionOf(service.withdraw(USER, NOW));

    expect(reasonsOf(error)).toHaveLength(3);
  });

  it('should not touch the member when it rejected', async () => {
    const { service, members, refreshTokens } = setup({ balance: 5_000 });

    await rejectionOf(service.withdraw(USER, NOW));

    expect(members.deactivatedAt).toBeNull();
    expect(refreshTokens.deletedFor).toHaveLength(0);
  });
});
