import { NOTIFICATION_ERRORS, NOTIFICATION_PAGE_SIZE } from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import {
  NotificationError,
  NotificationService,
  type NotificationRecord,
  type NotificationStore,
  type PublishNotificationInput,
} from './notification.service';

const USER = 'usr_1';
const OTHER = 'usr_2';

function publishInput(
  overrides: Partial<PublishNotificationInput> = {},
): PublishNotificationInput {
  return {
    userId: USER,
    type: 'ACCOUNT_VERIFIED',
    title: '계좌 검증이 끝났습니다',
    body: '신한은행 ****5678 계좌를 쓸 수 있습니다.',
    linkUrl: '/my/account',
    ...overrides,
  };
}

/** 메모리 저장소. 진짜 DB 동작은 통합 테스트가 본다 */
class FakeStore implements NotificationStore {
  rows: NotificationRecord[] = [];
  private serial = 0;

  insert(input: PublishNotificationInput): Promise<void> {
    this.serial += 1;
    this.rows.push({
      id: `ntf_${this.serial}`,
      ...input,
      readAt: null,
      // 뒤에 넣은 것이 더 최근이 되도록 1초씩 벌린다.
      createdAt: new Date(Date.UTC(2026, 8, 5, 0, 0, this.serial)),
    });
    return Promise.resolve();
  }

  listRecent(userId: string, limit: number): Promise<NotificationRecord[]> {
    return Promise.resolve(
      this.rows
        .filter((row) => row.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit),
    );
  }

  countUnread(userId: string): Promise<number> {
    return Promise.resolve(
      this.rows.filter((row) => row.userId === userId && row.readAt === null)
        .length,
    );
  }

  markRead(userId: string, id: string): Promise<NotificationRecord | null> {
    const row = this.rows.find((r) => r.id === id && r.userId === userId);
    if (row === undefined) return Promise.resolve(null);
    // 첫 읽음 시각을 유지한다.
    row.readAt ??= new Date(Date.UTC(2026, 8, 5, 12, 0, 0));
    return Promise.resolve(row);
  }
}

/** 무엇을 해도 터지는 저장소 */
class BrokenStore implements NotificationStore {
  insert(): Promise<void> {
    return Promise.reject(new Error('db is down'));
  }
  listRecent(): Promise<NotificationRecord[]> {
    return Promise.reject(new Error('db is down'));
  }
  countUnread(): Promise<number> {
    return Promise.reject(new Error('db is down'));
  }
  markRead(): Promise<NotificationRecord | null> {
    return Promise.reject(new Error('db is down'));
  }
}

function setup(): { service: NotificationService; store: FakeStore } {
  const store = new FakeStore();
  return { service: new NotificationService(store), store };
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
  expect(error).toBeInstanceOf(NotificationError);
  return (error as NotificationError).code;
}

describe('publish', () => {
  it('should store a notification for the user when a domain publishes one', async () => {
    const { service, store } = setup();

    await service.publish(publishInput());

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      userId: USER,
      type: 'ACCOUNT_VERIFIED',
      title: '계좌 검증이 끝났습니다',
      linkUrl: '/my/account',
      readAt: null,
    });
  });

  /**
   * 포트의 계약 그 자체다. 이게 깨지면 알림이 안 나간 것 때문에 계좌 등록이
   * 통째로 실패한다 — #37 AC3가 이메일에 대해 못 박은 것과 같은 규칙이다.
   */
  it('should resolve without throwing when the store fails', async () => {
    const service = new NotificationService(new BrokenStore());

    await expect(service.publish(publishInput())).resolves.toBeUndefined();
  });
});

describe('list', () => {
  it("should return the user's notifications newest first with the unread count", async () => {
    const { service } = setup();
    await service.publish(publishInput({ title: '먼저' }));
    await service.publish(publishInput({ title: '나중' }));

    const list = await service.list(USER);

    expect(list.items.map((item) => item.title)).toEqual(['나중', '먼저']);
    expect(list.unreadCount).toBe(2);
  });

  it('should return an empty list and a zero unread count when the user has no notifications', async () => {
    const { service } = setup();

    const list = await service.list(USER);

    expect(list.items).toEqual([]);
    expect(list.unreadCount).toBe(0);
  });

  /**
   * 벨 숫자가 목록 길이에 묶이면 21건째부터 안 늘어난다. 조용히 틀리는
   * 종류라 경계로 못 박는다.
   */
  it('should count every unread notification even when older ones fall outside the returned page', async () => {
    const { service } = setup();
    const total = NOTIFICATION_PAGE_SIZE + 1;
    for (let i = 0; i < total; i += 1) {
      await service.publish(publishInput({ title: `알림 ${i}` }));
    }

    const list = await service.list(USER);

    expect(list.items).toHaveLength(NOTIFICATION_PAGE_SIZE);
    expect(list.unreadCount).toBe(total);
  });

  it('should return only the caller’s notifications when other users also have some', async () => {
    const { service } = setup();
    await service.publish(publishInput({ userId: USER, title: '내 것' }));
    await service.publish(publishInput({ userId: OTHER, title: '남의 것' }));

    const list = await service.list(USER);

    expect(list.items.map((item) => item.title)).toEqual(['내 것']);
    expect(list.unreadCount).toBe(1);
  });
});

describe('markRead', () => {
  it('should mark the notification read and return its link', async () => {
    const { service, store } = setup();
    await service.publish(publishInput());
    const id = store.rows[0].id;

    const item = await service.markRead(USER, id);

    expect(item.read).toBe(true);
    expect(item.linkUrl).toBe('/my/account');
  });

  /** 다시 열 때마다 갱신되면 "언제 봤나"가 의미를 잃는다 */
  it('should keep the first read time when the same notification is marked read twice', async () => {
    const { service, store } = setup();
    await service.publish(publishInput());
    const id = store.rows[0].id;

    await service.markRead(USER, id);
    const firstReadAt = store.rows[0].readAt;
    await service.markRead(USER, id);

    expect(store.rows[0].readAt).toEqual(firstReadAt);
  });

  it('should throw NOTIFICATION_NOT_FOUND when the notification belongs to another user', async () => {
    const { service, store } = setup();
    await service.publish(publishInput({ userId: OTHER }));
    const id = store.rows[0].id;

    const error = await rejectionOf(service.markRead(USER, id));

    expect(codeOf(error)).toBe(NOTIFICATION_ERRORS.NOT_FOUND);
  });

  /** 없는 id와 남의 id가 **같은** 코드여야 존재 여부가 새지 않는다 */
  it('should throw NOTIFICATION_NOT_FOUND when the notification does not exist', async () => {
    const { service } = setup();

    const error = await rejectionOf(service.markRead(USER, 'ntf_없음'));

    expect(codeOf(error)).toBe(NOTIFICATION_ERRORS.NOT_FOUND);
  });
});
