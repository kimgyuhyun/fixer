# 이슈 #36 — 인앱 알림을 받고 읽는다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/36
> PRD: `docs/result/prd/notification.md`
> 담당: A (최동훈) → 이 사이클은 B가 수행
> 상태: 시그니처 확정 / 시나리오 도출 완료

---

## 시그니처

### 관련 ADR

`prd/notification.md` §3의 ADR 5건은 문서상 전부 `TODO`다. 확정돼 있던 것은
§5 「확정 사항」(이메일 병행 6종 · 스케줄 잡 4종 · 2중 중복 방어)과
`spec-fixed.md` §8뿐이다. 그래서 아래 셋을 **이 이슈가 처음 정했다.**

| ID          | 여기서 정한 것                                                                | 이유                                                                                                    | 되돌리기                             |
| ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `ADR-NOT-1` | **직접 호출 + 포트(다른 도메인이 부를 인터페이스)**. 이벤트버스·아웃박스 없음 | 인앱 알림은 같은 DB의 INSERT 한 건이라 아웃박스가 더 사 주는 것이 없다. 이메일이 붙는 #37에서 다시 본다 | 쉬움 — 포트 뒤라 어댑터만 갈아끼운다 |
| `ADR-NOT-3` | **발행자가 문구를 만들어 넘긴다.** 템플릿 레지스트리 없음                     | 지금 발행자가 하나(#30)다. 네 개가 되기 전에는 공통점을 알 수 없다                                      | 쉬움                                 |
| `ADR-NOT-5` | **미읽음을 매번 집계한다.** 캐시 없음                                         | 목록 조회 한 번에 카운트가 같이 실려 온다. 요청 수가 늘지 않는다                                        | 쉬움 — `@@index([userId, readAt])`   |

그대로 따르는 것:

- `spec-fixed.md` §8 — `Notification` 테이블 + 헤더 벨 + 미읽음 카운트
- `prd/notification.md` §4 — 실시간(WebSocket/SSE) · 알림 설정 화면 · 그룹핑은 **범위 밖**
- 저장소 관습 — 포트는 인터페이스 선언 + `useFactory` 배선. `AcceptedCounter`(#12)·`AccountVerifier`(#30)와 같은 모양

### 타입

```typescript
// packages/shared/src/notification.ts
export const NOTIFICATION_TYPES = [
  'ACCOUNT_VERIFIED', // #30 계좌 검증 완료 — 이 이슈에서 실제로 발행한다
  'APPLICATION_REJECTED', // #19
  'SUSPENSION_RELEASED', // #33
  'EXCHANGE_REJECTED', // #34
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** 목록이 한 번에 주는 최대 건수. 커서는 두지 않는다 (범위 밖) */
export const NOTIFICATION_PAGE_SIZE = 20;

export const NOTIFICATION_ERRORS = {
  NOT_FOUND: 'NOTIFICATION_NOT_FOUND',
} as const;
export type NotificationErrorCode =
  (typeof NOTIFICATION_ERRORS)[keyof typeof NOTIFICATION_ERRORS];

export const notificationItemSchema = z.object({
  id: z.string(),
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string(),
  body: z.string(),
  /**
   * 클릭하면 갈 **앱 내부 경로**. 예: `/my/account`
   * `/`로 시작해야 한다 — 절대 URL이면 화면이 외부로 튕긴다(오픈 리다이렉트).
   * `/security-review 36`에서 추가.
   */
  linkUrl: z.string().startsWith('/'),
  /** 화면은 읽었는지만 안다. `readAt` 시각은 안 내려보낸다 */
  read: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

export const notificationListSchema = z.object({
  items: z.array(notificationItemSchema),
  /** **페이지 밖 미읽음도 센다.** 벨 숫자가 목록 길이에 묶이지 않는다 */
  unreadCount: z.number().int().min(0),
});
export type NotificationList = z.infer<typeof notificationListSchema>;
```

```typescript
// apps/api/src/notification/notification.service.ts

/** 다른 도메인이 부르는 포트. #19·#30·#33·#34가 이것만 본다 */
export interface NotificationPublisher {
  /**
   * **던지지 않는다.** 발행 실패가 도메인 트랜잭션을 깨면 안 된다
   * (#37 AC3와 같은 규칙을 포트 안쪽에 못 박는다).
   */
  publish(input: PublishNotificationInput): Promise<void>;
}

export interface PublishNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
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
  listRecent(userId: string, limit: number): Promise<NotificationRecord[]>;
  countUnread(userId: string): Promise<number>;
  /** 남의 알림이거나 없으면 `null`. 이미 읽었으면 첫 읽음 시각을 유지한다 */
  markRead(userId: string, id: string): Promise<NotificationRecord | null>;
}

export class NotificationError extends Error {
  constructor(readonly code: NotificationErrorCode) {
    super(code);
    this.name = 'NotificationError';
  }
}

@Injectable()
export class NotificationService implements NotificationPublisher {
  constructor(private readonly store: NotificationStore) {}

  publish(input: PublishNotificationInput): Promise<void>;
  list(userId: string): Promise<NotificationList>;
  markRead(userId: string, id: string): Promise<NotificationItem>;
}
```

```prisma
// apps/api/prisma/schema.prisma
model Notification {
  id        String           @id @default(cuid())
  userId    String
  user      User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  type      NotificationType
  /// 발행 시점에 굳힌 문구. 나중에 공고 제목이 바뀌어도 알림은 그때 그대로다
  title     String
  body      String
  /// 클릭하면 갈 앱 내부 경로
  linkUrl   String
  /// null이면 미읽음. 상태 컬럼을 안 두는 것은 ADR-AUTH-3과 같은 이유다
  readAt    DateTime?
  createdAt DateTime         @default(now())

  /// 미읽음 카운트가 이 인덱스로 끝난다 (ADR-NOT-5)
  @@index([userId, readAt])
  /// 목록은 최신순
  @@index([userId, createdAt])
}

enum NotificationType {
  ACCOUNT_VERIFIED
  APPLICATION_REJECTED
  SUSPENSION_RELEASED
  EXCHANGE_REJECTED
}
```

### 에러 케이스

| 상황                      | 에러 코드                | HTTP |
| ------------------------- | ------------------------ | ---- |
| 세션 쿠키 없음 / 만료     | `AUTH_UNAUTHENTICATED`   | 401  |
| 없는 알림을 읽음 처리     | `NOTIFICATION_NOT_FOUND` | 404  |
| **남의 알림**을 읽음 처리 | `NOTIFICATION_NOT_FOUND` | 404  |

남의 알림에 403이 아니라 404를 주는 이유: 403은 "그 id는 존재한다"를 알려준다.
존재 여부 자체를 감춘다.

### HTTP

```
GET  /api/notifications/me       → NotificationList
POST /api/notifications/:id/read → NotificationItem   (본문에 linkUrl이 실려 온다)
```

회원 식별은 **쿠키 세션**에서 뽑는다. `LoginService.authenticate`(AuthModule이
이미 export 중, `/api/auth/me`가 쓰는 것과 같은 것)를 재사용한다.

기존 컨트롤러(#12·#17·#30)는 `userId`를 쿼리·본문으로 받고 "#4 배선이 머지되면
바꾼다"는 주석을 달아 뒀지만, **#4는 이미 머지됐고** 헤더 벨은 사용자가 자기
id를 타이핑할 자리가 없다. 알림 목록은 개인 데이터라 쿼리로 받으면 남의 알림이
그대로 읽힌다. **기존 세 컨트롤러를 같이 고치지는 않는다** — 이 이슈 범위 밖이고
#18 세션과 충돌한다.

### 컴포넌트 Props

```typescript
// apps/web/src/app/NotificationBell.tsx  ('use client')
// layout.tsx의 <header> 안에 둔다. props 없음 — 스스로 GET /api/notifications/me 를 부른다.
//   미읽음 0이면 배지를 아예 렌더링하지 않는다 (AC3)
//   401이면 조용히 아무것도 안 그린다 (로그인 화면에도 layout이 걸린다)

// apps/web/src/app/notifications/page.tsx  ('use client')
// props 없음 — 목록을 부르고, 클릭하면 read 처리 후 router.push(linkUrl) (AC2)
```

### 이 이슈에서 만들지 않는 것

| 항목                                                                       | 어디로                             |
| -------------------------------------------------------------------------- | ---------------------------------- |
| 이메일 병행 발송 · `MailProvider` 배선 · 발송 이력 테이블                  | **#37**                            |
| 스케줄 잡 · advisory lock                                                  | #38                                |
| `APPLICATION_REJECTED`·`SUSPENSION_RELEASED`·`EXCHANGE_REJECTED` 발행 지점 | #19 · #33 · #34 (타입만 미리 선언) |
| 커서 페이지네이션 · 실시간 푸시 · 읽음 일괄 해제                           | PRD §4 Out of Scope                |
| `apps/api/src/application/`, `packages/shared/src/application.ts`          | **#18 세션 소유 — 건드리지 않음**  |

`NOTIFICATION_TYPES`에 아직 발행자가 없는 3종을 미리 넣는 이유: enum 값 추가는
마이그레이션이 필요하다. #19·#33·#34가 각자 마이그레이션을 하나씩 더 만드는
것보다 포트를 쓸 네 개를 지금 선언해 두는 편이 싸다.

### 기존 파일 변경 예고

| 파일                                                         | 무엇이 바뀌나                                            |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| `apps/api/prisma/schema.prisma`                              | `Notification` 모델 + enum + `User.notifications`        |
| `apps/api/src/exchange/exchange-account.service.ts`          | 생성자에 `NotificationPublisher` 4번째 인자 (#30 마무리) |
| `apps/api/src/exchange/exchange.module.ts`                   | `NotificationModule` import + 배선                       |
| `apps/api/src/exchange/exchange-account.service.test.ts`     | 생성자 인자가 늘어 기존 테스트가 깨진다 → 함께 고침      |
| `apps/web/src/app/layout.tsx`                                | `<header>` + `<NotificationBell />`                      |
| `apps/api/src/app.module.ts`, `packages/shared/src/index.ts` | 모듈·export 등록                                         |

---

## 테스트 시나리오

### 정상

- [x] [정상] `NotificationService.publish` — should store a notification for the user when a domain publishes one
- [x] [정상] `NotificationService.list` — should return the user's notifications newest first with the unread count
- [x] [정상] `NotificationService.markRead` — should mark the notification read and return its link
- [x] [정상] `GET /notifications/me` — should return the caller's list resolved from the session cookie
- [x] [정상] `PrismaNotificationStore` — should persist a published notification and read it back from the real database
- [x] [정상] `ExchangeAccountService.register` — should publish an ACCOUNT_VERIFIED notification when the account passes verification
- [x] [정상] `NotificationBell` — should show the unread count when unread notifications exist
- [x] [정상] `NotificationsPage` — should list the notifications returned by the API
- [x] [정상] `NotificationsPage` — should mark the notification read and move to its linked screen when clicked

### 경계

- [x] [경계] `NotificationService.list` — should return an empty list and a zero unread count when the user has no notifications
- [x] [경계] `NotificationService.list` — should count every unread notification even when older ones fall outside the returned page
- [x] [경계] `NotificationService.list` — should return only the caller's notifications when other users also have some
- [x] [경계] `NotificationService.markRead` — should keep the first read time when the same notification is marked read twice
- [x] [경계] `PrismaNotificationStore` — should count only unread rows when some of the user's notifications are already read
- [x] [경계] `NotificationBell` — should show no number when the unread count is zero
- [x] [경계] `NotificationsPage` — should show an empty message when there are no notifications

### 예외

- [x] [예외] `NotificationService.publish` — should resolve without throwing when the store fails
- [x] [예외] `NotificationService.markRead` — should throw NOTIFICATION_NOT_FOUND when the notification belongs to another user
- [x] [예외] `NotificationService.markRead` — should throw NOTIFICATION_NOT_FOUND when the notification does not exist
- [x] [예외] `GET /notifications/me` — should return 401 when no session cookie is present
- [x] [예외] `POST /notifications/:id/read` — should return 404 with NOTIFICATION_NOT_FOUND when the notification is not the caller's
- [x] [예외] `ExchangeAccountService.register` — should not publish anything when verification rejects the account

### 파일 배치

| 파일                                                            | 시나리오 수 |
| --------------------------------------------------------------- | ----------- |
| `apps/api/src/notification/notification.service.test.ts`        | 10          |
| `apps/api/src/notification/notification.controller.test.ts`     | 3           |
| `apps/api/src/notification/notification.integration.test.ts`    | 2           |
| `apps/api/src/exchange/exchange-account.service.test.ts` (추가) | 2           |
| `apps/web/src/app/NotificationBell.test.tsx`                    | 2           |
| `apps/web/src/app/notifications/page.test.tsx`                  | 3           |

---

## AC 대조

| AC                                                                                         | 커버하는 시나리오                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AC1** Given 알림이 발생하면, Then `Notification`이 쌓이고 헤더 벨에 미읽음 수가 표시된다 | `[정상] publish — should store a notification…`<br>`[정상] list — should return … with the unread count`<br>`[경계] list — should count every unread … outside the returned page`<br>`[정상] PrismaNotificationStore — should persist …`<br>`[정상] NotificationBell — should show the unread count …` |
| **AC2** Given 알림 목록, When 알림을 클릭하면, Then 읽음 처리되고 관련 화면으로 이동한다   | `[정상] markRead — should mark the notification read and return its link`<br>`[경계] markRead — should keep the first read time …`<br>`[정상] NotificationsPage — should mark the notification read and move to its linked screen when clicked`                                                        |
| **AC3** Given 알림이 없을 때, Then 벨에 숫자가 표시되지 않는다                             | `[경계] list — should return an empty list and a zero unread count …`<br>`[경계] NotificationBell — should show no number when the unread count is zero`<br>`[경계] NotificationsPage — should show an empty message …`                                                                                |

### AC에 없는데 추가한 시나리오

| 시나리오                                                                                                                                                                               | 왜 넣었나                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `[경계] list — only the caller's notifications`<br>`[예외] markRead — another user's`<br>`[예외] POST :id/read — 404 when not the caller's`<br>`[예외] GET /me — 401 without a cookie` | **IDOR(남의 자원 id를 넣어 남의 데이터를 읽는 결함) 방어.** 알림은 개인 데이터라 이게 빠지면 남의 알림을 그대로 읽는다          |
| `[예외] publish — should resolve without throwing when the store fails`                                                                                                                | `NotificationPublisher`의 계약 자체다. 이게 깨지면 알림 실패가 계좌 등록·수락 같은 도메인 동작을 되돌린다 (#37 AC3와 같은 규칙) |
| `[정상]`·`[예외] ExchangeAccountService.register` 2건                                                                                                                                  | **#30이 남긴 "검증 완료 알림이 안 간다"를 이 이슈에서 닫으라는 지시** (`handoff-a-to-b.md` 3-2)                                 |
| `[경계] list — unread outside the returned page`                                                                                                                                       | 벨 숫자가 목록 길이(20)에 묶이면 21건째부터 숫자가 안 늘어난다. 조용히 틀리는 종류다                                            |
| `[예외] markRead — does not exist`                                                                                                                                                     | 존재하지 않는 id와 남의 id가 **같은 404**여야 한다는 것을 고정한다                                                              |

### AC에 있는데 시나리오가 없는 것

없다.

**커버리지:** AC 3개 / 시나리오 22개 / 미커버 0개
