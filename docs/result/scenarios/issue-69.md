# 이슈 #69 — API 컨트롤러가 본문의 userId를 그대로 믿는다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/69
> PRD: `docs/result/prd/auth-member.md`
> 담당: B · 선행: #4 (CLOSED)
> 상태: 시그니처 확정 / 시나리오 도출 완료

---

## 시그니처

### 관련 ADR

- **ADR-AUTH-1 (Refresh 토큰을 로그인 세션당 한 행으로 둔다)** — 가드가 Access 쿠키만 보지 않고
  `LoginService.authenticate`를 부르는 이유가 여기 있다. Access가 만료돼도 Refresh가 살아 있으면
  Access만 다시 발급한다. 가드가 Access만 검사하면 **15분마다 튕기는 화면**이 된다.
  `admin.guard.ts`가 같은 이유로 같은 선택을 했다.
- 같은 ADR에서, Access 토큰은 15분간 **서명만으로 유효**하다. 이 이슈는 그 결정을 바꾸지 않는다
  (아래 "이 이슈에서 만들지 않는 것" 참고).

### 타입

```typescript
// apps/api/src/auth/member.guard.ts (새 파일)

/** 가드를 통과한 요청에 심어 두는 주체 */
export interface MemberPrincipal {
  userId: string;
}

/** 가드가 주체를 얹은 요청 */
export interface RequestWithMember extends Request {
  member?: MemberPrincipal;
}

/**
 * 로그인한 회원만 통과시킨다.
 *
 * `AdminGuard`에서 `role === ADMIN` 검사만 뺀 것과 같다. 누구인지 판정하는
 * 경로는 `/api/auth/me`·#36·`AdminGuard`와 하나로 둔다.
 */
@Injectable()
export class MemberGuard implements CanActivate {
  constructor(private readonly logins: LoginService) {}
  canActivate(context: ExecutionContext): Promise<boolean>;
}

/** 컨트롤러가 회원 id를 꺼내는 파라미터 데코레이터 */
export const CurrentMember: () => ParameterDecorator;
```

`AuthModule`이 `providers`·`exports`에 `MemberGuard`를 넣고, 가드를 쓰는 다섯 모듈
(`job-post`·`application`·`point`·`exchange`·`rating`)이 `imports`에 `AuthModule`을 더한다.
지금은 아무도 `AuthModule`을 import하지 않는다.

### 가드가 붙는 라우트

컨트롤러 통째가 아니라 **라우트마다** 붙인다. 공개 라우트가 섞여 있기 때문이다.

| 컨트롤러           | 가드 붙음                                                                                   | 가드 없음                                         | 없는 이유                             |
| ------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------- |
| `point`            | `POST /payments`, `/payments/confirm`, `/payments/:id/cancel`, `/refunds`, `GET /points/me` | **`POST /payments/webhook`**                      | 서명 검증이 인증 역할을 한다          |
| `job-post`         | `POST /`, `PATCH /:id`, `POST /:id/cancel`                                                  | `GET /`, `GET /:id`, `GET /:id/versions/:version` | 공고 열람은 로그인 전에도 된다        |
| `application`      | 전 라우트 (11개)                                                                            | —                                                 | 전부 당사자 데이터다                  |
| `exchange-request` | `POST /`                                                                                    | —                                                 |                                       |
| `exchange-account` | `PUT /`, `GET /me`                                                                          | —                                                 |                                       |
| `rating`           | `POST /`                                                                                    | `GET /:userId`                                    | 프로필 평점은 공개다 (`MemberRating`) |

### 본문·쿼리에서 신원 필드를 지운다

"무시한다"를 주석이 아니라 타입으로 만든다. zod는 스키마에 없는 키를 버리므로, 필드를 지우면
남의 `userId`를 실어 보내도 **파싱 단계에서 조용히 떨어진다** (AC2).

| 파일                                 | 스키마                                                                                                                                                   | 변화                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `packages/shared/src/application.ts` | `applyRequestSchema`                                                                                                                                     | `applicantId` 삭제                           |
|                                      | `completeJobPostRequestSchema`                                                                                                                           | `employerId` 삭제                            |
|                                      | `acceptApplicationRequestSchema`, `rejectApplicationRequestSchema`, `markNoShowRequestSchema`, `cancelApplicationRequestSchema`, `reacceptRequestSchema` | 필드가 0개가 되므로 **스키마와 타입째 삭제** |
| `packages/shared/src/exchange.ts`    | `requestExchangeSchema`                                                                                                                                  | `userId` 삭제                                |
| `packages/shared/src/rating.ts`      | `rateRequestSchema`                                                                                                                                      | `raterId` 삭제                               |

`packages/shared/src/point.ts`는 손대지 않는다 — `userId`가 있는 것은 요청 스키마가 아니라
내부 원장(`ledgerEntrySchema`)이다.

컨트롤러에서는 `userIdOf`(point·exchange-account), `employerIdOf`(job-post),
`applicantIdOf`(application) 세 함수와 `employerListQuerySchema`의 `employerId`가 사라진다.

```typescript
// 전
async refund(@Body() body: unknown): Promise<RefundResult> {
  const userId = userIdOf(body);
}

// 후
@UseGuards(MemberGuard)
async refund(
  @CurrentMember() userId: string,
  @Body() body: unknown,
): Promise<RefundResult>;
```

서비스 계층은 지금도 회원 id를 인자로 받고, 그 값이 어디서 왔는지 모른다. 이 이슈는
"누가 그 인자를 채우는가"만 바꾼다.

> **Green에서 드러난 예외 (2026-09-19).** 세 서비스(`rating`·`exchange-request`·`application`)는
> 받은 입력을 **wire 스키마로 직접 `parse`하고 있었다.** 그 스키마에서 신원 칸을 빼면 컨트롤러가
> 얹어 준 회원 id가 서비스의 `parse`에서 도로 떨어져 나간다. 그래서 각 서비스에 입력 스키마
> (`rateInputSchema`·`exchangeInputSchema`·`applyInputSchema`·`completeInputSchema`)를 두고
> **wire 스키마 + 회원 id**로 확장했다. 몸체에 무엇이 실려 오든 경계에서 버려지는 것은 그대로다.

### 에러 케이스

| 상황                                                    | 에러 코드               | HTTP |
| ------------------------------------------------------- | ----------------------- | ---- |
| 쿠키가 없다                                             | `LOGIN_UNAUTHENTICATED` | 401  |
| Access가 만료됐고 Refresh도 없다·만료됐다·모르는 값이다 | `LOGIN_UNAUTHENTICATED` | 401  |
| Access 서명이 틀렸고 Refresh가 없다                     | `LOGIN_UNAUTHENTICATED` | 401  |

새 에러를 만들지 않는다. `LoginHttpError`를 그대로 쓴다.

`LOGIN_ACCOUNT_DEACTIVATED`(403)는 이 경로에서 나오지 않는다. `authenticate`는 탈퇴 여부를
보지 않고 로그인 시점에만 본다. 가드는 `LoginError`를 통째로 `LoginHttpError`에 넘기므로
나중에 그 판정이 `authenticate`에 들어오면 코드를 고치지 않아도 403이 나간다.

### 웹 화면 Props

새 Props는 없다. **없어지는 것만 있다.**

```typescript
// apps/web/src/app/job-posts/[id]/ReacceptPanel.tsx
interface ReacceptPanelProps {
  applicationId: string;
  applicantId: string; // ← 삭제. 부모(ApplyPanel)가 더는 알지 못한다
  onDone: () => void;
}
```

나머지 다섯 화면은 `useState`로 들고 있던 회원 id와 그 입력창, 그리고 요청 몸체·쿼리의
해당 필드가 사라진다. 401이 오면 서버 문구("로그인이 필요합니다")가 이미 있는
`messageOf` 경로로 화면에 뜬다 — 오류 표시 코드를 새로 만들지 않는다.

### 이 이슈에서 만들지 않는 것

- **요청마다 세션 행을 확인하는 것.** 로그아웃 뒤에도 따로 복사해 둔 Access 토큰은 최대 15분간
  통과한다. 이건 ADR-AUTH-1이 "Access는 서명만으로 유효한 15분짜리"로 정한 결과다. 막으려면
  모든 요청에 DB 조회가 한 번씩 붙고 그 ADR을 다시 여는 일이 된다. AC4는 **브라우저 흐름**
  (로그아웃이 쿠키를 지우고, 다음 요청이 401)까지 검증한다.
- **`agreement.controller.ts`.** `GET /api/agreements/mine?userId=`와 PDF 내려받기도 같은
  결함이 있지만, 동의서 서명은 **가입 도중**에 일어나 그 시점에 세션이 없다. 라우트별로 다르게
  판단해야 해서 별도 이슈로 남긴다.
- **제재·탈퇴 회원 차단.** 가드는 "로그인했는가"만 본다. 제재 판정은 각 서비스가 이미 한다.
- **`parseCookies`·`callerOf` 중복 제거.** 지금 `login.controller.ts`·`notification.controller.ts`·
  `admin.guard.ts`에 같은 함수가 있고 `member.guard.ts`가 네 번째가 된다. 이슈가
  "admin.guard와 notification.controller는 건드리지 않는다"고 못 박았으므로 여기서 합치지 않는다.
  Refactor 단계에서 다시 본다.

---

## 테스트 시나리오

### 정상

- [x] [정상] `MemberGuard` — should put the token subject on the request when the access cookie is valid
- [x] [정상] `MemberGuard` — should renew the access cookie and continue when the access token expired but the refresh token is alive
- [x] [정상] `CurrentMember` — should return the userId that the guard put on the request
- [x] [정상] `PointController.refund` — should refund for the caller when the body carries no userId
- [x] [정상] `PointController.myPoints` — should read the caller's balance without a userId query
- [x] [정상] `JobPostController.create` — should create the post for the caller when the body carries no employerId
- [x] [정상] `ApplicationController.apply` — should apply as the caller when the body carries only jobPostId
- [x] [정상] `ApplicationController.listForEmployer` — should list applicants for the caller when the query carries only jobPostId
- [x] [정상] `RatingController.rate` — should rate as the caller when the body carries no raterId
- [x] [정상] `ExchangeRequestController.request` — should request the exchange for the caller when the body carries only amount
- [x] [정상] `ExchangeAccountController.mine` — should read the caller's account without a userId query
- [x] [정상] `PointController.webhook` — should accept the webhook with a valid signature and no cookie
- [x] [정상] `PointsPage` — should show the balance with no member id input on the screen
- [x] [정상] `NewJobPostPage` — should post the job post without employerId in the body
- [x] [정상] `ApplyPanel` — should post the application with only jobPostId in the body
- [x] [정상] `ApplicantList` — should request the applicant list with only jobPostId in the query
- [x] [정상] `ExchangeAccountPage` — should load the registered account without a userId query

### 경계

- [x] [경계] `MemberGuard` — should not set a renewed cookie when the access token is still valid
- [x] [경계] `MemberGuard` — should authenticate from the refresh cookie alone when the access cookie is absent
- [x] [경계] `applyRequestSchema` — should drop applicantId when the body still carries it
- [x] [경계] `rateRequestSchema` — should drop raterId when the body still carries it
- [x] [경계] `requestExchangeSchema` — should drop userId when the body still carries it
- [x] [경계] `JobPostController.list` — should stay public and answer without any cookie
- [x] [경계] `RatingController.summary` — should stay public and answer without any cookie
- [x] [경계] `CurrentMember` — should throw when the route has no MemberGuard

### 예외

- [x] [예외] `MemberGuard` — should answer 401 LOGIN_UNAUTHENTICATED when the request carries no cookie header
- [x] [예외] `MemberGuard` — should answer 401 when both cookies are present but neither is valid
- [x] [예외] `PointController.refund` — should answer 401 when unauthenticated even though the body carries a userId
- [x] [예외] `ApplicationController.accept` — should answer 401 when unauthenticated even though the body carries an employerId
- [x] [예외] `JobPostController.create` — should answer 401 when unauthenticated even though the body carries an employerId
- [x] [예외] `MemberGuard` — should answer 401 for the same request after logout, when the browser no longer sends the auth cookies

---

## AC 대조

| AC                                                                        | 커버하는 시나리오                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 쿠키 없는 `POST /api/refunds`에 userId를 담아 보내면 401              | `[예외] PointController.refund — should answer 401 when unauthenticated even though the body carries a userId`<br>`[예외] MemberGuard — should answer 401 LOGIN_UNAUTHENTICATED when the request carries no cookie header`                                                                                |
| AC2 본문의 남의 userId는 무시되고 토큰 주체로 처리된다                    | `[경계] applyRequestSchema — should drop applicantId when the body still carries it`<br>`[경계] rateRequestSchema — …drop raterId…`<br>`[경계] requestExchangeSchema — …drop userId…`<br>`[정상] PointController.refund`·`JobPostController.create`·`ApplicationController.apply`·`RatingController.rate` |
| AC3 Access 만료 + Refresh 유효면 갱신하고 그대로 진행                     | `[정상] MemberGuard — should renew the access cookie and continue when the access token expired but the refresh token is alive`<br>`[경계] MemberGuard — should not set a renewed cookie when the access token is still valid`                                                                            |
| AC4 로그아웃한 뒤 같은 요청을 다시 보내면 막힌다                          | `[예외] MemberGuard — should answer 401 for the same request after logout, when the browser no longer sends the auth cookies`                                                                                                                                                                             |
| AC5 포트원 웹훅은 쿠키 없이 서명만으로 그대로 동작한다                    | `[정상] PointController.webhook — should accept the webhook with a valid signature and no cookie`                                                                                                                                                                                                         |
| AC6 웹 화면 5개에서 userId를 보내는 코드가 사라진다 (회원 id 입력창 포함) | `[정상] PointsPage`·`NewJobPostPage`·`ApplyPanel`·`ApplicantList`·`ExchangeAccountPage` 5개                                                                                                                                                                                                               |

**AC에 없는데 추가한 시나리오**

| 시나리오                                                            | 왜 넣었나                                                                                                                                       |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `JobPostController.list`·`RatingController.summary`가 공개로 남는다 | 가드를 컨트롤러 통째로 붙이면 공고 목록과 프로필 평점이 로그인 벽 뒤로 들어간다. 막는 것만큼 **안 막을 것을 안 막는 것**도 이 이슈의 결과물이다 |
| `CurrentMember`가 가드 없는 라우트에서 throw                        | `CurrentAdmin`이 같은 이유로 같은 장치를 뒀다. 가드를 빠뜨린 라우트가 빈 문자열을 회원 id로 받는 일을 막는다                                    |
| `MemberGuard`가 Refresh 쿠키만으로도 인증                           | AC3의 이웃 경계다. AC3은 "Access 만료 + Refresh 유효"인데, Access 쿠키가 **아예 없는** 경우도 같은 길로 가야 한다                               |

**커버리지:** AC 6개 / 시나리오 31개 / 미커버 0개

---

## AC 검증

`ac-verifier` 에이전트의 판정 원문 (2026-09-19). **구현자가 이 표를 고치지 않는다.**

### AC 1 — 쿠키 없는 `POST /api/refunds`에 `userId`를 담아 보내면 401

✅ 충족

- 테스트: `should answer 401 when unauthenticated even though the body carries a userId` (`apps/api/src/auth/member.guard.routes.test.ts`), `should answer 401 LOGIN_UNAUTHENTICATED when the request carries no cookie header` (`apps/api/src/auth/member.guard.test.ts`)
- 구현: `PointController.refund`에 `@UseGuards(MemberGuard)` 부착, `MemberGuard.canActivate`가 쿠키 없으면 `LoginError` → `LoginHttpError`(401)
- 근거: 라우트 메타데이터를 리플렉션으로 읽어 `MemberGuard`가 걸려 있는지 확인한 뒤, 그 가드를 직접 실행해 몸체에 `userId`를 실어도 401이 나는 것을 단언한다. 목(mock)이 아니라 실제 가드 인스턴스를 돌린다.

### AC 2 — 본문의 남의 `userId`는 무시되고 토큰 주체로 처리된다

✅ 충족

- 테스트: `should drop applicantId when the body still carries it`, `should drop raterId…`, `should drop userId…`, `should ignore a userId in the body and refund for the caller`
- 구현: 스키마에서 신원 필드 삭제 + 컨트롤러가 `@CurrentMember()`로 받은 값을 서비스에 전달
- 근거: zod 스키마 레벨에서 필드가 파싱 후 사라지는 것을 단언했고, 컨트롤러 레벨에서도 본문에 `userId: 'usr_someone_else'`를 넣어도 `refund`가 `CALLER`로 호출됨을 단언. 두 layer가 겹으로 확인됨. 서비스 레벨의 `rateInputSchema`/`exchangeInputSchema` extend 우회도 직접 읽어 wire 스키마가 회원 id를 되돌려주지 않는 구조임을 확인.

### AC 3 — Access 만료 + Refresh 유효면 갱신하고 그대로 진행

✅ 충족

- 테스트: `should renew the access cookie and continue when the access token expired but the refresh token is alive`, 경계 `should not set a renewed cookie when the access token is still valid`, `should authenticate from the refresh cookie alone when the access cookie is absent`
- 구현: `MemberGuard.callerOf`가 `LoginService.authenticate`에 위임하고 `session.renewedAccessToken`이 있을 때만 `response.cookie(...)`를 호출
- 근거: 쿠키 옵션(`httpOnly`, `secure`, `sameSite`, `path`, `expires`)까지 `toHaveBeenCalledWith`로 정확히 검증했고, 갱신이 필요 없을 때 쿠키가 호출되지 않는 것도 별도로 검증. "Access 만료의 정확한 경계"(15분 시점) 자체는 `LoginService.authenticate`의 책임이며 선행 이슈(#4)의 범위 — 이 이슈는 그 판정을 그대로 위임하는 배선만 다루므로 범위에서 충분.

### AC 4 — 로그아웃한 뒤 같은 요청을 다시 보내면 막힌다

✅ 충족

- 테스트: `should answer 401 for the same request after logout, when the browser no longer sends the auth cookies`
- 구현: `MemberGuard.callerOf`가 쿠키 헤더를 매 요청마다 새로 파싱하므로 로그아웃 후 쿠키가 없으면 401
- 근거: 같은 가드 인스턴스로 로그인 상태 요청이 통과하는 것을 먼저 확인한 뒤, 쿠키 없는 "로그아웃 후" 컨텍스트로 다시 호출해 401을 단언. 시나리오 문서가 명시한 대로 "브라우저 흐름"만 검증하고, DB 세션 폐기는 ADR-AUTH-1에 따라 의도적으로 범위 밖 — 문서에 그 이유가 적혀 있고 코드도 그와 일치.

### AC 5 — 포트원 웹훅은 쿠키 없이 서명만으로 그대로 동작한다

✅ 충족

- 테스트: `should accept the webhook with a valid signature and no cookie`, `should hand the raw body to the service so the signature can be checked`
- 구현: `PointController.webhook`에 `@UseGuards(MemberGuard)`가 없음
- 근거: 라우트 메타데이터에 `MemberGuard`가 **없음**을 직접 단언. 다른 다섯 컨트롤러가 가드를 얻는 동안 웹훅 라우트만 예외로 남겨진 것을 코드와 테스트 양쪽에서 확인.

### AC 6 — 웹 화면 5개에서 `userId`를 보내는 코드가 사라진다

✅ 충족

- 테스트: `should show the balance with no member id input on the screen`, `should load the registered account without a userId query`, `NewJobPostPage`·`ApplyPanel`·`ApplicantList` 각 파일의 대응 테스트
- 구현: 다섯 화면 전부에서 `userId`/`employerId`/`applicantId` 문자열이 grep으로 전혀 나오지 않음(직접 확인)
- 근거: `points/page.test.tsx`가 `screen.queryByLabelText('회원 id')`가 DOM에 없음을 실제로 단언 — 목이 아니라 렌더링된 실제 DOM을 검사. 5개 화면 전체 웹 테스트가 140/140 통과로 확인됨.

**범위 확장(6번째 컨트롤러 `exchange-account`)**: 이슈 본문은 5개 컨트롤러만 언급하지만, `my/account/page.tsx`가 부르는 `exchange-account.controller.ts`가 시나리오 문서와 커밋 메시지에 명시적으로 6번째로 포함되어 있어 범위 이탈이 아니라 문서화된 확장으로 판단. `agreement.controller.ts` 제외 사유도 시나리오 문서에 명시되어 있어 타당.

```
AC 6개 중 — ✅ 6 / ⚠️ 0 / ❌ 0
```

가짜 테스트나 우회 구현은 발견하지 못했다. API 전체 스위트(70 test files / 986 tests)와 web 스위트(28 files / 140 tests) 모두 실제로 실행해 통과를 확인했다.

### 구현자 이견

없다.
