import {
  ADVISORY_LOCK_KEYS,
  UNDERFILL_NOTICE_LEAD_MS,
  type JobPostStatus,
} from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import type { JobLock } from '../retention/purge.service';
import {
  JobPostScheduleService,
  type JobPostScheduleStore,
  type StartedJobPost,
  type UnderfilledJobPost,
} from './job-post-schedule.service';
import type {
  NotificationPublisher,
  PublishNotificationInput,
} from './notification.service';

const NOW = new Date('2026-09-08T09:00:00.000Z');
const LEAD = UNDERFILL_NOTICE_LEAD_MS;
const NOTIFY_KEY = ADVISORY_LOCK_KEYS.NOTIFY_UNDERFILLED_JOB_POST;
const CLOSE_KEY = ADVISORY_LOCK_KEYS.CLOSE_STARTED_JOB_POST;
const SECOND = 1000;

/** 공고 한 건의 저장 상태. 잡이 무엇을 바꿨는지 그대로 드러난다 */
interface Row {
  id: string;
  employerId: string;
  title: string;
  status: JobPostStatus;
  headcount: number;
  acceptedCount: number;
  workStartAt: Date;
  underfilledNotifiedAt: Date | null;
  deletedAt: Date | null;
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'job_1',
    employerId: 'usr_employer',
    title: '이사 짐 나르기',
    status: 'OPEN',
    headcount: 3,
    acceptedCount: 1,
    // 기본값은 창 한가운데다 — 2시간 뒤 시작
    workStartAt: new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
    underfilledNotifiedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

/**
 * 가짜 저장소. 조건절을 그대로 옮겨 담는다.
 *
 * 여기서 거르는 것이 실제 SQL이 거르는 것과 같아야 한다 — 그래서 같은 조건을
 * 진짜 Postgres에도 물어보는 통합 테스트를 따로 둔다.
 */
class FakeStore implements JobPostScheduleStore {
  constructor(readonly rows: Row[]) {}

  findUnderfilled(after: Date, until: Date): Promise<UnderfilledJobPost[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (r) =>
            r.status === 'OPEN' &&
            r.deletedAt === null &&
            r.underfilledNotifiedAt === null &&
            r.acceptedCount < r.headcount &&
            r.workStartAt > after &&
            r.workStartAt <= until,
        )
        .map((r) => ({
          id: r.id,
          employerId: r.employerId,
          title: r.title,
          headcount: r.headcount,
          acceptedCount: r.acceptedCount,
          workStartAt: r.workStartAt,
        })),
    );
  }

  markNotified(jobPostId: string, notifiedAt: Date): Promise<boolean> {
    const target = this.rows.find((r) => r.id === jobPostId);
    if (!target || target.underfilledNotifiedAt !== null) {
      return Promise.resolve(false);
    }
    target.underfilledNotifiedAt = notifiedAt;
    return Promise.resolve(true);
  }

  findStarted(now: Date): Promise<StartedJobPost[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (r) =>
            r.status === 'OPEN' && r.deletedAt === null && r.workStartAt <= now,
        )
        .map((r) => ({
          id: r.id,
          headcount: r.headcount,
          acceptedCount: r.acceptedCount,
        })),
    );
  }

  close(jobPostId: string, to: 'CLOSED' | 'EXPIRED'): Promise<boolean> {
    const target = this.rows.find((r) => r.id === jobPostId);
    if (!target || target.status !== 'OPEN') return Promise.resolve(false);
    target.status = to;
    return Promise.resolve(true);
  }
}

/** 발행된 알림을 모아두는 가짜 포트 */
class FakePublisher implements NotificationPublisher {
  readonly published: PublishNotificationInput[] = [];
  /** 이 회원에게 발행하면 터진다. 어댑터가 계약을 어긴 상황을 흉내낸다 */
  constructor(private readonly failFor?: string) {}

  publish(input: PublishNotificationInput): Promise<void> {
    if (input.userId === this.failFor) {
      return Promise.reject(new Error('알림 어댑터가 터졌다'));
    }
    this.published.push(input);
    return Promise.resolve();
  }
}

class FakeLock implements JobLock {
  locked = false;
  unlockCount = 0;
  constructor(private readonly granted = true) {}

  tryLock(): Promise<boolean> {
    if (!this.granted) return Promise.resolve(false);
    this.locked = true;
    return Promise.resolve(true);
  }

  unlock(): Promise<void> {
    this.locked = false;
    this.unlockCount += 1;
    return Promise.resolve();
  }
}

function setup(
  rows: Row[],
  options: { lockGranted?: boolean; failFor?: string } = {},
) {
  const store = new FakeStore(rows);
  const notifications = new FakePublisher(options.failFor);
  const lock = new FakeLock(options.lockGranted ?? true);
  const service = new JobPostScheduleService(store, notifications, lock);
  return { service, store, notifications, lock, rows };
}

describe('notifyUnderfilled', () => {
  it('should publish a JOB_POST_UNDERFILLED notification to the employer when an OPEN post starts within the lead time and is under-filled', async () => {
    const { service, notifications } = setup([row()]);

    const report = await service.notifyUnderfilled(NOW, LEAD, NOTIFY_KEY);

    expect(report.notifiedJobPostIds).toEqual(['job_1']);
    expect(notifications.published).toHaveLength(1);
    expect(notifications.published[0]).toMatchObject({
      userId: 'usr_employer',
      type: 'JOB_POST_UNDERFILLED',
    });
  });

  it('should tell the employer the 연장·삭제·유지 choices and link to the post', async () => {
    const { service, notifications } = setup([row()]);

    await service.notifyUnderfilled(NOW, LEAD, NOTIFY_KEY);

    const [sent] = notifications.published;
    // AC1이 요구하는 것은 세 선택지를 알리는 것이다. 실행 화면은 #15·#16이다.
    expect(sent.body).toContain('연장');
    expect(sent.body).toContain('삭제');
    expect(sent.body).toContain('유지');
    expect(sent.linkUrl).toBe('/job-posts/job_1');
  });

  it('should publish nothing on a second run over the same post', async () => {
    const { service, notifications } = setup([row()]);
    await service.notifyUnderfilled(NOW, LEAD, NOTIFY_KEY);

    const second = await service.notifyUnderfilled(NOW, LEAD, NOTIFY_KEY);

    expect(second.notifiedJobPostIds).toHaveLength(0);
    expect(notifications.published).toHaveLength(1);
  });

  it('should leave the notified post OPEN and undeleted so no answer means keeping it', async () => {
    // 미응답의 기본값은 유지다 (AC5). 잡이 대신 지우거나 마감하지 않는다.
    const { service, rows } = setup([row()]);

    await service.notifyUnderfilled(NOW, LEAD, NOTIFY_KEY);

    expect(rows[0].status).toBe('OPEN');
    expect(rows[0].deletedAt).toBeNull();
  });

  it('should report skippedByLock and publish nothing when the lock is held elsewhere', async () => {
    const { service, notifications, rows } = setup([row()], {
      lockGranted: false,
    });

    const report = await service.notifyUnderfilled(NOW, LEAD, NOTIFY_KEY);

    expect(report.skippedByLock).toBe(true);
    expect(notifications.published).toHaveLength(0);
    expect(rows[0].underfilledNotifiedAt).toBeNull();
  });

  it('should release the lock when it finishes', async () => {
    // 안 풀면 다음 1분에 이 잡이 영원히 막힌다.
    const { service, lock } = setup([row()]);

    await service.notifyUnderfilled(NOW, LEAD, NOTIFY_KEY);

    expect(lock.locked).toBe(false);
    expect(lock.unlockCount).toBe(1);
  });

  it('should notify a post whose start is exactly the lead time away', async () => {
    const { service, notifications } = setup([
      row({ workStartAt: new Date(NOW.getTime() + LEAD) }),
    ]);

    await service.notifyUnderfilled(NOW, LEAD, NOTIFY_KEY);

    expect(notifications.published).toHaveLength(1);
  });

  it('should not notify a post whose start is one second beyond the lead time', async () => {
    const { service, notifications } = setup([
      row({ workStartAt: new Date(NOW.getTime() + LEAD + SECOND) }),
    ]);

    await service.notifyUnderfilled(NOW, LEAD, NOTIFY_KEY);

    expect(notifications.published).toHaveLength(0);
  });

  it('should not notify a post whose seats are already full', async () => {
    const { service, notifications } = setup([
      row({ headcount: 3, acceptedCount: 3 }),
    ]);

    await service.notifyUnderfilled(NOW, LEAD, NOTIFY_KEY);

    expect(notifications.published).toHaveLength(0);
  });

  it('should publish nothing when another runner claimed the post first', async () => {
    // 목록을 읽은 뒤 표시하기 전에 다른 인스턴스가 가져갔다.
    const store = new FakeStore([row()]);
    store.markNotified = () => Promise.resolve(false);
    const notifications = new FakePublisher();
    const service = new JobPostScheduleService(
      store,
      notifications,
      new FakeLock(),
    );

    const report = await service.notifyUnderfilled(NOW, LEAD, NOTIFY_KEY);

    expect(notifications.published).toHaveLength(0);
    expect(report.notifiedJobPostIds).toHaveLength(0);
  });

  it('should report the post as notified without closing or expiring it', async () => {
    const { service, rows } = setup([row()]);

    const report = await service.notifyUnderfilled(NOW, LEAD, NOTIFY_KEY);

    expect(report.notifiedJobPostIds).toEqual(['job_1']);
    expect(rows[0].status).toBe('OPEN');
  });

  it('should keep publishing to the rest when one publish fails', async () => {
    // 한 구인자 때문에 나머지가 알림을 못 받으면 안 된다. 이미 표시까지
    // 끝난 뒤라 다음 실행이 다시 집어주지도 않는다.
    const { service, notifications } = setup(
      [
        row({ id: 'job_1', employerId: 'usr_broken' }),
        row({ id: 'job_2', employerId: 'usr_fine' }),
      ],
      { failFor: 'usr_broken' },
    );

    await service.notifyUnderfilled(NOW, LEAD, NOTIFY_KEY);

    expect(notifications.published).toHaveLength(1);
    expect(notifications.published[0].userId).toBe('usr_fine');
  });
});

describe('closeStarted', () => {
  it('should close a post whose seats are full when its start time has passed', async () => {
    const { service, rows } = setup([
      row({
        headcount: 3,
        acceptedCount: 3,
        workStartAt: new Date(NOW.getTime() - SECOND),
      }),
    ]);

    const report = await service.closeStarted(NOW, CLOSE_KEY);

    expect(rows[0].status).toBe('CLOSED');
    expect(report.closedJobPostIds).toEqual(['job_1']);
    expect(report.expiredJobPostIds).toHaveLength(0);
  });

  it('should expire an under-filled post when its start time has passed', async () => {
    const { service, rows } = setup([
      row({
        headcount: 3,
        acceptedCount: 2,
        workStartAt: new Date(NOW.getTime() - SECOND),
      }),
    ]);

    const report = await service.closeStarted(NOW, CLOSE_KEY);

    expect(rows[0].status).toBe('EXPIRED');
    expect(report.expiredJobPostIds).toEqual(['job_1']);
  });

  it('should report skippedByLock and change no status when the lock is held elsewhere', async () => {
    const { service, rows } = setup(
      [row({ workStartAt: new Date(NOW.getTime() - SECOND) })],
      { lockGranted: false },
    );

    const report = await service.closeStarted(NOW, CLOSE_KEY);

    expect(report.skippedByLock).toBe(true);
    expect(rows[0].status).toBe('OPEN');
  });

  it('should close a post exactly at its start time', async () => {
    const { service, rows } = setup([
      row({ headcount: 2, acceptedCount: 2, workStartAt: NOW }),
    ]);

    await service.closeStarted(NOW, CLOSE_KEY);

    expect(rows[0].status).toBe('CLOSED');
  });

  it('should leave a post OPEN one second before its start time', async () => {
    const { service, rows } = setup([
      row({
        headcount: 2,
        acceptedCount: 2,
        workStartAt: new Date(NOW.getTime() + SECOND),
      }),
    ]);

    await service.closeStarted(NOW, CLOSE_KEY);

    expect(rows[0].status).toBe('OPEN');
  });

  it('should expire a post nobody was accepted for', async () => {
    const { service, rows } = setup([
      row({ acceptedCount: 0, workStartAt: new Date(NOW.getTime() - SECOND) }),
    ]);

    await service.closeStarted(NOW, CLOSE_KEY);

    expect(rows[0].status).toBe('EXPIRED');
  });

  it('should expire a notified post that got no response once its start time passes', async () => {
    // 알림 → 미응답 → 유지 → 시작 시각 도달. AC5의 기본값이 끝나는 지점이다.
    const { service, rows } = setup([row()]);
    await service.notifyUnderfilled(NOW, LEAD, NOTIFY_KEY);
    const started = new Date(rows[0].workStartAt.getTime() + SECOND);

    await service.closeStarted(started, CLOSE_KEY);

    expect(rows[0].status).toBe('EXPIRED');
  });

  it('should release the lock even when the store throws', async () => {
    const lock = new FakeLock();
    const broken = {
      findStarted: () => Promise.reject(new Error('DB가 죽었다')),
    } as unknown as JobPostScheduleStore;
    const service = new JobPostScheduleService(
      broken,
      new FakePublisher(),
      lock,
    );

    await service.closeStarted(NOW, CLOSE_KEY).catch(() => undefined);

    expect(lock.locked).toBe(false);
    expect(lock.unlockCount).toBe(1);
  });
});
