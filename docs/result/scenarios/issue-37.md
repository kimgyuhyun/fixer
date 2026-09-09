# 이슈 #37 — 중요 알림은 이메일로도 온다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/37
> PRD: `docs/result/prd/notification.md`
> 담당: A (최동훈) → 이 사이클은 자율 루프가 수행
> 선행: #36 (인앱 알림) — 머지됨
> 상태: 시그니처 확정 / 시나리오 도출 완료

---

## 시그니처

### 관련 ADR

`prd/notification.md` §3의 ADR 5건 중 `ADR-NOT-1`·`ADR-NOT-3`·`ADR-NOT-5`는
**#36이 이미 정했다.** 이 이슈는 그 결정을 그대로 따르고, 남아 있던
`ADR-NOT-4`(이메일 발송 실패 처리)만 정한다.

| ID          | 여기서 정한 것                                                                                          | 이유                                                                                                                              | 되돌리기                                    |
| ----------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `ADR-NOT-4` | **즉시 실패 기록.** 재시도 큐 없음. 실패는 `MailDelivery`에 `FAILED` 행으로 남기고 도메인에는 안 알린다 | 이슈 AC3이 "롤백되지 않고 **실패만 기록**된다"로 못 박아 놨다. 재시도 큐는 BullMQ/Redis를 부르는데 PRD §4가 그걸 범위 밖으로 뺐다 | 쉬움 — 포트 뒤에서 어댑터가 재시도를 맡는다 |

#36에서 이어받아 그대로 쓰는 것:

- `ADR-NOT-1` **직접 호출 + 포트.** 이메일도 `NotificationPublisher.publish` 안쪽에서 나간다.
  발행자(#19·#21·#25·#30·#33·#34·#38) 코드는 **한 줄도 바뀌지 않는다**
- `ADR-NOT-3` **발행자가 문구를 만들어 넘긴다.** 템플릿 레지스트리 없음 →
  메일 제목은 `title`, 본문은 `body` + `linkUrl`을 그대로 쓴다
- `spec-fixed.md` §8 — "발송 이력을 DB에 남겨 테스트에서 검증 가능하게 한다"
- `prd/notification.md` §4 — 수신 거부·채널 선택 화면, 열람 추적, 재시도 큐는 **범위 밖**

### 이메일을 보내는 대상

`prd/notification.md` §5 「확정 사항」의 **이메일 병행 6종**과 지금 선언된
`NOTIFICATION_TYPES` 7종을 대조하면 이렇게 맞물린다.

| 이메일 병행 6종 (PRD §5) | `NotificationType`              |
| ------------------------ | ------------------------------- |
| 재동의 요청              | `APPLICATION_REACCEPT_REQUIRED` |
| 수락·거절                | `APPLICATION_REJECTED`          |
| 모집 미달                | `JOB_POST_UNDERFILLED`          |
| 제재 발생                | `SUSPENSION_STARTED`            |
| 계좌 검증 완료           | `ACCOUNT_VERIFIED`              |
| 환전 승인·완료·반려      | `EXCHANGE_REJECTED`             |

남는 `SUSPENSION_RELEASED`(제재 조기 해제)도 제재 건이라 6종 안이다.
**즉 현재 선언된 7종 전부가 이메일 병행 대상이다.** 그래서 종류별 분기표를
만들지 않는다 — 지금 만들면 모든 값이 `true`인 표가 되고, 그건 코드가 아니라
주석이다. 병행하지 않을 종류가 처음 생길 때 그 자리에서 만든다.

### 메일러 어댑터

실제 발송은 Resend다(`spec-fixed.md` §1). 다만 이 이슈에서 `resend` 패키지를
붙이지는 않는다 — API 키가 있어야 하고, 테스트에서 실제 메일이 나가면 안 된다.
`ConsoleMailProvider`(#1)·`ConsolePaymentGateway`(#31)와 **같은 자리**를 만든다.
포트 뒤라 어댑터 교체 한 줄이다.

### 타입

```typescript
// apps/api/src/notification/notification.service.ts

/** 알림 메일 한 통. 제목·본문은 발행자가 만든 문구 그대로다 (ADR-NOT-3) */
export interface NotificationMail {
  to: string;
  subject: string;
  body: string;
  /** 앱 내부 경로. 어댑터가 여기에 도메인을 붙여 링크로 만든다 */
  linkUrl: string;
}

/** 메일 발송 포트. Resend 어댑터가 이걸 구현한다 */
export interface NotificationMailer {
  /** **던진다.** 실패를 삼키는 것은 서비스의 일이다 (AC3) */
  send(mail: NotificationMail): Promise<void>;
}

/** 발송 이력 한 줄 */
export interface MailDeliveryEntry {
  userId: string;
  type: NotificationType;
  /** 보낸 주소. 나중에 회원이 주소를 바꿔도 이력은 그때 그대로다 */
  to: string;
  subject: string;
  status: 'SENT' | 'FAILED';
  /** 실패 사유. 성공이면 null */
  error: string | null;
}

/** 메일 쪽 저장소. 받는 주소를 찾고 이력을 남긴다 */
export interface NotificationMailStore {
  /** 없는 회원이면 null */
  findRecipientEmail(userId: string): Promise<string | null>;
  recordDelivery(entry: MailDeliveryEntry): Promise<void>;
}

@Injectable()
export class NotificationService implements NotificationPublisher {
  constructor(
    private readonly store: NotificationStore,
    private readonly mailStore: NotificationMailStore,
    private readonly mailer: NotificationMailer,
  ) {}

  /** 인앱 저장 + 메일 발송. **어느 쪽이 실패해도 던지지 않는다** */
  publish(input: PublishNotificationInput): Promise<void>;
  list(userId: string): Promise<NotificationList>;
  markRead(userId: string, id: string): Promise<NotificationItem>;
}
```

```typescript
// apps/api/src/notification/prisma-notification-mail.store.ts
@Injectable()
export class PrismaNotificationMailStore implements NotificationMailStore {}

// apps/api/src/notification/console-notification.mailer.ts
/** 개발용. 로그에만 찍는다. 운영에서는 Resend 어댑터로 바꾼다 */
@Injectable()
export class ConsoleNotificationMailer implements NotificationMailer {}
```

```prisma
// apps/api/prisma/schema.prisma

/// 알림 메일 발송 이력. (이슈 #37, `spec-fixed.md` §8)
model MailDelivery {
  id        String             @id @default(cuid())
  userId    String
  user      User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  type      NotificationType
  /// 보낸 주소를 굳혀 둔다
  to        String
  subject   String
  status    MailDeliveryStatus
  /// 실패 사유. 성공이면 null
  error     String?
  createdAt DateTime           @default(now())

  /// "이 회원에게 뭐가 나갔나" — 문의 대응 경로
  @@index([userId, createdAt])
  /// "실패한 게 뭐가 있나" — 운영 점검 경로
  @@index([status, createdAt])
}

enum MailDeliveryStatus {
  SENT
  FAILED
}
```

**본문(`body`)은 이력에 저장하지 않는다.** 알림 본문에는 계좌 뒤 4자리·공고
제목 같은 개인정보가 담긴다. "나갔는지 확인"에 필요한 것은 받는 주소·제목·
성패까지다. 본문까지 복사하면 개인정보가 한 벌 더 생긴다.

### 에러 케이스

메일 쪽은 **바깥으로 에러를 내지 않는다.** 이슈 AC3이 그렇게 정해 놨다.

| 상황                  | 동작                                                   |
| --------------------- | ------------------------------------------------------ |
| 메일러가 던짐         | `FAILED` 이력 + 경고 로그. `publish`는 정상 종료       |
| 받는 주소를 못 찾음   | 발송 시도 안 함. 이력도 안 남김(보낸 적이 없다) + 로그 |
| 이력 기록 자체가 실패 | 로그만. `publish`는 정상 종료                          |
| 인앱 INSERT가 실패    | (#36 그대로) 로그. 메일은 **그와 별개로** 나간다       |

### HTTP

**없다.** 발송 이력을 보는 화면은 이 이슈 범위가 아니다 — AC2는 "DB에 기록이
남아 있다"까지다. 운영자 조회 화면은 관리자 도메인(#35 계열)에서 필요해질 때
만든다.

### 이 이슈에서 만들지 않는 것

| 항목                                         | 어디로                                    |
| -------------------------------------------- | ----------------------------------------- |
| `resend` 패키지 연결 · API 키 · 도메인 인증  | 배포 준비 단계. 포트 뒤 어댑터 교체       |
| 재시도 큐 · 지수 백오프                      | `ADR-NOT-4`에서 기각. PRD §4 Out of Scope |
| 수신 거부 · 채널 선택 화면                   | PRD §4 Out of Scope                       |
| 발송 이력 조회 API·화면                      | AC 밖                                     |
| 인증 코드·재설정 메일(`MailProvider`)의 이력 | 이 이슈는 **알림** 메일만 본다            |

### 기존 파일 변경 예고

| 파일                                                              | 무엇이 바뀌나                                             |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| `apps/api/prisma/schema.prisma`                                   | `MailDelivery` 모델 + enum + `User.mailDeliveries`        |
| `apps/api/src/notification/notification.service.ts`               | 생성자에 메일 포트 2개 추가 + `publish`가 메일까지 보낸다 |
| `apps/api/src/notification/notification.module.ts`                | 새 어댑터 2개 배선                                        |
| `apps/api/src/notification/notification.service.test.ts`          | 생성자 인자가 늘어 기존 테스트가 깨진다 → 함께 고침       |
| `apps/api/src/notification/notification.integration.test.ts`      | 같은 이유                                                 |
| `apps/api/src/exchange/exchange-account.service.test.ts`          | AC3을 도메인 경계에서 증명하는 시나리오 1개 추가          |
| `apps/api/src/job-post/job-post.integration.test.ts`              | 같은 이유 (생성자 인자)                                   |
| `apps/api/src/notification/job-post-schedule.integration.test.ts` | 같은 이유 (생성자 인자)                                   |

발행자 7곳(`admin-exchange` · `admin-suspension` · `application` ·
`exchange-account` · `job-post` · `job-post-schedule`)은 **안 바뀐다.**
포트를 그대로 두는 것이 `ADR-NOT-1`의 값이었다.

---

## 테스트 시나리오

### 정상

- [x] [정상] `NotificationService.publish` — should send an email to the member alongside the in-app notification
- [x] [정상] `NotificationService.publish` — should address the mail to the notified member and carry the title, body and link
- [x] [정상] `NotificationService.publish` — should record a SENT delivery after the mail goes out
- [x] [정상] `PrismaNotificationMailStore` — should find the notified member's email address from the real database
- [x] [정상] `PrismaNotificationMailStore` — should persist a sent delivery and read it back from the real database

### 경계

- [x] [경계] `NotificationService.publish` — should send an email for every notification type
- [x] [경계] `NotificationService.publish` — should record one delivery per published notification when several go out

### 예외

- [x] [예외] `NotificationService.publish` — should still send the email when storing the in-app notification fails
- [x] [예외] `NotificationService.publish` — should send nothing when the member has no address on record
- [x] [예외] `NotificationService.publish` — should record a FAILED delivery carrying the reason when the mailer throws
- [x] [예외] `NotificationService.publish` — should resolve without throwing when the mailer throws
- [x] [예외] `NotificationService.publish` — should keep the in-app notification when the mail fails
- [x] [예외] `NotificationService.publish` — should resolve without throwing when recording the delivery fails
- [x] [예외] `NotificationService.publish` — should resolve without throwing when looking up the recipient fails
- [x] [예외] `PrismaNotificationMailStore` — should persist a failed delivery with its reason in the real database
- [x] [예외] `ExchangeAccountService.register` — should keep the verified account when the notification mail fails

### 파일 배치

| 파일                                                                | 시나리오 수 |
| ------------------------------------------------------------------- | ----------- |
| `apps/api/src/notification/notification.service.test.ts` (추가)     | 12          |
| `apps/api/src/notification/notification.integration.test.ts` (추가) | 3           |
| `apps/api/src/exchange/exchange-account.service.test.ts` (추가)     | 1           |

---

## AC 대조

| AC                                                                                                                  | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC1** Given 재동의·수락·거절·모집 미달·제재·계좌 검증·환전 중 하나가 발생하면, Then 인앱과 이메일 양쪽으로 나간다 | `[정상] publish — should send an email … alongside the in-app notification`<br>`[정상] publish — should address the mail to the notified member …`<br>`[경계] publish — should send an email for every notification type`<br>`[예외] publish — should still send the email when storing the in-app notification fails`<br>`[예외] publish — should send nothing when the member has no address on record`<br>`[정상] PrismaNotificationMailStore — should find the notified member's email address …` |
| **AC2** Given 이메일 발송 후, When 발송 이력을 보면, Then DB에 기록이 남아 있다                                     | `[정상] publish — should record a SENT delivery after the mail goes out`<br>`[경계] publish — should record one delivery per published notification …`<br>`[예외] publish — should record a FAILED delivery carrying the reason …`<br>`[정상] PrismaNotificationMailStore — should persist a sent delivery …`<br>`[예외] PrismaNotificationMailStore — should persist a failed delivery with its reason …`                                                                                            |
| **AC3** Given 이메일 발송이 실패했을 때, Then 도메인 트랜잭션은 롤백되지 않고 실패만 기록된다                       | `[예외] publish — should resolve without throwing when the mailer throws`<br>`[예외] publish — should keep the in-app notification when the mail fails`<br>`[예외] publish — should resolve without throwing when recording the delivery fails`<br>`[예외] publish — should resolve without throwing when looking up the recipient fails`<br>`[예외] ExchangeAccountService.register — should keep the verified account when the notification mail fails`                                             |

### AC에 없는데 추가한 시나리오

| 시나리오                                                                                  | 왜 넣었나                                                                                                                                                    |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `[예외] publish — should send nothing when the member has no address on record`           | 파기된 계정(#39)은 주소가 사라진다. 없는 주소로 보내려다 던지면 AC3이 깨진다                                                                                 |
| `[예외] publish — should resolve without throwing when recording the delivery fails`      | **이력 기록도 DB 호출이다.** 실패를 기록하려다 실패하는 경로가 AC3의 가장 흔한 구멍이다                                                                      |
| `[예외] publish — should resolve without throwing when looking up the recipient fails`    | 같은 이유. 주소 조회도 DB 호출이다                                                                                                                           |
| `[예외] publish — should still send the email when storing the in-app notification fails` | 두 채널이 서로를 막지 않는다는 것을 고정한다. 인앱이 죽었을 때야말로 메일이 필요하다                                                                         |
| `[경계] publish — should send an email for every notification type`                       | 종류별 분기표를 두지 않기로 한 결정을 테스트로 못 박는다. 나중에 종류가 늘어도 이 테스트가 같이 늘어난다                                                     |
| `[예외] ExchangeAccountService.register — should keep the verified account …`             | AC3은 "**도메인** 트랜잭션이 롤백되지 않는다"이다. 알림 안쪽에서만 확인하면 실제 도메인 동작이 살아남는지는 증명이 안 된다. 발행자 한 곳에서 끝까지 확인한다 |

### AC에 있는데 시나리오가 없는 것

없다.

**커버리지:** AC 3개 / 시나리오 16개 / 미커버 0개
