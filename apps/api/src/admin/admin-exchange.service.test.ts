import {
  ACCOUNT_ERRORS,
  ADMIN_ACTIONS,
  ADMIN_ERRORS,
  EXCHANGE_ERRORS,
  type ExchangeRequestStatus,
} from '@fixer/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { AccountError } from '../exchange/exchange-account.service';
import type { ExchangeRequestRecord } from '../exchange/exchange-request.service';
import {
  AdminExchangeService,
  type AdminExchangeRow,
  type AdminExchangeStore,
} from './admin-exchange.service';
import type { PublishNotificationInput } from '../notification/notification.service';

/**
 * 관리자 환전 관리. (이슈 #34)
 *
 * 저장소는 가짜다 — 상태 전이 판정과 게이트 순서가 여기서 검증할 것이고,
 * 원장·감사 로그가 실제로 한 트랜잭션에 실리는지는 통합 테스트가 본다.
 */
const ROW: AdminExchangeRow = {
  id: 'exr_1',
  userId: 'usr_1',
  amount: 10_000,
  status: 'REQUESTED',
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  requesterName: '김구직',
  account: {
    bankCode: '088',
    accountNumberLast4: '5678',
    holderName: '김구직',
    verificationStatus: 'VERIFIED',
  },
};

function recordOf(status: ExchangeRequestStatus): ExchangeRequestRecord {
  return {
    id: ROW.id,
    userId: ROW.userId,
    amount: ROW.amount,
    status,
    createdAt: ROW.createdAt,
  };
}

interface Calls {
  updateStatus: {
    requestId: string;
    nextStatus: ExchangeRequestStatus;
    adminId: string;
    action: string;
  }[];
  reject: { requestId: string; adminId: string; reason: string }[];
  audit: { adminId: string; action: string; targetId: string }[];
  published: PublishNotificationInput[];
}

let calls: Calls;

beforeEach(() => {
  calls = { updateStatus: [], reject: [], audit: [], published: [] };
});

/** 가짜 저장소. `found`가 `findById`의 답이고 `stale`이면 쓰기가 거절된다 */
function makeStore(options: {
  found?: ExchangeRequestRecord | null;
  stale?: boolean;
  rows?: AdminExchangeRow[];
}): AdminExchangeStore {
  return {
    listAll: () =>
      Promise.resolve({
        items: options.rows ?? [ROW],
        total: (options.rows ?? [ROW]).length,
      }),
    findById: () => Promise.resolve(options.found ?? null),
    updateStatus: (input) => {
      calls.updateStatus.push({
        requestId: input.requestId,
        nextStatus: input.nextStatus,
        adminId: input.adminId,
        action: input.action,
      });
      return Promise.resolve(
        options.stale === true ? 'STALE' : recordOf(input.nextStatus),
      );
    },
    reject: (input) => {
      calls.reject.push({
        requestId: input.requestId,
        adminId: input.adminId,
        reason: input.reason,
      });
      return Promise.resolve(
        options.stale === true ? 'STALE' : recordOf('REJECTED'),
      );
    },
    recordAudit: (input) => {
      calls.audit.push(input);
      return Promise.resolve();
    },
  };
}

const NOTIFICATIONS = {
  publish: (input: PublishNotificationInput) => {
    calls.published.push(input);
    return Promise.resolve();
  },
};

function makeService(
  store: AdminExchangeStore,
  accountNumber: string | null = '11012345678',
): AdminExchangeService {
  return new AdminExchangeService(
    store,
    {
      revealForPayout: () =>
        accountNumber === null
          ? Promise.reject(new AccountError(ACCOUNT_ERRORS.NOT_REGISTERED))
          : Promise.resolve(accountNumber),
    },
    NOTIFICATIONS,
  );
}

describe('list', () => {
  it('should return the requester name, amount, masked account and verification status of every row', async () => {
    const list = await makeService(makeStore({})).list({ page: 1 });

    expect(list.items[0]).toMatchObject({
      requesterName: '김구직',
      amount: 10_000,
      account: {
        bankName: '신한은행',
        maskedAccountNumber: '****5678',
        verificationStatus: 'VERIFIED',
      },
    });
  });
});

describe('approve', () => {
  it('should move a REQUESTED request to APPROVED', async () => {
    const service = makeService(makeStore({ found: recordOf('REQUESTED') }));

    await expect(
      service.approve({ adminId: 'adm_1', requestId: 'exr_1' }),
    ).resolves.toEqual({ id: 'exr_1', status: 'APPROVED' });
  });

  it('should throw EXCHANGE_REQUEST_NOT_FOUND when no such request exists', async () => {
    const service = makeService(makeStore({ found: null }));

    await expect(
      service.approve({ adminId: 'adm_1', requestId: 'nope' }),
    ).rejects.toMatchObject({ code: EXCHANGE_ERRORS.REQUEST_NOT_FOUND });
  });

  it('should throw EXCHANGE_INVALID_TRANSITION when the request is already APPROVED', async () => {
    const service = makeService(makeStore({ found: recordOf('APPROVED') }));

    await expect(
      service.approve({ adminId: 'adm_1', requestId: 'exr_1' }),
    ).rejects.toMatchObject({ code: EXCHANGE_ERRORS.INVALID_TRANSITION });
  });

  // 우리가 읽은 뒤 다른 관리자가 먼저 커밋했다. 저장소가 최종 판정자다.
  it('should throw EXCHANGE_INVALID_TRANSITION when the store reports STALE after another admin committed first', async () => {
    const service = makeService(
      makeStore({ found: recordOf('REQUESTED'), stale: true }),
    );

    await expect(
      service.approve({ adminId: 'adm_1', requestId: 'exr_1' }),
    ).rejects.toMatchObject({ code: EXCHANGE_ERRORS.INVALID_TRANSITION });
  });
});

describe('complete', () => {
  it('should move an APPROVED request to COMPLETED', async () => {
    const service = makeService(makeStore({ found: recordOf('APPROVED') }));

    await expect(
      service.complete({ adminId: 'adm_1', requestId: 'exr_1' }),
    ).resolves.toEqual({ id: 'exr_1', status: 'COMPLETED' });
  });

  it('should throw EXCHANGE_INVALID_TRANSITION when the request is still REQUESTED', async () => {
    const service = makeService(makeStore({ found: recordOf('REQUESTED') }));

    await expect(
      service.complete({ adminId: 'adm_1', requestId: 'exr_1' }),
    ).rejects.toMatchObject({ code: EXCHANGE_ERRORS.INVALID_TRANSITION });
  });
});

describe('reject', () => {
  it('should publish an EXCHANGE_REJECTED notification to the requester', async () => {
    const service = makeService(makeStore({ found: recordOf('REQUESTED') }));

    await service.reject({
      adminId: 'adm_1',
      requestId: 'exr_1',
      reason: '예금주가 다릅니다',
    });

    expect(calls.published).toEqual([
      expect.objectContaining({ userId: 'usr_1', type: 'EXCHANGE_REJECTED' }),
    ]);
  });

  it('should throw EXCHANGE_INVALID_TRANSITION when the request is already COMPLETED', async () => {
    const service = makeService(makeStore({ found: recordOf('COMPLETED') }));

    await expect(
      service.reject({ adminId: 'adm_1', requestId: 'exr_1', reason: '착오' }),
    ).rejects.toMatchObject({ code: EXCHANGE_ERRORS.INVALID_TRANSITION });
  });

  it('should throw ADMIN_REASON_REQUIRED when the reason is blank', async () => {
    const service = makeService(makeStore({ found: recordOf('REQUESTED') }));

    await expect(
      service.reject({ adminId: 'adm_1', requestId: 'exr_1', reason: '   ' }),
    ).rejects.toMatchObject({ code: ADMIN_ERRORS.REASON_REQUIRED });
  });

  // 사유 없는 조치는 저장소도 원장도 건드리지 않는다 (#35와 같은 순서다).
  it('should touch neither the request nor the ledger when the reason is blank', async () => {
    const service = makeService(makeStore({ found: recordOf('REQUESTED') }));

    await service
      .reject({ adminId: 'adm_1', requestId: 'exr_1', reason: '' })
      .catch(() => undefined);

    expect(calls.reject).toHaveLength(0);
  });

  // 아무것도 안 바뀌었는데 "반려됐습니다"가 가면 안 된다.
  it('should not notify the requester when the store reports STALE', async () => {
    const service = makeService(
      makeStore({ found: recordOf('REQUESTED'), stale: true }),
    );

    await service
      .reject({ adminId: 'adm_1', requestId: 'exr_1', reason: '착오' })
      .catch(() => undefined);

    expect(calls.published).toHaveLength(0);
  });
});

describe('revealAccount', () => {
  it('should return the full account number', async () => {
    const service = makeService(makeStore({ found: recordOf('APPROVED') }));

    await expect(
      service.revealAccount({ adminId: 'adm_1', requestId: 'exr_1' }),
    ).resolves.toEqual({ accountNumber: '11012345678' });
  });

  it('should record an EXCHANGE_ACCOUNT_REVEAL audit log naming the admin and the request', async () => {
    const service = makeService(makeStore({ found: recordOf('APPROVED') }));

    await service.revealAccount({ adminId: 'adm_1', requestId: 'exr_1' });

    expect(calls.audit).toEqual([
      {
        adminId: 'adm_1',
        action: ADMIN_ACTIONS.EXCHANGE_ACCOUNT_REVEAL,
        targetId: 'exr_1',
      },
    ]);
  });

  // 못 본 것을 봤다고 남기면 그 표가 근거가 되지 못한다.
  it('should throw ACCOUNT_NOT_REGISTERED and record no audit log when the requester has no account', async () => {
    const service = makeService(
      makeStore({ found: recordOf('APPROVED') }),
      null,
    );

    await expect(
      service.revealAccount({ adminId: 'adm_1', requestId: 'exr_1' }),
    ).rejects.toMatchObject({ code: ACCOUNT_ERRORS.NOT_REGISTERED });
    expect(calls.audit).toHaveLength(0);
  });
});
