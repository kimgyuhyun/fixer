import {
  NOTIFICATION_ERRORS,
  NOTIFICATION_PAGE_SIZE,
  NOTIFICATION_TYPES,
} from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import {
  NotificationError,
  NotificationService,
  type MailDeliveryEntry,
  type NotificationMail,
  type NotificationMailStore,
  type NotificationMailer,
  type NotificationRecord,
  type NotificationStore,
  type PublishNotificationInput,
} from './notification.service';

const USER = 'usr_1';
const OTHER = 'usr_2';
const EMAIL = 'worker@example.com';

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

/**
 * 메일 쪽 저장소 대역. (이슈 #37)
 *
 * `broken`으로 어느 호출이 터지는지를 고른다 — 주소 조회와 이력 기록은
 * 둘 다 DB 호출이라 각각 실패할 수 있고, AC3의 구멍이 거기 있다.
 */
class FakeMailStore implements NotificationMailStore {
  lookups: string[] = [];
  recorded: MailDeliveryEntry[] = [];

  constructor(
    private readonly options: {
      emails?: Map<string, string>;
      broken?: 'lookup' | 'record';
    } = {},
  ) {}

  findRecipientEmail(userId: string): Promise<string | null> {
    this.lookups.push(userId);
    if (this.options.broken === 'lookup') {
      return Promise.reject(new Error('db is down'));
    }
    const emails =
      this.options.emails ??
      new Map([
        [USER, EMAIL],
        [OTHER, 'other@example.com'],
      ]);
    return Promise.resolve(emails.get(userId) ?? null);
  }

  recordDelivery(entry: MailDeliveryEntry): Promise<void> {
    if (this.options.broken === 'record') {
      return Promise.reject(new Error('db is down'));
    }
    this.recorded.push(entry);
    return Promise.resolve();
  }
}

/** 보낸 메일을 모아 두는 메일러 */
class SpyMailer implements NotificationMailer {
  sent: NotificationMail[] = [];

  send(mail: NotificationMail): Promise<void> {
    this.sent.push(mail);
    return Promise.resolve();
  }
}

/** 보내려 할 때마다 터지는 메일러. **시도했다는 것은 남긴다** */
class BrokenMailer implements NotificationMailer {
  attempts: NotificationMail[] = [];

  send(mail: NotificationMail): Promise<void> {
    this.attempts.push(mail);
    return Promise.reject(new Error('smtp down'));
  }
}

function setup(mailStore: FakeMailStore = new FakeMailStore()): {
  service: NotificationService;
  store: FakeStore;
  mailStore: FakeMailStore;
  mailer: SpyMailer;
} {
  const store = new FakeStore();
  const mailer = new SpyMailer();
  return {
    service: new NotificationService(store, mailStore, mailer),
    store,
    mailStore,
    mailer,
  };
}

/** 메일이 실패하는 판. AC3은 전부 이 판에서 본다 */
function setupWithBrokenMailer(
  mailStore: FakeMailStore = new FakeMailStore(),
): {
  service: NotificationService;
  store: FakeStore;
  mailStore: FakeMailStore;
  mailer: BrokenMailer;
} {
  const store = new FakeStore();
  const mailer = new BrokenMailer();
  return {
    service: new NotificationService(store, mailStore, mailer),
    store,
    mailStore,
    mailer,
  };
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
    const service = new NotificationService(
      new BrokenStore(),
      new FakeMailStore(),
      new SpyMailer(),
    );

    await expect(service.publish(publishInput())).resolves.toBeUndefined();
  });
});

/**
 * 이메일 병행. (이슈 #37)
 *
 * 발행자는 채널을 모른다 — `publish` 한 번이 인앱과 메일 양쪽으로 갈라진다.
 */
describe('publish — 이메일 병행', () => {
  it('should send an email to the member alongside the in-app notification', async () => {
    const { service, store, mailer } = setup();

    await service.publish(publishInput());

    expect(store.rows).toHaveLength(1);
    expect(mailer.sent).toHaveLength(1);
  });

  it('should address the mail to the notified member and carry the title, body and link', async () => {
    const { service, mailer } = setup();

    await service.publish(publishInput());

    expect(mailer.sent[0]).toEqual({
      to: EMAIL,
      subject: '계좌 검증이 끝났습니다',
      body: '신한은행 ****5678 계좌를 쓸 수 있습니다.',
      linkUrl: '/my/account',
    });
  });

  it('should record a SENT delivery after the mail goes out', async () => {
    const { service, mailStore } = setup();

    await service.publish(publishInput());

    expect(mailStore.recorded).toEqual([
      {
        userId: USER,
        type: 'ACCOUNT_VERIFIED',
        to: EMAIL,
        subject: '계좌 검증이 끝났습니다',
        status: 'SENT',
        error: null,
      },
    ]);
  });

  /**
   * 지금 선언된 7종이 전부 `prd/notification.md` §5의 이메일 병행 6종에
   * 대응한다. 종류별 분기표를 두지 않기로 한 결정을 여기에 못 박는다.
   */
  it('should send an email for every notification type', async () => {
    const { service, mailer } = setup();

    for (const type of NOTIFICATION_TYPES) {
      await service.publish(publishInput({ type }));
    }

    expect(mailer.sent).toHaveLength(NOTIFICATION_TYPES.length);
  });

  it('should record one delivery per published notification when several go out', async () => {
    const { service, mailStore } = setup();

    await service.publish(publishInput({ title: '하나' }));
    await service.publish(publishInput({ title: '둘' }));
    await service.publish(publishInput({ title: '셋' }));

    expect(mailStore.recorded).toHaveLength(3);
  });

  /** 인앱이 죽었을 때야말로 메일이 필요하다. 두 채널이 서로를 막지 않는다 */
  it('should still send the email when storing the in-app notification fails', async () => {
    const mailer = new SpyMailer();
    const service = new NotificationService(
      new BrokenStore(),
      new FakeMailStore(),
      mailer,
    );

    await service.publish(publishInput());

    expect(mailer.sent).toHaveLength(1);
  });

  /** 파기된 계정(#39)은 주소가 없다. 보낼 곳이 없으면 이력도 남지 않는다 */
  it('should send nothing when the member has no address on record', async () => {
    const { service, mailStore, mailer } = setup(
      new FakeMailStore({ emails: new Map() }),
    );

    await service.publish(publishInput());

    // 주소를 찾아보긴 했다. 없어서 안 보낸 것이지 아예 시도를 안 한 게 아니다.
    expect(mailStore.lookups).toEqual([USER]);
    expect(mailer.sent).toEqual([]);
    expect(mailStore.recorded).toEqual([]);
  });

  it('should record a FAILED delivery carrying the reason when the mailer throws', async () => {
    const { service, mailStore } = setupWithBrokenMailer();

    await service.publish(publishInput());

    expect(mailStore.recorded).toEqual([
      {
        userId: USER,
        type: 'ACCOUNT_VERIFIED',
        to: EMAIL,
        subject: '계좌 검증이 끝났습니다',
        status: 'FAILED',
        error: 'smtp down',
      },
    ]);
  });
});

/**
 * AC3 — 메일이 안 나갔다고 도메인이 되돌아가면 안 된다.
 *
 * 이 묶음의 테스트는 전부 "실패 경로를 실제로 밟았는가"를 먼저 확인한다.
 * 그게 없으면 메일을 아예 안 보내는 코드도 초록불이 된다.
 */
describe('publish — 메일이 실패해도 도메인은 되돌아가지 않는다', () => {
  it('should resolve without throwing when the mailer throws', async () => {
    const { service, mailer } = setupWithBrokenMailer();

    await expect(service.publish(publishInput())).resolves.toBeUndefined();
    expect(mailer.attempts).toHaveLength(1);
  });

  it('should keep the in-app notification when the mail fails', async () => {
    const { service, store, mailer } = setupWithBrokenMailer();

    await service.publish(publishInput());

    expect(mailer.attempts).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
  });

  /** 실패를 기록하려다 실패하는 경로가 AC3의 가장 흔한 구멍이다 */
  it('should resolve without throwing when recording the delivery fails', async () => {
    const { service, mailer } = setup(new FakeMailStore({ broken: 'record' }));

    await expect(service.publish(publishInput())).resolves.toBeUndefined();
    expect(mailer.sent).toHaveLength(1);
  });

  it('should resolve without throwing when looking up the recipient fails', async () => {
    const mailStore = new FakeMailStore({ broken: 'lookup' });
    const { service } = setup(mailStore);

    await expect(service.publish(publishInput())).resolves.toBeUndefined();
    expect(mailStore.lookups).toEqual([USER]);
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
