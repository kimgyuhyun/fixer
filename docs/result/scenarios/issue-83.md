# 이슈 #83 — 로그인 15분 뒤 풀린 것처럼 보이고, 로그인 화면이 로그인 상태를 모른다

> GitHub: https://github.com/kimgyuhyun/fixer/issues/83
> PRD: `docs/result/prd/auth-member.md`
> 담당: B · 선행: 없음 (#5·#69 머지됨)
> 상태: 시그니처 확정 / 시나리오 승인 / Green 완료 (2026-10-01)

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

- [x] [정상] `middleware` — should let /my through when only the refresh cookie remains
- [x] [정상] `middleware` — should let /admin/job-posts through when only the refresh cookie remains
- [x] [정상] `LoginPage` — should replace the location with /my without showing the inputs when /api/auth/me answers 200
- [x] [정상] `LoginPage` — should show the login form when /api/auth/me answers 401
- [x] [정상] `LoginPage` — should send the email and password and replace the location with /my when login succeeds

### 경계

- [x] [경계] `middleware` — should set Cache-Control no-store when a protected page passes with only the refresh cookie
- [x] [경계] `LoginPage` — should not show the inputs while /api/auth/me has not answered yet
- [x] [경계] `MyPage` — should keep the server message and not move when /api/auth/me answers 403

### 예외

- [x] [예외] `MyPage` — should replace the location with /login without showing an error when /api/auth/me answers 401
- [x] [예외] `LoginPage` — should show the login form when the /api/auth/me request fails

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

---

## AC 검증

`ac-verifier` 에이전트의 판정 요약 (2026-10-01). **AC 6개 중 ✅ 6 / ⚠️ 0 / ❌ 0.**

| AC                                      | 판정 | 근거 요약                                                                                                |
| --------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------- |
| 1. Refresh만 있으면 `/my`·`/admin` 통과 | ✅   | `middleware.ts`가 두 쿠키가 모두 없을 때만 리다이렉트. 갱신은 `/me`·`MemberGuard`의 `setAuthCookie`(#69) |
| 2. 둘 다 없으면 `/login`, no-store 유지 | ✅   | 기존 307 테스트 둘 + no-store 테스트(Access만·Refresh만)                                                 |
| 3. 로그아웃 뒤 뒤로 가기                | ✅   | `logout`이 `clearCookie`를 두 쿠키에 같은 옵션으로 호출 + 화면의 `router.refresh()`·`replace('/login')`  |
| 4. 폐기된 Refresh → 401 → `/login`      | ✅   | `my/page.tsx`가 401만 `replace('/login')`. 403은 문구 유지                                               |
| 5. 로그인 상태로 `/login` → 마이페이지  | ✅   | `checking` 동안 폼 없음, `/me` 200이면 `replace('/my')`                                                  |
| 6. 로그인 성공 후 뒤로 가기             | ✅   | `push` → `replace`. 돌아와도 AC 5가 다시 `/my`로 보낸다                                                  |

**리다이렉트 루프 없음:** 폐기된 Refresh만 남으면 `/my`(미들웨어 통과) → `/me` 401 → `/login`(보호 경로 아님) → `/me` 401 → 폼에서 멈춘다. 두 화면이 같은 `/me` 판정을 쓰므로 서로 다른 답을 받을 수 없다.

**제안됐으나 넣지 않은 것:**

- 로그인 화면 `/me` 403·500 → 폼 — 401과 같은 `!res.ok` 분기다
- `/admin`의 Refresh만 있을 때 no-store — `/my`와 같은 코드 경로다
- 마이페이지가 JSON 아닌 401을 받는 경우 — Nest의 401은 항상 `{ errorCode, message }` JSON이다

### 로컬 브라우저 확인 (구현자)

`pnpm dev` + 로컬 Postgres. 이 확인용으로 만든 계정은 끝나고 지웠다.

| AC  | 확인                                                                                                                                         | 결과 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | curl로 `fixer_refresh`만 실어 `/my`·`/admin/job-posts` → 200. 같은 쿠키로 `/api/auth/me` → 200 + 새 `fixer_access` `Set-Cookie`              | ✅   |
| 2   | 쿠키 없이 `/my` → 307 `location: /login`                                                                                                     | ✅   |
| 3   | 마이페이지에서 로그아웃 → `/login` 폼 → 뒤로 가기 → 마이페이지가 아니라 로그인 폼                                                            | ✅   |
| 4   | DB에서 Refresh 행을 지운 뒤 `/me` → 401. 브라우저에 폐기된 `fixer_refresh`만 두고 `/my` → `/login` 폼에서 멈춘다 (쿠키는 남은 채, 루프 없음) | ✅   |
| 5   | 로그인한 채로 `/login` → 입력 칸 없이 `/my`                                                                                                  | ✅   |
| 6   | `/` → `/login` → 로그인 → `/my` → 뒤로 가기 → `/` (로그인 폼이 아니다)                                                                       | ✅   |

**확인하지 못한 것:** `Cache-Control: no-store`. `next dev`는 공개 페이지·Access 쿠키 경로까지 모든 페이지 응답을 `no-cache, must-revalidate`로 덮어써서 dev에서는 볼 수 없다 (이번 변경과 무관, 단위 테스트로 확인). 운영(https://fixer.kozow.com)에서 사람이 확인해야 한다.

---

## 보안 점검

`/security-review 83` (2026-10-01). 빌드·타입 오류 0, 전체 테스트(shared 70 · web 169 · api 1037) 통과 상태에서 수행했다.

### 🔴 즉시 수정 필요

없음.

### 🟡 권장 수정 (이 이슈 범위 밖)

| 항목                         | 판단                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| 대장에 없는 개발 의존성 권고 | #82 보안 점검과 같은 목록이다. 이 PR은 의존성을 바꾸지 않았다. 대장 정리를 별도 작업으로 권한다 |

### ⚪ 무시 가능

| 항목                             | 이유                                                                                                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm audit` 32건                | lockfile이 main과 같다. 판정은 대장 1~3번·#82 그대로다                                                                                                                                                                  |
| Refresh 쿠키만으로 미들웨어 통과 | 미들웨어는 원래 서명을 검증하지 않아 가짜 Access 쿠키로도 통과했다. 보호 페이지의 데이터는 전부 API(`MemberGuard`·`AdminGuard`)가 검증한 뒤에만 나온다. 폐기된 Refresh로 들어와도 보이는 것은 "불러오는 중…" 화면뿐이다 |
| 화면의 `router.replace`          | 대상이 고정 경로(`/my`, `/login`)뿐이라 오픈 리다이렉트(외부 주소로 보내는 리다이렉트 악용)가 생기지 않는다                                                                                                             |

### 이 이슈의 변경을 직접 본 것

| 확인                | 결과                                                                              |
| ------------------- | --------------------------------------------------------------------------------- |
| 비밀값 노출         | 없음. diff에서 키 패턴·알려진 접두사 grep 0건. `.env`는 git이 무시한다            |
| `NEXT_PUBLIC_` 오용 | 없음. 환경변수를 건드리지 않았다                                                  |
| 개인정보 로깅       | 없음. diff에 `console`·`Logger` 추가 없음                                         |
| 쿠키 옵션           | 바꾸지 않았다. 보호 페이지의 `no-store`는 Refresh만 있는 경로에도 붙는다 (테스트) |
