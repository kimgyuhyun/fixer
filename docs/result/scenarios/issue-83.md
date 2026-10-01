# 이슈 #83 — 로그인 15분 뒤 풀린 것처럼 보이고, 로그인 화면이 로그인 상태를 모른다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/83
> PRD: `docs/result/prd/auth-member.md`
> 담당: B · 선행: 없음 (#5·#69 머지됨)
> 상태: 시그니처 확정 / 시나리오 도출 완료 (2026-10-01)

---

## 시그니처

새 함수는 없다. 이미 있는 셋의 **동작 계약**을 바꾼다.

### 관련 결정

- **ADR-AUTH-1 (Refresh 토큰을 로그인 세션당 한 행으로 둔다)** — Refresh는 14일 동안 회전하지 않는다.
  `LoginService.authenticate`는 Access가 만료돼도 Refresh가 살아 있으면 Access를 다시 발급한다.
- **#69 `MemberGuard`·`/api/auth/me`** — Refresh 쿠키만 있어도 인증하고, 갱신된 Access 쿠키를
  `setAuthCookie`로 심는다. 화면 접근을 막는 미들웨어도 이 판단을 따른다.
- **#5 미들웨어 주석의 결정("Refresh만 남아도 막는다")을 뒤집는다.** PRD·ADR에 없고 주석에만 있던 결정이며,
  #69와 어긋난다. 미들웨어(Next가 페이지 응답 전에 서버에서 먼저 돌리는 함수)는 쿠키가 있는지만 보고
  서명은 검증하지 않으므로, Access 쿠키가 있다는 것도 Refresh 쿠키가 있다는 것보다 강한 근거가 아니다.

### `apps/web/src/middleware.ts` — 시그니처 그대로

```typescript
export const PROTECTED_PATHS = ['/my', '/admin']; // 변경 없음
export function middleware(request: NextRequest): NextResponse;
```

| 쿠키 상태           | 지금            | 바뀐 뒤             |
| ------------------- | --------------- | ------------------- |
| Access ○            | 통과 + no-store | 그대로              |
| Access ✕, Refresh ○ | 307 → `/login`  | **통과 + no-store** |
| 둘 다 ✕             | 307 → `/login`  | 그대로              |

### `apps/web/src/app/my/page.tsx` — `/api/auth/me` 응답 처리

| 응답                                                 | 동작                                                      |
| ---------------------------------------------------- | --------------------------------------------------------- |
| 200                                                  | 그대로                                                    |
| **401** (`AUTH_UNAUTHENTICATED` — 폐기된 Refresh 등) | **`router.replace('/login')`**. 오류 문구를 띄우지 않는다 |
| 그 밖 (403 `AUTH_ACCOUNT_DEACTIVATED`, 500 등)       | 지금처럼 서버 문구 + "로그인하러 가기" 링크               |

`push`가 아니라 `replace`다. 뒤로 가기로 401 받은 마이페이지에 다시 돌아오지 않는다.

### `apps/web/src/app/login/page.tsx` — 진입 시 로그인 상태 확인

| 상태                        | 화면                                                 |
| --------------------------- | ---------------------------------------------------- |
| `/api/auth/me` 묻는 중      | 입력 칸 없이 "로그인 상태를 확인하는 중…"            |
| 200                         | **`router.replace('/my')`**. 입력 칸을 띄우지 않는다 |
| 401·403·그 밖·네트워크 실패 | 지금의 로그인 폼                                     |
| 로그인 성공                 | `router.push('/my')` → **`router.replace('/my')`**   |

### 에러 케이스

새 에러 코드는 없다.

| 상황                                    | 에러 코드                  | HTTP | 화면 처리              |
| --------------------------------------- | -------------------------- | ---- | ---------------------- |
| 쿠키가 없거나 Refresh가 서버에서 폐기됨 | `AUTH_UNAUTHENTICATED`     | 401  | 마이페이지 → `/login`  |
| 탈퇴한 계정                             | `AUTH_ACCOUNT_DEACTIVATED` | 403  | 마이페이지가 문구 표시 |

### 판단이 갈린 지점

- **"이미 로그인" 판단을 미들웨어가 아니라 화면이 한다.** 쿠키 존재로 `/login`을 막으면, 서버에서 폐기된 Refresh가
  남은 사용자는 로그인 화면에 영영 들어가지 못한다 (이슈 본문).
- **확인하는 동안 폼을 숨긴다.** 폼을 먼저 띄우고 뒤에 이동시키면 "입력 칸 _대신_"(AC5)이 깜빡임으로 깨진다.
  대가는 비로그인 사용자도 `/me` 왕복 한 번을 기다리는 것이다.
- **401만 `/login`으로 보낸다.** 403(탈퇴)까지 보내면 재활성화로 이어질 안내 문구가 사라진다.

### 기존 테스트가 바뀌는 곳

- `middleware.test.ts`의 `should redirect to /login when only the access cookie was cleared but refresh remains`를 **뒤집는다** (이슈 지시).
- `login/page.test.tsx`의 기존 두 테스트는 fetch가 모든 주소에 같은 응답을 준다. 진입 시 `/me`가 200이 되어
  마이페이지로 가 버리므로, 주소별로 답하는 mock으로 바꾸고(`/me` → 401) 성공 테스트의 기대를 `push` → `replace`로 고친다.

### 이 이슈에서 만들지 않는 것

- 쿠키·토큰 수명 변경 — 15분·14일은 spec §2.5 그대로
- Refresh 회전 — ADR-AUTH-1 그대로
- `/admin` 화면의 401 처리 — 범위(4파일) 밖. 미들웨어 통과까지만 다룬다
- `middleware.ts` → `proxy.ts` 이름 변경 — Next 16에서 `middleware` 파일 규칙이 deprecated됐지만 이 이슈와 무관하다

---

## 테스트 시나리오

### 정상

- [ ] [정상] `middleware` — should let /my through when only the refresh cookie remains
- [ ] [정상] `middleware` — should let /admin/job-posts through when only the refresh cookie remains
- [ ] [정상] `LoginPage` — should replace the location with /my without showing the inputs when /api/auth/me answers 200
- [ ] [정상] `LoginPage` — should show the login form when /api/auth/me answers 401
- [ ] [정상] `LoginPage` — should send the email and password and replace the location with /my when login succeeds

### 경계

- [ ] [경계] `middleware` — should set Cache-Control no-store when a protected page passes with only the refresh cookie
- [ ] [경계] `LoginPage` — should not show the inputs while /api/auth/me has not answered yet
- [ ] [경계] `MyPage` — should keep the server message and not move when /api/auth/me answers 403

### 예외

- [ ] [예외] `MyPage` — should replace the location with /login without showing an error when /api/auth/me answers 401
- [ ] [예외] `LoginPage` — should show the login form when the /api/auth/me request fails

---

## AC 대조

| AC                                                                           | 커버하는 시나리오                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Refresh 쿠키만 있으면 `/my`·`/admin`을 통과한다                              | `[정상] middleware — /my through when only the refresh cookie remains`<br>`[정상] middleware — /admin/job-posts through when only the refresh cookie remains`                                                                                    |
| 쿠키가 둘 다 없으면 `/login`으로. 보호 페이지의 no-store는 그대로            | 기존 `should redirect to /login when no auth cookie is present`·`/admin/job-posts ... without the access cookie`·`should set Cache-Control no-store on a protected page response`<br>`[경계] middleware — no-store with only the refresh cookie` |
| 로그아웃 뒤 뒤로 가기를 하면 마이페이지가 보이지 않는다 (#5 AC 유지)         | 기존 `MyPage 로그아웃` 3개(logout 호출·`router.refresh`·실패해도 `/login`) + 기존 쿠키 없음 → 307. 로그아웃이 쿠키 둘 다 지우는 것은 API `login.controller` 기존 테스트 몫                                                                       |
| Refresh가 서버에서 폐기됐으면 마이페이지가 401을 받고 로그인 화면으로 보낸다 | `[예외] MyPage — /login without showing an error when /api/auth/me answers 401`<br>`[경계] MyPage — keep the server message when 403`                                                                                                            |
| 로그인한 사용자가 `/login`에 들어가면 입력 칸 대신 마이페이지로 보낸다       | `[정상] LoginPage — replace with /my without showing the inputs when 200`<br>`[경계] LoginPage — no inputs while /me has not answered`<br>`[정상] LoginPage — login form when 401`<br>`[예외] LoginPage — login form when /me fails`             |
| 로그인 성공 후 뒤로 가기를 해도 로그인 입력 화면으로 돌아가지 않는다         | `[정상] LoginPage — replace the location with /my when login succeeds` (+ AC5: 돌아와도 `/me` 200이면 다시 `/my`)                                                                                                                                |

**커버리지:** AC 6개 / 새·변경 시나리오 10개 / 미커버 0개

AC에 없는데 추가한 것: `[경계] MyPage 403` — 401만 보낸다는 경계를 못 박기 위해. `[예외] LoginPage /me 실패` — 확인이 실패하면 로그인할 길이 막히지 않게.
