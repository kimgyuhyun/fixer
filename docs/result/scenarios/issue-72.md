# 이슈 #72 — 동의서 조회·PDF가 쿼리의 userId를 그대로 믿는다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/72
> PRD: `docs/result/prd/agreement.md`
> 담당: A · 선행: #69
> 상태: 구현 완료 / AC 검증 통과 / 보안 점검 완료

---

## 시그니처

### 관련 ADR

- **#69가 확정한 `MemberGuard`·`@CurrentMember()`** — 새 가드를 만들지 않는다. 누구인지
  판정하는 경로를 `/api/auth/me`·`AdminGuard`와 하나로 둔다. Access가 만료돼도 Refresh가
  살아 있으면 Access만 다시 발급한다(ADR-AUTH-1) — 가드가 Access만 보면 **15분마다 튕기는**
  화면이 된다.
- **ADR-AGR-2 (병합은 서버에서)** — 저장된 PDF는 이름·서명 이미지가 들어간 개인 문서이고
  분쟁 시 증거다. `GET /agreements/:id`가 그 문서를 내려주는 유일한 경로다.
- **`spec-fixed.md` §2.2 (가입 흐름)** — 아래 "`POST /agreements`를 어떻게 하는가"의 근거다.

**이 이슈는 새 결정을 하지 않는다.** #69가 만든 것을 **라우트마다 골라** 붙이는 일이다.

### `POST /agreements`를 어떻게 하는가 — 가드를 붙이지 않는다

이슈 본문이 "실제 설계 지점"이라고 적은 자리다. 답은 문서와 코드 양쪽에 이미 있다.

**문서** — `spec-fixed.md` §2.2의 가입 흐름은 여섯 단계이고, 서명은 **5단계**다.

```
1 이메일 코드 → 2 코드 검증 → 3 비밀번호 → 4 주소 → 5 동의서 서명 → 6 Agreement 생성 후 가입 완료
```

서명은 **가입이 끝나기 전**에 일어난다. "가입 완료 후 서명"이 아니다.

**코드** — 그 시점에 세션이 없다는 사실이 세 곳에 그대로 드러나 있다.

| 확인한 것                                    | 무엇을 말하는가                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `signup.controller.ts`                       | 가입 응답이 `SignedUp` 본문뿐이다. **쿠키를 내려주지 않는다**                                    |
| `login.controller.ts`                        | 인증 쿠키를 만드는 곳은 여기 하나뿐이고, 가입 흐름은 여기를 지나지 않는다                        |
| `apps/web/src/app/signup/agreement/page.tsx` | 회원 id를 `sessionStorage`의 `fixer.signup.userId`에서 읽어 몸체에 싣는다 — 쿠키가 없어서다      |
| `user-address.controller.ts`                 | 4단계(주소)도 같은 이유로 경로에서 `userId`를 받고, 그 사실이 FIXME와 보안 예외 대장에 적혀 있다 |

그러므로 **`POST /agreements`에 `MemberGuard`를 붙이면 가입이 그 자리에서 막힌다.** AC4가
"이 이슈가 가입을 막지 않는다"를 요구하는 이유가 그것이다.

**서명을 세션에 묶으려면 둘 중 하나를 정해야 한다.**

1. 가입 직후 자동 로그인 — 3단계에서 쿠키를 내려준다
2. 1회용 서명 토큰 — 가입 흐름 전용 단기 자격을 새로 만든다

둘 다 **새 인증 메커니즘**이고, `spec-fixed.md`·`prd/agreement.md`·`adr/agreement.md`·
`adr/auth-member.md` 어디에도 결정이 없다. 여기서 골라 버리면 나중에 뜯을 구조 결정을
구현이 대신 내린 것이 된다. **이 이슈에서 만들지 않는다 — ADR이 필요한 일이다.**

그래서 `POST /agreements`는 **지금 모양 그대로 둔다.** 이 이슈의 범위는 제목 그대로
**조회·PDF**이고, AC 6개 중 서명을 건드려야 충족되는 것은 하나도 없다.

### 라우트별 판단

| 라우트                     | 가드          | 왜                                                       |
| -------------------------- | ------------- | -------------------------------------------------------- |
| `GET /agreements/template` | **없음**      | 가입 전에 읽는 문서다. 붙이면 가입 5단계가 백지가 된다   |
| `POST /agreements`         | **없음**      | 위 참고. 가입 도중이라 세션이 없다                       |
| `GET /agreements/mine`     | `MemberGuard` | 토큰 주체의 것만                                         |
| `GET /agreements/:id`      | `MemberGuard` | 토큰 주체의 것만. `requesterId` 대조는 **그대로 남긴다** |

`:id`의 대조를 남기는 이유 — 가드는 "로그인했는가"만 본다. 그 회원이 **그 동의서의 주인인가**는
서비스의 `getMyAgreementPdf`가 판정한다(#8 AC2). 가드가 대조를 대신하지 않는다. 이 이슈가
고치는 것은 **대조에 넣는 값의 출처**다 — 요청자가 스스로 밝힌 값에서 토큰의 주체로.

### 타입

새 타입이 없다. **자리를 무엇이 채우는가만 바뀐다.**

```typescript
// apps/api/src/agreement/agreement.controller.ts

// 전 — 요청자가 스스로 밝힌 값
@Get('mine')
async mine(
  @Query('userId') userId: string,
  @Res({ passthrough: true }) res: Response,
): Promise<AgreementSummary | undefined>;

// 후 — 토큰의 주체
@Get('mine')
@UseGuards(MemberGuard)
async mine(
  @CurrentMember() userId: string,
  @Res({ passthrough: true }) res: Response,
): Promise<AgreementSummary | undefined>;
```

```typescript
// 전
@Get(':id')
async one(
  @Param('id') id: string,
  @Query('userId') userId: string,
  @Res() res: Response,
): Promise<void>;

// 후
@Get(':id')
@UseGuards(MemberGuard)
async one(
  @Param('id') id: string,
  @CurrentMember() userId: string,
  @Res() res: Response,
): Promise<void>;
```

파라미터의 **개수·순서·타입이 그대로다.** 그래서 `agreement.controller.test.ts`의 기존 단언은
손대지 않아도 성립한다. 바뀐 것은 그 인자를 누가 채우는가뿐이다.

**`userId ?? ''` 두 군데가 사라진다.** 가드를 통과했으면 회원 id는 반드시 있고, 없으면
`memberOf`가 던진다(#69). 빈 문자열이 서비스까지 내려갈 길이 없어진다.

`AgreementModule`이 `imports`에 `AuthModule`을 더한다. `AuthModule`은 이미 `MemberGuard`를
`exports`에 두고 있다(#69) — 그쪽은 고치지 않는다.

### 에러 케이스

| 상황                                                    | 에러 코드               | HTTP |
| ------------------------------------------------------- | ----------------------- | ---- |
| 쿠키가 없다                                             | `LOGIN_UNAUTHENTICATED` | 401  |
| Access가 만료됐고 Refresh도 없다·만료됐다·모르는 값이다 | `LOGIN_UNAUTHENTICATED` | 401  |
| 남의 동의서 id로 PDF를 요청했다                         | `AGREEMENT_FORBIDDEN`   | 403  |
| 모르는 동의서 id                                        | `AGREEMENT_NOT_FOUND`   | 404  |
| 서명한 동의서가 아직 없다                               | —                       | 204  |

새 에러를 만들지 않는다. 401은 `LoginHttpError`가, 403·404·204는 지금 경로가 그대로 낸다.

### 웹 화면 Props

새 Props는 없다. **없어지는 것만 있다.**

```typescript
// apps/web/src/app/my/agreement/page.tsx

// 사라진다 — 회원을 화면이 고르지 않는다
const SIGNED_UP_USER_ID_KEY = 'fixer.signup.userId';
const userId = useSyncExternalStore(subscribeToNothing, readSignedUpUserId, readNothingOnServer);

// 전
fetch(`/api/agreements/mine?userId=${encodeURIComponent(id)}`)
href={`/api/agreements/${agreement.id}?userId=${encodeURIComponent(userId ?? '')}`}

// 후
fetch('/api/agreements/mine')
href={`/api/agreements/${agreement.id}`}
```

`sessionStorage`를 읽지 않으므로 "회원이 정해질 때까지 기다리는" `useEffect` 의존성도
사라진다. 화면에 들어오면 바로 읽는다 — #69가 고친 다섯 화면과 같은 모양이다.

**401일 때 무엇을 보여주는가.** 지금은 회원 id가 없으면 "아직 서명한 동의서가 없습니다."가
떴다. 그 문구를 401에 그대로 쓰면 **로그인이 안 된 것을 "동의서가 없다"고 거짓말하게 된다.**
서버가 내려주는 문구("로그인이 필요합니다.")를 그대로 띄운다 — #69의 다섯 화면이 쓴
`messageOf` 경로와 같다. 오류 표시를 새로 설계하지 않는다.

`signup/agreement/page.tsx`는 **손대지 않는다.** 위 판단대로 `POST`가 그대로이기 때문이다.

### 이 이슈에서 만들지 않는 것

- **서명(`POST /agreements`)을 세션에 묶는 것.** 위 참고. 자동 로그인이든 1회용 토큰이든
  **새 인증 메커니즘을 정하는 일**이라 ADR이 먼저다. 별도 이슈로 남긴다.
- **`GET /agreements/template`에 가드를 붙이는 것.** 가입 전에 읽는 문서다.
- **관리자 열람 경로.** PRD의 "운영자로서 …증명할 수 있어야 한다"는 별도 관리자 화면(#45)의
  몫이고, 이 컨트롤러에는 그 라우트가 없다.
- **탈퇴·제재 회원 차단.** 가드는 "로그인했는가"만 본다(#69와 같다).
- **`parseCookies` 중복 제거.** #69·#71이 이미 보류한 항목이다. 이 이슈는 그 함수를 건드리지 않는다.

---

## 테스트 시나리오

### 정상

- [x] [정상] `GET /agreements/mine` — should read the agreement of the token subject when the query carries no userId
- [x] [정상] `GET /agreements/:id` — should send the pdf of the token subject when the query carries no userId
- [x] [정상] `MemberGuard` on `GET /agreements/mine` — should renew the access cookie and let the read continue when the access token expired but the refresh token is alive
- [x] [정상] `POST /agreements` — should still sign during signup when the request carries no cookie
- [x] [정상] `GET /agreements/template` — should still answer when the request carries no cookie
- [x] [정상] `MyAgreementPage` — should request the summary without a userId query
- [x] [정상] `MyAgreementPage` — should link to the signed pdf without a userId query

### 경계

- [x] [경계] `GET /agreements/mine` — should carry MemberGuard on the route
- [x] [경계] `GET /agreements/:id` — should carry MemberGuard on the route
- [x] [경계] `POST /agreements` — should stay guardless so the signup flow is not blocked
- [x] [경계] `GET /agreements/template` — should stay guardless so the document is readable before signup
- [x] [경계] `GET /agreements/mine` — should ignore another member's userId in the query and answer for the token subject
- [x] [경계] `GET /agreements/:id` — should hand the token subject as requesterId even when the query carries another member's userId
- [x] [경계] `GET /agreements/mine` — should answer 204 when the token subject never signed
- [x] [경계] `MemberGuard` on `GET /agreements/mine` — should authenticate from the refresh cookie alone when the access cookie is absent
- [x] [경계] 동의서 조회 요청 — should leave no code that puts a member id into the agreement read request

### 예외

- [x] [예외] `GET /agreements/mine` — should answer 401 LOGIN_UNAUTHENTICATED when the request carries no cookie even though the query carries a userId
- [x] [예외] `GET /agreements/mine` — should not read anyone's agreement when the request is unauthenticated
- [x] [예외] `GET /agreements/:id` — should answer 401 when the request carries no cookie even though the query carries a userId
- [x] [예외] `GET /agreements/:id` — should answer 403 when the agreement belongs to another member
- [x] [예외] `GET /agreements/:id` — should send no pdf bytes when the agreement belongs to another member
- [x] [예외] `GET /agreements/:id` — should answer 404 when the id is unknown
- [x] [예외] `MyAgreementPage` — should show the server message when the read answers 401

---

## AC 대조

| AC                                                              | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 쿠키 없는 `GET /agreements/mine?userId=`는 401              | `[예외] …401 LOGIN_UNAUTHENTICATED when the request carries no cookie even though the query carries a userId`<br>`[예외] …should not read anyone's agreement when the request is unauthenticated`<br>`[경계] GET /agreements/mine — should carry MemberGuard on the route`<br>`[예외] MyAgreementPage — should show the server message when the read answers 401`                                                                                          |
| AC2 쿼리의 남의 `userId`는 무시되고 토큰 주체의 동의서가 나온다 | `[경계] …should ignore another member's userId in the query and answer for the token subject`<br>`[정상] …should read the agreement of the token subject when the query carries no userId`<br>`[경계] 동의서 조회 요청 — should leave no code that puts a member id into the agreement read request`                                                                                                                                                       |
| AC3 남의 동의서 id로 PDF를 요청하면 막힌다 (#8 AC2 성립)        | `[예외] …should answer 403 when the agreement belongs to another member`<br>`[예외] …should send no pdf bytes when the agreement belongs to another member`<br>`[경계] …should hand the token subject as requesterId even when the query carries another member's userId`<br>`[경계] GET /agreements/:id — should carry MemberGuard on the route`<br>`[예외] …should answer 401 when the request carries no cookie even though the query carries a userId` |
| AC4 가입 중인 사용자가 서명하면 그대로 동작한다                 | `[정상] POST /agreements — should still sign during signup when the request carries no cookie`<br>`[경계] POST /agreements — should stay guardless so the signup flow is not blocked`                                                                                                                                                                                                                                                                      |
| AC5 `GET /agreements/template`은 로그인 없이 열린다             | `[정상] GET /agreements/template — should still answer when the request carries no cookie`<br>`[경계] GET /agreements/template — should stay guardless so the document is readable before signup`                                                                                                                                                                                                                                                          |
| AC6 웹 화면에서 `userId`를 보내는 코드가 사라진다               | `[정상] MyAgreementPage — should request the summary without a userId query`<br>`[정상] MyAgreementPage — should link to the signed pdf without a userId query`<br>`[경계] 동의서 조회 요청 — should leave no code that puts a member id into the agreement read request`                                                                                                                                                                                  |

**AC에 없는데 추가한 시나리오**

| 시나리오                                                                       | 왜 넣었나                                                                                                                                       |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `MemberGuard … should renew the access cookie and let the read continue…`      | ADR-AUTH-1의 결과다. 가드가 Access만 보면 마이페이지가 15분마다 튕긴다. #69·#71이 같은 이유로 같은 시나리오를 뒀다                              |
| `MemberGuard … should authenticate from the refresh cookie alone…`             | 위의 이웃 경계다. Access 쿠키가 **아예 없는** 경우도 같은 길로 가야 한다                                                                        |
| `GET /agreements/mine — should answer 204 when the token subject never signed` | 가드를 붙이면서 "없는 것은 오류가 아니다"(#8)가 깨지기 쉽다. 401과 204는 둘 다 화면에 아무것도 없는 상태라 한쪽이 다른 쪽으로 새도 눈에 안 띈다 |
| `GET /agreements/:id — should answer 404 when the id is unknown`               | 위와 같은 이유. 가드를 통과한 뒤의 에러 매핑이 그대로인지 본다                                                                                  |

**AC4·AC5의 시나리오가 둘뿐인 이유.** 두 AC는 **아무것도 바뀌지 않는다**를 요구한다. 바뀌지
않았음을 보는 방법은 두 가지뿐이다 — 라우트에 가드가 없다는 것과, 쿠키 없이 불러도 답이
나온다는 것. 숫자를 맞추려고 같은 단언을 쪼개면 테스트가 아니라 장식이 된다.

**웹 테스트 1개는 더한 것이 아니라 고쳐 쓴 것이다.** `MyAgreementPage`의 기존
`should link to the signed pdf when one exists`가 `href`에 `userId`가 실리는 것을 단언하고
있었다. 그 단언이 이번 이슈가 없애는 대상이므로, 새 이름
(`…without a userId query`)으로 다시 쓴다.

**커버리지:** AC 6개 / 시나리오 23개 / 미커버 0개
---

## AC 검증

`ac-verifier` 에이전트의 판정 원문 (2026-09-19). **구현자가 이 표를 고치지 않는다.**

### AC 1 — 쿠키 없는 `GET /api/agreements/mine?userId=`는 401

✅ 충족

- 테스트: `should answer 401 LOGIN_UNAUTHENTICATED when the request carries no cookie even though the query carries a userId`, `should not read anyone's agreement when the request is unauthenticated` (`apps/api/src/agreement/agreement.route.test.ts`)
- 구현: `AgreementController.mine`에 `@UseGuards(MemberGuard)`, `MemberGuard.canActivate` → `authenticate`가 쿠키 없으면 `LoginError(UNAUTHENTICATED)`
- 근거: 401 상태와 `LOGIN_UNAUTHENTICATED` 코드를 단언하고, 별도 테스트로 `findMyLatest`가 **호출조차 되지 않았음**을 단언한다 — 401을 내리면서 조회는 이미 한 배선을 잡는다.

### AC 2 — 쿼리의 남의 `userId`는 무시되고 토큰 주체의 동의서가 나온다

✅ 충족

- 테스트: `should ignore another member's userId in the query and answer for the token subject`, `동의서 조회 요청 — should leave no code that puts a member id into the agreement read request`
- 구현: `mine(@CurrentMember() userId, …)` — `@Query`를 더 이상 받지 않는다. `CurrentMember`는 가드가 심어둔 `request.member.userId`만 돌려주고 쿼리를 보지 않는다
- 근거: 쿼리에 남의 id를 실어도 `findMyLatest`가 그 값으로 불리지 않음을 단언. 계약 테스트가 컨트롤러 소스에 `@Query('userId'|'memberId')`가 없고 `@CurrentMember()`가 있는지 정적으로 본다.

### AC 3 — 남의 동의서 id로 PDF를 요청하면 막힌다 (#8 AC2 성립)

✅ 충족

- 테스트: `should hand the token subject as requesterId even when the query carries another member's userId`, `should answer 403 when the agreement belongs to another member`, `should send no pdf bytes when the agreement belongs to another member`
- 구현: `one(@Param('id') id, @CurrentMember() userId, …)` → `getMyAgreementPdf({ agreementId, requesterId: userId })`. 소유권 대조 자체는 이 이슈가 건드리지 않은 서비스가 그대로 한다
- 근거: 쿼리에 남의 id를 실어도 `getMyAgreementPdf`가 **토큰 주체**로 불림을 단언 — 이슈가 지적한 "대조값의 출처" 결함이 실제로 닫혔다. 403 테스트는 상태 코드뿐 아니라 **PDF 바이트가 전송되지 않았음**도 따로 단언한다.

### AC 4 — 가입 중인 사용자가 서명하면 그대로 동작한다

✅ 충족

- 테스트: `should still sign during signup when the request carries no cookie`, `should stay guardless so the signup flow is not blocked`
- 구현: `sign()`에 `@UseGuards`가 없고 `readUserId(body)`를 그대로 쓴다
- 근거: **가드를 붙이지 않은 판단이 편의를 위한 우회인지 직접 확인했다.** `signup.controller.ts`는 `SignedUp` 본문만 돌려주고 `@Res()`도 `res.cookie(...)`도 없다. 저장소 전체에서 쿠키를 내려주는 곳은 `login.controller.ts`·`member.guard.ts`(갱신)·`admin.guard.ts`·`notification.controller.ts`뿐이고 가입 경로에는 없다. `spec-fixed.md` §2.2도 "5 동의서 서명 → 6 Agreement 생성 후 가입 완료" 순서로 서명이 가입 완료 **이전**임을 명시한다. `signup/agreement/page.tsx`는 `git diff main...HEAD`에서 무변경이다 — 문서와 코드 양쪽이 판단을 뒷받침한다.

### AC 5 — `GET /agreements/template`은 로그인 없이 열린다

✅ 충족

- 테스트: `should stay guardless so the document is readable before signup`, `should still answer when the request carries no cookie`
- 구현: `template()`에 `@UseGuards`가 없다
- 근거: 두 테스트 모두 `assertReadRoutesAreGuarded()`로 가드 지도 전체를 먼저 확정한 뒤 `template`이 거기 없음을 단언한다.

### AC 6 — 웹 화면에서 `userId`를 보내는 코드가 사라진다

✅ 충족

- 테스트: `should request the summary without a userId query`, `should link to the signed pdf without a userId query`, `동의서 조회 요청 — should leave no code…`
- 구현: `page.tsx`에서 `SIGNED_UP_USER_ID_KEY`·`useSyncExternalStore`·`sessionStorage` 읽기가 모두 사라지고 쿼리 없는 `fetch`와 쿼리 없는 `href`가 됐다
- 근거: `fetch`가 쿼리 없이 정확히 그 주소로 불린 것과 `href`에 쿼리가 없음을 단언. 계약 테스트는 이 화면 하나가 아니라 `apps/web` 소스 전체를 훑는다.

**가짜 테스트 점검.** `guardsOf()`는 실제 Nest 메타데이터(`__guards__`)를 읽는다. "가드가 없다"만 보는 단언은 변경 전에도 통과하므로, `memberGuardedRoutes()`가 **정확히 `['mine','one']`**임을 매번 재확정하는 방식으로 막아뒀다 — 지도 하나가 "붙지 말아야 할 곳에 붙는" 회귀와 "붙어야 할 곳에서 빠지는" 회귀를 함께 잡는다. 인자 없는 `rejects.toThrow()`, `await` 누락, 단언 없는 테스트는 세 파일 어디에도 없다.

```
AC 6개 중 — ✅ 6 / ⚠️ 0 / ❌ 0
```

### 구현자 이견

없다.

---

## 리팩토링

`/tdd-refactor 72` (2026-09-19). **한 가지를 고쳤다.**

| 대상                                     | 기준        | 전후                                                                                                                                            |
| ---------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/app/my/agreement/page.tsx` | 중복·복잡도 | 같은 조건을 `error !== null`과 `error === null`로 **두 번** 쓰고 있었다. 삼항 사슬 하나로 합쳐 한 곳에서만 판정한다. 렌더 결과는 세 갈래 그대로 |

조건을 두 곳에 반대로 적으면 한쪽만 고칠 때 **둘 다 뜨거나 둘 다 안 뜨는 상태**가 생긴다. 이번 이슈가 만든 복잡도라 이번에 정리한다. 고친 뒤 전체 테스트 1218개 통과를 확인했다.

**손대지 않은 것**

| 대상                                                                   | 이유                                                                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `agreement.controller.ts`의 `readUserId`                               | 서명 경로다. 이 이슈가 "그대로 둔다"고 판단한 자리라 구조를 건드리면 판단과 어긋난다                                   |
| `parseCookies` 네 벌                                                   | #69·#71이 이미 보류한 항목이고 이 이슈는 그 함수를 건드리지 않았다                                                     |
| `agreement.route.test.ts`의 헬퍼가 `withdrawal.route.test.ts`와 겹친다 | 테스트 파일은 리팩토링 대상이 아니다(안전망을 움직이는 일이다). 합치려면 테스트 전용 공용 모듈을 새로 만드는 일이 된다 |

---

## 보안 점검

`/security-review 72` (2026-09-19). 타입 오류 0, 린트 오류 0, 전체 테스트 통과 상태에서 수행했다.

### 🔴 즉시 수정 필요

없다. 이 이슈의 변경에서 나온 🔴이 없다.

### 🟡 권장 수정 (이 이슈 범위 밖)

| 항목                                                                 | 판단                                                                                                                                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /agreements`가 몸체의 `userId`를 그대로 믿는다                 | **이 이슈가 의도적으로 남긴 자리다.** 가입 5단계에 세션이 없어 가드를 붙일 수 없고, 묶으려면 자동 로그인이나 1회용 서명 토큰 중 하나를 **새로 정해야 한다** — ADR이 먼저다. 별도 이슈로 낸다 |
| `user-address.controller.ts`가 경로의 `userId`를 믿는다              | 같은 뿌리(가입 흐름에 세션이 없다)의 결함이다. 위 ADR이 정해지면 함께 풀린다. 이미 FIXME와 보안 예외 대장에 기록돼 있다                                                                      |
| `apps/web/src/app/signup/address/kakao-postcode.ts:17` 린트 경고 1건 | 쓰이지 않는 `eslint-disable` 지시자다. #71이 같은 것을 보고했고 이 이슈가 만든 것이 아니라 손대지 않았다                                                                                     |

### ⚪ 무시 가능

`pnpm audit` 14건(high 10 · moderate 3 · low 1)은 전부 `docs/result/security-exceptions.md`에 판정이 있는 `deepmerge-ts`·`fast-uri`·`js-yaml`·`multer`·`mysql2`·`qs`다. 재검토일(2026-11-30 · 2026-12-05) 전이고, 이번 변경이 의존성을 건드리지 않았다 — 건수와 패키지 구성이 #71 때와 같다.

### 이 이슈의 변경을 직접 본 것

| 확인                  | 결과                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 비밀값 노출           | 없음. 이번 diff에 하드코딩된 키·토큰·비밀번호가 없다                                                                               |
| `NEXT_PUBLIC_` 오용   | 없음. 환경변수를 건드리지 않는다                                                                                                   |
| 개인정보 로깅         | 없음. `console.log` 추가 없음                                                                                                      |
| 쿠키 옵션             | 이번 이슈가 쿠키를 직접 다루지 않는다. 갱신 쿠키는 #69의 `MemberGuard`가 그대로 내려주고, 테스트가 옵션까지 단언한다               |
| 에러 응답의 내부 정보 | 401·403·404 응답 모두 `errorCode`와 안내 문구뿐이다. 남의 것인지 없는 것인지를 가르는 방식은 서비스가 이미 하던 그대로다           |
| 입력 검증             | 컨트롤러가 여전히 zod로 `parse`한다. 조회 두 라우트는 검증할 입력이 **사라졌다** — 받는 것이 가드가 얹은 회원 id와 경로의 id뿐이다 |
| 권한 상승 경로        | **이 이슈가 닫은 것이 그것이다.** id만 알면 남의 서명 문서를 받을 수 있던 경로가 가드 뒤로 들어갔다                                |
