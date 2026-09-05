import { Injectable, Logger } from '@nestjs/common';
import {
  NOTIFICATION_ERRORS,
  NOTIFICATION_PAGE_SIZE,
  type NotificationErrorCode,
  type NotificationItem,
  type NotificationList,
  type NotificationType,
} from '@fixer/shared';

/**
 * 다른 도메인이 부르는 포트. (이슈 #36, ADR-NOT-1)
 *
 * #19(거절) · #30(계좌 검증) · #33(제재 해제) · #34(환전 반려)가 **이것만**
 * 본다. 알림을 어떻게 저장하고 나중에 어떻게 메일까지 보낼지(#37)는 이
 * 인터페이스 뒤에서 바뀐다.
 */
export interface NotificationPublisher {
  /**
   * **던지지 않는다.** 발행 실패가 도메인 트랜잭션을 깨면 안 된다 —
   * 메일이 안 나갔다고 수락이 취소되면 안 된다는 #37 AC3와 같은 규칙을
   * 포트 안쪽에 못 박아 둔다.
   *
   * 발행자마다 `try/catch`를 쓰게 하면 한 곳은 반드시 빠뜨린다.
   */
  publish(input: PublishNotificationInput): Promise<void>;
}

export interface PublishNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** 클릭하면 갈 앱 내부 경로 */
  linkUrl: string;
}

/** 저장된 알림 한 건 */
export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  linkUrl: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationStore {
  insert(input: PublishNotificationInput): Promise<void>;
  /** 최신순 */
  listRecent(userId: string, limit: number): Promise<NotificationRecord[]>;
  countUnread(userId: string): Promise<number>;
  /**
   * 남의 알림이거나 없으면 `null`.
   *
   * 이미 읽었으면 **첫 읽음 시각을 유지한다** — 다시 열 때마다 갱신되면
   * "언제 봤나"가 의미를 잃는다.
   */
  markRead(userId: string, id: string): Promise<NotificationRecord | null>;
}

export class NotificationError extends Error {
  constructor(readonly code: NotificationErrorCode) {
    super(code);
    this.name = 'NotificationError';
  }
}

/**
 * 인앱 알림. (이슈 #36, `spec-fixed.md` §8)
 *
 * 이메일 병행은 #37이다. 여기는 DB에 쌓고 읽는 것까지다.
 */
@Injectable()
export class NotificationService implements NotificationPublisher {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly store: NotificationStore) {}

  async publish(input: PublishNotificationInput): Promise<void> {
    try {
      await this.store.insert(input);
    } catch (error) {
      // 삼키되 남긴다. 알림이 안 갔다는 문의에 답하려면 흔적이 있어야 한다.
      // 회원 id만 적고 문구는 적지 않는다 — 알림 본문에는 개인정보가 담긴다.
      this.logger.error(
        `알림 발행 실패 (userId=${input.userId}, type=${input.type})`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async list(userId: string): Promise<NotificationList> {
    // 미읽음은 목록과 따로 센다. 목록은 20건에서 잘리지만 벨 숫자는 안 잘린다.
    const [records, unreadCount] = await Promise.all([
      this.store.listRecent(userId, NOTIFICATION_PAGE_SIZE),
      this.store.countUnread(userId),
    ]);

    return { items: records.map(toItem), unreadCount };
  }

  async markRead(userId: string, id: string): Promise<NotificationItem> {
    const read = await this.store.markRead(userId, id);
    // 남의 알림과 없는 알림이 같은 코드다. 구분하면 그 id가 존재한다는 것을
    // 알려주게 된다.
    if (read === null) {
      throw new NotificationError(NOTIFICATION_ERRORS.NOT_FOUND);
    }
    return toItem(read);
  }
}

function toItem(record: NotificationRecord): NotificationItem {
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    body: record.body,
    linkUrl: record.linkUrl,
    read: record.readAt !== null,
    createdAt: record.createdAt.toISOString(),
  };
}
