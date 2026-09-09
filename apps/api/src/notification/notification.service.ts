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

/** 알림 메일 한 통. 제목·본문은 발행자가 만든 문구 그대로다 (ADR-NOT-3) */
export interface NotificationMail {
  to: string;
  subject: string;
  body: string;
  /** 앱 내부 경로. 어댑터가 여기에 도메인을 붙여 링크로 만든다 */
  linkUrl: string;
}

/**
 * 메일 발송 포트. (이슈 #37)
 *
 * **던져도 된다.** 실패를 삼키는 것은 서비스의 일이다 — 어댑터마다
 * try/catch를 쓰게 하면 한 곳은 반드시 빠뜨린다.
 */
export interface NotificationMailer {
  send(mail: NotificationMail): Promise<void>;
}

/** 발송 이력 한 줄. 본문은 담지 않는다 — 개인정보를 한 벌 더 만들지 않는다 */
export interface MailDeliveryEntry {
  userId: string;
  type: NotificationType;
  /** 보낸 주소. 회원이 나중에 주소를 바꿔도 이력은 그때 그대로다 */
  to: string;
  subject: string;
  status: 'SENT' | 'FAILED';
  /** 실패 사유. 성공이면 null (ADR-NOT-4 — 재시도하지 않고 기록만 한다) */
  error: string | null;
}

/** 메일 쪽 저장소. 받는 주소를 찾고 이력을 남긴다 */
export interface NotificationMailStore {
  /** 없는 회원이면 `null` */
  findRecipientEmail(userId: string): Promise<string | null>;
  recordDelivery(entry: MailDeliveryEntry): Promise<void>;
}

export class NotificationError extends Error {
  constructor(readonly code: NotificationErrorCode) {
    super(code);
    this.name = 'NotificationError';
  }
}

/**
 * 인앱 알림 + 알림 메일. (이슈 #36·#37, `spec-fixed.md` §8)
 *
 * 두 채널이 여기서 갈라진다. 발행자는 채널을 모른다 (ADR-NOT-1).
 */
@Injectable()
export class NotificationService implements NotificationPublisher {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly store: NotificationStore,
    private readonly mailStore: NotificationMailStore,
    private readonly mailer: NotificationMailer,
  ) {}

  /**
   * 인앱과 메일 **양쪽으로** 내보낸다 (#37 AC1).
   *
   * 두 채널은 서로를 막지 않는다 — 인앱 저장이 실패해도 메일은 나간다.
   * 인앱이 죽었을 때야말로 메일이 필요하기 때문이다.
   */
  async publish(input: PublishNotificationInput): Promise<void> {
    await this.storeInApp(input);
    await this.deliverMail(input);
  }

  private async storeInApp(input: PublishNotificationInput): Promise<void> {
    try {
      await this.store.insert(input);
    } catch (error) {
      // 삼키되 남긴다. 알림이 안 갔다는 문의에 답하려면 흔적이 있어야 한다.
      // 회원 id만 적고 문구는 적지 않는다 — 알림 본문에는 개인정보가 담긴다.
      this.logger.error(
        `알림 발행 실패 (userId=${input.userId}, type=${input.type})`,
        stackOf(error),
      );
    }
  }

  /**
   * **던지지 않는다.** 메일이 안 나갔다고 수락이 취소되면 안 된다 (#37 AC3).
   *
   * 실패는 되돌리는 대신 `MailDelivery`에 남긴다 (ADR-NOT-4).
   */
  private async deliverMail(input: PublishNotificationInput): Promise<void> {
    let to: string | null = null;
    try {
      to = await this.mailStore.findRecipientEmail(input.userId);
      if (to === null) {
        // 파기된 계정(#39)은 주소가 없다. 보낸 적이 없으니 이력도 남기지 않는다.
        this.logger.warn(
          `받는 주소가 없어 알림 메일을 보내지 않는다 (userId=${input.userId})`,
        );
        return;
      }

      await this.mailer.send({
        to,
        subject: input.title,
        body: input.body,
        linkUrl: input.linkUrl,
      });
      await this.recordDeliveryQuietly(input, to, 'SENT', null);
    } catch (error) {
      this.logger.error(
        `알림 메일 발송 실패 (userId=${input.userId}, type=${input.type})`,
        stackOf(error),
      );
      // 주소를 못 찾았으면 보낸 적이 없으므로 이력도 없다.
      if (to !== null) {
        await this.recordDeliveryQuietly(input, to, 'FAILED', reasonOf(error));
      }
    }
  }

  /** 이력 기록도 DB 호출이라 실패할 수 있다. **여기서 끝낸다** */
  private async recordDeliveryQuietly(
    input: PublishNotificationInput,
    to: string,
    status: MailDeliveryEntry['status'],
    error: string | null,
  ): Promise<void> {
    try {
      await this.mailStore.recordDelivery({
        userId: input.userId,
        type: input.type,
        to,
        subject: input.title,
        status,
        error,
      });
    } catch (recordError) {
      this.logger.error(
        `알림 메일 이력 기록 실패 (userId=${input.userId}, type=${input.type})`,
        stackOf(recordError),
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

/** 이력에 남길 실패 사유 한 줄 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 로그에 붙일 스택. 에러가 아닌 것이 던져지면 붙일 것이 없다 */
function stackOf(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
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
