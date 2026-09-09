import { ADMIN_ERRORS } from '@fixer/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PublishNotificationInput } from '../notification/notification.service';
import { AdminError } from './admin-job-post.service';
import {
  AdminSuspensionService,
  type AdminSuspensionRow,
  type AdminSuspensionStore,
  type ReleasedSuspension,
} from './admin-suspension.service';

/**
 * 사유 검증과 알림 발행은 DB 없이 증명된다. (이슈 #33)
 *
 * **사유 없는 해제가 저장소를 건드리지 않는 것**이 여기서 보는 핵심이다 —
 * 진짜 DB로는 "안 썼다"를 증명하기보다 "안 불렀다"를 보는 편이 정확하다.
 * 목록 필터가 실제로 좁히는지와 트랜잭션 경계는 통합 테스트가 본다.
 */
const ROW: AdminSuspensionRow = {
  id: 'sus_1',
  userId: 'usr_penalized',
  userName: '김제재',
  startAt: new Date('2026-09-08T00:00:00.000Z'),
  endAt: new Date('2026-09-13T00:00:00.000Z'),
  reasons: ['NO_SHOW', 'LATE_CANCEL'],
  penaltyCount: 5,
};

/** 해제된 행 하나를 들고 있는 가짜 저장소 */
class FakeStore implements AdminSuspensionStore {
  releasedAt: Date | null = null;
  /** 같은 트랜잭션에 남는 감사 로그. 건수만 본다 */
  readonly auditLogs: { adminId: string; reason: string }[] = [];
  outcome: 'OK' | 'NOT_FOUND' | 'ALREADY_RELEASED' = 'OK';

  listActive(): Promise<{ items: AdminSuspensionRow[]; total: number }> {
    return Promise.resolve({ items: [ROW], total: 1 });
  }

  release(input: {
    suspensionId: string;
    adminId: string;
    reason: string;
    now: Date;
  }): Promise<ReleasedSuspension | 'NOT_FOUND' | 'ALREADY_RELEASED'> {
    if (this.outcome !== 'OK') return Promise.resolve(this.outcome);

    this.releasedAt = input.now;
    this.auditLogs.push({ adminId: input.adminId, reason: input.reason });
    return Promise.resolve({
      id: input.suspensionId,
      userId: ROW.userId,
      releasedAt: input.now,
      releasedBy: input.adminId,
    });
  }
}

let store: FakeStore;
let published: PublishNotificationInput[];
let service: AdminSuspensionService;

beforeEach(() => {
  store = new FakeStore();
  published = [];
  service = new AdminSuspensionService(store, {
    publish: (input) => {
      published.push(input);
      return Promise.resolve();
    },
  });
});

describe('AdminSuspensionService.list', () => {
  it('should return userName, startAt, endAt, reasons and penaltyCount for every active suspension', async () => {
    const list = await service.list({ page: 1 });

    expect(list.items).toEqual([
      {
        id: 'sus_1',
        userId: 'usr_penalized',
        userName: '김제재',
        startAt: '2026-09-08T00:00:00.000Z',
        endAt: '2026-09-13T00:00:00.000Z',
        reasons: ['NO_SHOW', 'LATE_CANCEL'],
        penaltyCount: 5,
      },
    ]);
  });
});

describe('AdminSuspensionService.release', () => {
  it('should publish a SUSPENSION_RELEASED notification to the released member', async () => {
    await service.release({
      adminId: 'usr_admin',
      suspensionId: 'sus_1',
      reason: '이의 인정',
    });

    expect(published).toEqual([
      expect.objectContaining({
        userId: 'usr_penalized',
        type: 'SUSPENSION_RELEASED',
      }),
    ]);
  });

  it('should throw ADMIN_REASON_REQUIRED when the reason is empty or only whitespace', async () => {
    const error = await service
      .release({ adminId: 'usr_admin', suspensionId: 'sus_1', reason: '   ' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AdminError);
    expect((error as AdminError).code).toBe(ADMIN_ERRORS.REASON_REQUIRED);
  });

  it('should leave releasedAt null when the reason is rejected', async () => {
    await service
      .release({ adminId: 'usr_admin', suspensionId: 'sus_1', reason: '' })
      .catch(() => undefined);

    expect(store.releasedAt).toBeNull();
  });

  it('should write no audit log and publish no notification when the reason is rejected', async () => {
    await service
      .release({ adminId: 'usr_admin', suspensionId: 'sus_1', reason: '' })
      .catch(() => undefined);

    expect([store.auditLogs.length, published.length]).toEqual([0, 0]);
  });

  it('should throw ADMIN_SUSPENSION_NOT_FOUND when the suspension does not exist', async () => {
    store.outcome = 'NOT_FOUND';

    const error = await service
      .release({
        adminId: 'usr_admin',
        suspensionId: 'sus_missing',
        reason: '이의 인정',
      })
      .catch((e: unknown) => e);

    expect((error as AdminError).code).toBe(ADMIN_ERRORS.SUSPENSION_NOT_FOUND);
  });

  it('should throw ADMIN_SUSPENSION_ALREADY_RELEASED when the suspension was already released', async () => {
    store.outcome = 'ALREADY_RELEASED';

    const error = await service
      .release({
        adminId: 'usr_admin',
        suspensionId: 'sus_1',
        reason: '이의 인정',
      })
      .catch((e: unknown) => e);

    expect((error as AdminError).code).toBe(
      ADMIN_ERRORS.SUSPENSION_ALREADY_RELEASED,
    );
  });
});
