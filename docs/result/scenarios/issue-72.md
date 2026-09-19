# 이슈 #72 — 동의서 조회·PDF가 쿼리의 userId를 그대로 믿는다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/72
> PRD: `docs/result/prd/agreement.md`
> 담당: A · 선행: #69
> 상태: 시그니처 확정 / 시나리오 도출 완료

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
