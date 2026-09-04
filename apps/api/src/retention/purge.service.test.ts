import { ADVISORY_LOCK_KEYS, PURGED_NAME } from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import {
  PurgeService,
  type JobLock,
  type PurgeCandidate,
  type PurgeFileRemover,
  type PurgeStore,
} from './purge.service';

const NOW = new Date('2026-09-04T00:00:00.000Z');
const ONE_MINUTE = 60 * 1000;
const FOUR_MONTHS = 120 * 24 * 60 * 60 * 1000;
const KEY = ADVISORY_LOCK_KEYS.PURGE_PERSONAL_INFO;

/** 회원 한 명의 저장 상태. 파기가 무엇을 바꿨는지 그대로 드러낸다 */
interface Row {
  id: string;
  email: string;
  name: string;
  deactivatedAt: Date | null;
  purgedAt: Date | null;
  agreementFilePaths: string[];
  /** 파기해도 남아야 하는 것들 */
  ledgerRows: number;
  agreementSha256: string;
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'usr_1',
    email: 'worker@example.com',
    name: '김구직',
    deactivatedAt: new Date(NOW.getTime() - FOUR_MONTHS - 1),
    purgedAt: null,
    agreementFilePaths: ['agreements/abc.pdf'],
    ledgerRows: 3,
    agreementSha256: 'sha-of-the-signed-pdf',
    ...overrides,
  };
}

/**
 * 가짜 저장소.
 *
 * **`delete`를 갖지 않는다.** 파기가 행을 지우려 들면 타입에서 먼저 걸린다 —
 * 지우면 5년 보관해야 하는 계약·결제 기록의 FK가 함께 깨진다 (AC2).
 */
class FakeStore implements PurgeStore {
  constructor(readonly rows: Row[]) {}

  findPurgeable(deactivatedBefore: Date): Promise<PurgeCandidate[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (r) =>
            r.deactivatedAt !== null &&
            r.deactivatedAt < deactivatedBefore &&
            r.purgedAt === null,
        )
        .map((r) => ({ id: r.id, agreementFilePaths: r.agreementFilePaths })),
    );
  }

  maskMember(input: {
    userId: string;
    email: string;
    name: string;
    purgedAt: Date;
  }): Promise<void> {
    const target = this.rows.find((r) => r.id === input.userId);
    if (!target) throw new Error('없는 회원을 파기하려 했다');
    target.email = input.email;
    target.name = input.name;
    target.purgedAt = input.purgedAt;
    return Promise.resolve();
  }
}

class FakeFiles implements PurgeFileRemover {
  readonly removed: string[] = [];
  delete(filePath: string): Promise<void> {
    this.removed.push(filePath);
    return Promise.resolve();
  }
}

class FakeLock implements JobLock {
  locked = false;
  unlockCount = 0;
  constructor(private readonly grants = true) {}

  tryLock(): Promise<boolean> {
    if (!this.grants) return Promise.resolve(false);
    this.locked = true;
    return Promise.resolve(true);
  }
  unlock(): Promise<void> {
    this.locked = false;
    this.unlockCount += 1;
    return Promise.resolve();
  }
}

function setup(rows: Row[], opts: { lockGranted?: boolean } = {}) {
  const store = new FakeStore(rows);
  const files = new FakeFiles();
  const lock = new FakeLock(opts.lockGranted ?? true);
  return { service: new PurgeService(store, files, lock), rows, files, lock };
}

describe('purge — 4개월 지난 계정을 파기한다 (AC1)', () => {
  it('should mask the name of a member deactivated longer than the retention period', async () => {
    const { service, rows } = setup([row()]);

    await service.purge(NOW, FOUR_MONTHS, KEY);

    expect(rows[0].name).toBe(PURGED_NAME);
  });

  it('should replace the email with a deleted address that can never receive mail', async () => {
    // 유니크 제약이 유지되면서 그 주소로 다시 가입하면 신규 가입이 된다.
    const { service, rows } = setup([row()]);

    await service.purge(NOW, FOUR_MONTHS, KEY);

    expect(rows[0].email).toBe('deleted_usr_1@invalid');
  });

  it('should delete the agreement PDF file', async () => {
    const { service, files } = setup([row()]);

    await service.purge(NOW, FOUR_MONTHS, KEY);

    expect(files.removed).toEqual(['agreements/abc.pdf']);
  });

  it('should keep the agreement sha256 after deleting the file', async () => {
    // 나중에 그때 무엇에 서명했는지가 분쟁이 되면 원본 없이도 대조할 수 있다.
    const { service, rows } = setup([row()]);

    await service.purge(NOW, FOUR_MONTHS, KEY);

    expect(rows[0].agreementSha256).toBe('sha-of-the-signed-pdf');
  });

  it('should stamp purgedAt', async () => {
    const { service, rows } = setup([row()]);

    await service.purge(NOW, FOUR_MONTHS, KEY);

    expect(rows[0].purgedAt).toEqual(NOW);
  });

  it('should report what it purged', async () => {
    const { service } = setup([row()]);

    const report = await service.purge(NOW, FOUR_MONTHS, KEY);

    expect(report.purgedUserIds).toEqual(['usr_1']);
    expect(report.deletedAgreementFiles).toBe(1);
  });
});

describe('purge — 아직 이른 계정은 건드리지 않는다 (AC3)', () => {
  it('should not purge a member deactivated for only one month', async () => {
    const oneMonth = 30 * 24 * 60 * 60 * 1000;
    const { service, rows } = setup([
      row({ deactivatedAt: new Date(NOW.getTime() - oneMonth) }),
    ]);

    await service.purge(NOW, FOUR_MONTHS, KEY);

    expect(rows[0].name).toBe('김구직');
    expect(rows[0].purgedAt).toBeNull();
  });

  it('should not purge a member deactivated exactly at the retention boundary', async () => {
    // 경계는 아직 안 지난 것으로 본다. 하루라도 일찍 지우면 되돌릴 수 없다.
    const { service, rows } = setup([
      row({ deactivatedAt: new Date(NOW.getTime() - FOUR_MONTHS) }),
    ]);

    await service.purge(NOW, FOUR_MONTHS, KEY);

    expect(rows[0].purgedAt).toBeNull();
  });

  it('should purge one millisecond past the boundary', async () => {
    const { service, rows } = setup([
      row({ deactivatedAt: new Date(NOW.getTime() - FOUR_MONTHS - 1) }),
    ]);

    await service.purge(NOW, FOUR_MONTHS, KEY);

    expect(rows[0].purgedAt).toEqual(NOW);
  });

  it('should never purge an active member', async () => {
    const { service, rows } = setup([row({ deactivatedAt: null })]);

    await service.purge(NOW, FOUR_MONTHS, KEY);

    expect(rows[0].name).toBe('김구직');
  });
});

describe('purge — 기록은 그대로 남는다 (AC2)', () => {
  it('should keep the member row instead of deleting it', async () => {
    const { service, rows } = setup([row()]);

    await service.purge(NOW, FOUR_MONTHS, KEY);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('usr_1');
  });

  it('should keep the point ledger rows of the purged member', async () => {
    const { service, rows } = setup([row()]);

    await service.purge(NOW, FOUR_MONTHS, KEY);

    expect(rows[0].ledgerRows).toBe(3);
  });
});

describe('purge — 보관 기간을 주입할 수 있다 (AC5)', () => {
  it('should purge after one minute when the retention period is one minute', async () => {
    // 4개월을 실제로 기다릴 수는 없다. 그래서 상수를 주입한다.
    const { service, rows } = setup([
      row({ deactivatedAt: new Date(NOW.getTime() - ONE_MINUTE - 1) }),
    ]);

    await service.purge(NOW, ONE_MINUTE, KEY);

    expect(rows[0].purgedAt).toEqual(NOW);
  });

  it('should not purge before the injected minute has passed', async () => {
    const { service, rows } = setup([
      row({ deactivatedAt: new Date(NOW.getTime() - 30 * 1000) }),
    ]);

    await service.purge(NOW, ONE_MINUTE, KEY);

    expect(rows[0].purgedAt).toBeNull();
  });

  it('should be idempotent so a second run purges nothing', async () => {
    // purgedAt이 없으면 배치가 어제 파기한 계정을 오늘 또 훑는다.
    const { service, files } = setup([row()]);
    await service.purge(NOW, FOUR_MONTHS, KEY);

    const second = await service.purge(NOW, FOUR_MONTHS, KEY);

    expect(second.purgedUserIds).toHaveLength(0);
    expect(files.removed).toHaveLength(1);
  });
});

describe('purge — 중복 실행 방어 (spec-fixed §8.2)', () => {
  it('should return skippedByLock without touching anything when the advisory lock is held', async () => {
    const { service, rows, files } = setup([row()], { lockGranted: false });

    const report = await service.purge(NOW, FOUR_MONTHS, KEY);

    expect(report.skippedByLock).toBe(true);
    expect(rows[0].purgedAt).toBeNull();
    expect(files.removed).toHaveLength(0);
  });

  it('should release the advisory lock when it finishes', async () => {
    const { service, lock } = setup([row()]);

    await service.purge(NOW, FOUR_MONTHS, KEY);

    expect(lock.locked).toBe(false);
    expect(lock.unlockCount).toBe(1);
  });

  it('should release the advisory lock even when the store throws', async () => {
    // 안 풀면 다음 실행이 영원히 막힌다.
    const files = new FakeFiles();
    const lock = new FakeLock();
    const broken: PurgeStore = {
      findPurgeable: () => Promise.reject(new Error('DB가 죽었다')),
      maskMember: () => Promise.resolve(),
    };
    const service = new PurgeService(broken, files, lock);

    await service.purge(NOW, FOUR_MONTHS, KEY).catch(() => undefined);

    expect(lock.locked).toBe(false);
    expect(lock.unlockCount).toBe(1);
  });
});
