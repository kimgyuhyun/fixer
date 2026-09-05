import { z } from 'zod';

/**
 * 알림 종류. (이슈 #36, `spec-fixed.md` §8)
 *
 * 아직 발행자가 없는 셋을 미리 선언한다. Prisma enum에 값을 더하는 것은
 * 마이그레이션이 필요한 일이라, #19·#33·#34가 각자 하나씩 만드는 것보다
 * 포트를 쓸 넷을 지금 적어 두는 편이 싸다.
 */
export const NOTIFICATION_TYPES = [
  /** 계좌 검증 완료 (#30). **이 이슈에서 실제로 발행하는 유일한 종류다** */
  'ACCOUNT_VERIFIED',
  /** 지원 거절 (#19) */
  'APPLICATION_REJECTED',
  /** 제재 조기 해제 (#33) */
  'SUSPENSION_RELEASED',
  /** 환전 반려 (#34) */
  'EXCHANGE_REJECTED',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * 목록이 한 번에 주는 최대 건수.
 *
 * 커서 페이지네이션(다음 쪽을 가리키는 표식을 주고받는 방식)은 범위 밖이다.
 * 그래서 21건째부터는 목록에 안 보이고 벨 숫자로만 남는다.
 */
export const NOTIFICATION_PAGE_SIZE = 20;

/** 알림이 내는 에러 코드 */
export const NOTIFICATION_ERRORS = {
  /**
   * 없는 알림이거나 남의 알림이다. **둘을 구분하지 않는다** — 403을 주면
   * "그 id는 존재한다"를 알려주게 된다.
   */
  NOT_FOUND: 'NOTIFICATION_NOT_FOUND',
} as const;

export type NotificationErrorCode =
  (typeof NOTIFICATION_ERRORS)[keyof typeof NOTIFICATION_ERRORS];

/** 화면이 보는 알림 한 건 */
export const notificationItemSchema = z.object({
  id: z.string(),
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string(),
  body: z.string(),
  /**
   * 클릭하면 갈 **앱 내부 경로**. 예: `/my/account`
   *
   * `/`로 시작하지 않으면 거절한다. 화면이 이 값을 그대로 `router.push`에
   * 넣으므로, 절대 URL이 들어오면 외부 사이트로 튕긴다(오픈 리다이렉트).
   * 지금은 발행자가 리터럴 하나뿐이라 도달 경로가 없지만, #19·#33·#34가
   * 경로에 id를 끼워 넣기 시작하기 전에 닫아 둔다.
   */
  linkUrl: z.string().startsWith('/'),
  /** 화면은 읽었는지만 안다. 읽은 시각은 내려보내지 않는다 */
  read: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

/** 목록 + 벨 숫자. 한 번의 요청으로 둘 다 온다 (ADR-NOT-5) */
export const notificationListSchema = z.object({
  items: z.array(notificationItemSchema),
  /**
   * **페이지 밖 미읽음도 센다.** 목록 길이로 대신하면 21건째부터 벨 숫자가
   * 안 늘어난다 — 조용히 틀리는 종류다.
   */
  unreadCount: z.number().int().min(0),
});
export type NotificationList = z.infer<typeof notificationListSchema>;
