# 이슈 #71 — 탈퇴 API가 본문의 userId를 그대로 믿는다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/71
> PRD: `docs/result/prd/auth-member.md`
> 담당: B · 선행: #69
> 상태: 시그니처 확정 / 시나리오 도출 완료

---

## 시그니처

### 관련 ADR

- **ADR-AUTH-1 (Refresh 토큰을 로그인 세션당 한 행으로 둔다)** — 가드가 Access 쿠키만 보지 않고
  `LoginService.authenticate`를 부르는 이유다. Access가 만료돼도 Refresh가 살아 있으면 Access만
  다시 발급한다. 탈퇴 화면에서 15분마다 튕기면 안 된다 (AC3).
- **`spec-fixed.md` §2.6 (탈퇴 = 비활성화)** — 탈퇴는 `deactivatedAt`을 찍는 소프트 삭제이고,
  되돌리려면 재활성화(#10)를 거쳐야 한다. **남이 대신 눌러 줄 수 있으면 안 되는 이유**가 여기 있다.

**이 이슈는 새 결정을 하지 않는다.** #69가 확정한 `MemberGuard`·`@CurrentMember()`를 남은 라우트
하나에 그대로 붙이는 일이다.

### 타입

새 타입이 없다. **없어지는 것만 있다.**

```typescript
// apps/api/src/auth/withdrawal.controller.ts

// 전 — 몸체에서 읽는다
@Post('withdraw')
@HttpCode(HttpStatus.NO_CONTENT)
async withdraw(@Body() body: unknown): Promise<void>;

// 후 — 토큰 주체에서 읽는다
@Post('withdraw')
@HttpCode(HttpStatus.NO_CONTENT)
@UseGuards(MemberGuard)
async withdraw(@CurrentMember() userId: string): Promise<void>;
```

`@Body()` 파라미터를 **통째로 지운다.** 몸체에 남는 필드가 하나도 없기 때문이다. "무시한다"를
주석이 아니라 시그니처로 만든다 — 컨트롤러가 몸체를 아예 받지 않으면 남의 `userId`를 실어 보내도
닿을 곳이 없다 (AC2). #69가 zod 스키마에서 신원 칸을 지워 같은 효과를 낸 것과 같은 수단이다.

`WithdrawalService.withdraw(userId, at)`는 그대로다. 서비스는 지금도 회원 id를 인자로 받고 그 값이
어디서 왔는지 모른다. 이 이슈는 **누가 그 인자를 채우는가**만 바꾼다.

### 에러 케이스

| 상황                                                    | 에러 코드                          | HTTP |
| ------------------------------------------------------- | ---------------------------------- | ---- |
| 쿠키가 없다                                             | `LOGIN_UNAUTHENTICATED`            | 401  |
| Access가 만료됐고 Refresh도 없다·만료됐다·모르는 값이다 | `LOGIN_UNAUTHENTICATED`            | 401  |
| 탈퇴 보류 조건에 걸렸다                                 | `AUTH_WITHDRAWAL_BLOCKED` + 사유들 | 409  |
| 토큰 주체가 DB에 없다                                   | `AUTH_WITHDRAWAL_NOT_FOUND`        | 404  |

새 에러를 만들지 않는다. 401은 `LoginHttpError`가, 409·404는 지금 쓰는 경로가 그대로 낸다.

**`VALIDATION_FAILED`(400)는 사라진다.** 그 400은 "몸체에 `userId`가 없다"를 뜻했는데, 회원이
쿠키에서 오면 그 상황 자체가 없어지고 같은 요청은 **401**이 된다. 400은 "네 입력이 틀렸다",
401은 "네가 누군지 모르겠다"다 — 이제 후자다.

### 컴포넌트 Props

**탈퇴 화면이 아직 없다.** `apps/web/src/app/my/withdraw/`는 존재하지 않고, `apps/web` 어디에도
`/api/auth/withdraw`를 부르는 코드가 없다(직접 확인). 이슈 본문의 범위도 `(있으면)`으로 적혀 있다.

그래서 AC4에는 **지울 화면 코드가 없다.** 대신 지금 실제로 남아 있는 것은 **요청 계약의 반대편**
— 그 몸체에서 회원 id를 꺼내 읽는 컨트롤러다. 보내는 쪽이 없어도 읽는 쪽이 살아 있으면 계약은
그대로고, 화면이 생기는 순간 다시 실어 보내게 된다.

그래서 AC4를 "탈퇴 요청에 회원 id를 실어 나르는 코드가 저장소에 없다"로 본다. 지금은 컨트롤러가
걸리고, 나중에 화면이 회원 id를 담으면 그때는 화면이 걸린다 (아래 `[정상] 탈퇴 요청` 시나리오).

### 이 이슈에서 만들지 않는 것

- **재인증(비밀번호 재확인).** 탈퇴처럼 되돌리기 어려운 동작에 비밀번호를 한 번 더 묻는 서비스가
  많지만, `spec-fixed.md` §2.6에도 이슈 AC에도 그런 요구가 없다. 넣으면 사양에 없는 흐름을
  구현이 만들어내는 일이 된다.
- **탈퇴 화면.** 이 이슈는 "화면에서 회원 id를 보내는 코드가 사라진다"까지다. 화면을 새로 만드는
  것은 범위 밖이다.
- **`agreement.controller.ts`.** #69가 별도 이슈로 남긴 그대로 둔다.
- **`parseCookies` 중복 제거.** #69의 Refactor 단계가 이미 보류한 항목이다. 이 이슈는 그 함수를
  건드리지 않는다.

---

## 테스트 시나리오

### 정상

- [x] [정상] `WithdrawalController.withdraw` — should withdraw the token subject when the body carries someone else's userId
- [x] [정상] `WithdrawalController.withdraw` — should hand the caller and the current time to the service
- [x] [정상] `MemberGuard` on `POST /auth/withdraw` — should renew the access cookie and let the withdrawal continue when the access token expired but the refresh token is alive
- [x] [정상] 탈퇴 요청 — should leave no code that puts a member id into the withdraw request

### 경계

- [x] [경계] `POST /auth/withdraw` — should carry MemberGuard on the route
- [x] [경계] `WithdrawalController.withdraw` — should take the caller as its only parameter so nothing from the wire body reaches the service
- [x] [경계] `MemberGuard` on `POST /auth/withdraw` — should not set a renewed cookie when the access token is still valid
- [x] [경계] `MemberGuard` on `POST /auth/withdraw` — should authenticate from the refresh cookie alone when the access cookie is absent

### 예외

- [x] [예외] `POST /auth/withdraw` — should answer 401 when the request carries no cookie even though the body carries a userId
- [x] [예외] `POST /auth/withdraw` — should answer LOGIN_UNAUTHENTICATED rather than VALIDATION_FAILED when the caller cannot be identified
- [x] [예외] `POST /auth/withdraw` — should not deactivate anyone when the request is unauthenticated
- [x] [예외] `WithdrawalController.withdraw` — should answer 409 with every blocking reason for the token subject
- [x] [예외] `WithdrawalController.withdraw` — should answer 404 when the token subject is not found

---

## AC 대조

| AC                                                       | 커버하는 시나리오                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 쿠키 없는 요청에 `userId`를 담아 보내면 401          | `[예외] should answer 401 when the request carries no cookie even though the body carries a userId`<br>`[예외] …LOGIN_UNAUTHENTICATED rather than VALIDATION_FAILED…`<br>`[예외] …should not deactivate anyone when the request is unauthenticated`<br>`[경계] …should carry MemberGuard on the route`                                            |
| AC2 본문의 남의 `userId`는 무시되고 토큰 주체가 탈퇴한다 | `[정상] …should withdraw the token subject when the body carries someone else's userId`<br>`[정상] …should hand the caller and the current time to the service`<br>`[경계] …should take the caller as its only parameter…`<br>`[예외] …409 with every blocking reason for the token subject`<br>`[예외] …404 when the token subject is not found` |
| AC3 Access 만료 + Refresh 유효면 갱신하고 그대로 진행    | `[정상] MemberGuard … should renew the access cookie and let the withdrawal continue…`<br>`[경계] …should not set a renewed cookie when the access token is still valid`<br>`[경계] …should authenticate from the refresh cookie alone when the access cookie is absent`                                                                          |
| AC4 탈퇴 화면에서 회원 id를 보내는 코드가 사라진다       | `[정상] 탈퇴 요청 — should leave no code that puts a member id into the withdraw request`                                                                                                                                                                                                                                                         |

**AC에 없는데 추가한 시나리오**

| 시나리오                                                              | 왜 넣었나                                                                                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `…should not deactivate anyone when the request is unauthenticated`   | 401을 돌려주면서 **탈퇴는 이미 실행된** 배선을 잡는다. 상태 코드만 보는 테스트는 그 사고를 못 잡고, 탈퇴는 되돌리려면 #10을 거쳐야 한다 |
| `…should answer LOGIN_UNAUTHENTICATED rather than VALIDATION_FAILED…` | 같은 요청의 응답이 400에서 401로 **바뀐다.** 바뀐다는 사실 자체를 못 박지 않으면 나중에 "왜 400이 아니지"로 되돌리는 변경이 들어온다    |
| `…should take the caller as its only parameter…`                      | `@Body()`를 지웠다는 것을 시그니처 수준에서 단언한다. 파라미터가 다시 생기면 몸체가 서비스까지 닿는 길이 열린다                         |
| `[경계] …refresh cookie alone when the access cookie is absent`       | AC3의 이웃 경계다. #69가 같은 이유로 같은 시나리오를 뒀다                                                                               |

**AC당 시나리오 수가 고르지 않은 이유.** AC4는 시나리오가 하나다. 지울 화면이 존재하지 않아
"사라졌다"를 여러 각도에서 볼 방법이 없다 — 요청에 회원 id를 싣는 코드가 저장소에 한 줄도
없다는 사실을 한 번 못 박는 것이 할 수 있는 전부다. 숫자를 맞추려고 같은 단언을 쪼개면
테스트가 아니라 장식이 된다.

**커버리지:** AC 4개 / 시나리오 13개 / 미커버 0개
