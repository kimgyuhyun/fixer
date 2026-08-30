# 이슈 목록 (수직 슬라이스)

> 절차: `docs/process/issues.md` (단계 3)
> 입력: `docs/result/prd/*.md`, `docs/result/spec-fixed.md`
> 담당: **A = 최동훈**, **B = 김규현**
> 상태: **[GATE] 사용자 확인 대기**

---

## 슬라이싱 기준

모든 이슈가 이 질문을 통과했다.

> **"이 이슈만 완료하면 사용자에게 보여줄 수 있는 동작이 있는가?"**

그래서 아래 같은 제목은 하나도 없다.

| 만들지 않은 이슈 (수평)          | 대신 만든 이슈 (수직)               |
| -------------------------------- | ----------------------------------- |
| "User 테이블 Prisma 스키마 작성" | "이메일 인증을 거쳐 가입한다"       |
| "공고 API 엔드포인트 5개"        | "공고를 등록하면 목록에 뜬다"       |
| "포인트 원장 테이블 설계"        | "포인트를 충전하면 잔액이 늘어난다" |

**스키마·API·화면은 각 이슈 안에서 세로로 함께 만든다.** 이슈 하나가 TDD 사이클 한 바퀴다.

### 크기 표기

- **S** — 반나절
- **M** — 하루
- **L** — 하루 초과. 쪼개는 것을 먼저 검토한다 (현재 L은 3개뿐)

### Sprint 0은 이슈가 아니다

모노레포·Docker·CI·공통 컴포넌트는 사용자에게 보여줄 동작이 없어 수직 슬라이스가 성립하지 않는다. 셋업 체크리스트로 따로 처리한다. (`roadmap-and-split.md` Sprint 0)

---

## 진행 순서 요약

```
A: #1 → #2 → #3 → #4 → #5 → #6 → #7 → #8 → #9 ─┐
                                                 ├─→ #32~#38 (환전·회원관리)
B: #10 → #11 → #12 → #13 → #14 → #15 → #16 ─────┤
        → #17 → #23 → #24 → #28 ────────────────┘
공동: #27 (원장 코어) ← 페어
```

**#27(포인트 원장 코어)는 A·B가 페어로 한다.** 원장 유형 7개 중 5개를 B가, 2개를 A가 부른다. 어느 한쪽만 알면 돈 관련 버그가 그 사람에게 전부 몰린다.

---

# A — 회원 · 인증 · 문서 · 환전

## #1 이메일로 인증 코드를 받고 검증한다

**담당** A · **선행** 없음 · **크기** M · **PRD** auth-member

가입 첫 단계. 이메일을 입력하면 6자리 난수가 발송되고, 그 코드를 넣으면 "인증됨" 상태가 된다.

- [ ] Given 가입하지 않은 이메일, When 인증 요청을 보내면, Then 6자리 코드가 발송되고 10분 뒤 만료로 저장된다
- [ ] Given 발송된 코드, When 그 코드를 입력하면, Then 해당 이메일이 인증됨으로 표시된다
- [ ] Given 발송된 지 10분이 지난 코드, When 입력하면, Then `MEMBER_VERIFICATION_CODE_EXPIRED`로 거절된다
- [ ] Given 60초 안에 재발송을 요청하면, Then `MEMBER_RESEND_COOLDOWN`으로 거절되고 남은 시간이 안내된다
- [ ] Given 한 시간에 5회를 채운 이메일, When 재발송하면, Then `MEMBER_RESEND_LIMIT_EXCEEDED`로 거절된다

> 데모: 이메일 입력 → 메일함에서 코드 확인 → 입력 → 통과

---

## #2 인증된 이메일로 가입한다

**담당** A · **선행** #1 · **크기** M · **PRD** auth-member

비밀번호와 이름을 넣어 계정을 만든다. 주소·동의서는 다음 이슈들에서 붙인다.

- [ ] Given 인증된 이메일, When 비밀번호와 이름을 넣어 가입하면, Then `User`가 생성되고 비밀번호는 bcrypt로 저장된다
- [ ] Given 인증되지 않은 이메일, When 가입하면, Then `AUTH_EMAIL_NOT_VERIFIED`로 거절된다
- [ ] Given 이미 가입된 이메일, When 가입하면, Then `MEMBER_EMAIL_ALREADY_EXISTS`로 거절된다
- [ ] Given 8자 미만 비밀번호, When 가입하면, Then 필드 오류가 표시되고 저장되지 않는다

---

## #3 주소를 검색해서 등록한다

**담당** A · **선행** #2 · **크기** M · **PRD** auth-member

카카오 우편번호 팝업으로 주소를 고르고, 좌표까지 저장한다.

- [ ] Given 가입한 회원, When 우편번호 팝업에서 주소를 고르면, Then 도로명·지번·우편번호가 폼에 채워진다
- [ ] Given 선택된 주소, When 저장하면, Then 좌표(lat/lng)와 시/도·시/군/구가 분해되어 저장된다
- [ ] Given 좌표 변환 API가 실패했을 때, When 저장하면, Then 주소는 저장되고 좌표는 비어 있으며 저장 자체는 성공한다

> 좌표는 **거리 검색과 관리자 지역 필터**를 위한 것이다. 없어도 가입은 막지 않는다.

---

## #4 로그인하고 내 정보를 본다

**담당** A · **선행** #2 · **크기** M · **PRD** auth-member

- [ ] Given 가입한 회원, When 올바른 이메일·비밀번호로 로그인하면, Then Access·Refresh 토큰이 httpOnly 쿠키로 내려온다
- [ ] Given 틀린 비밀번호, When 로그인하면, Then `AUTH_INVALID_CREDENTIALS`로 거절되고 어느 쪽이 틀렸는지 알려주지 않는다
- [ ] Given 로그인 상태, When 마이페이지를 열면, Then 내 이메일·이름·주소가 보인다
- [ ] Given Access 토큰이 만료됐고 Refresh는 유효할 때, When 보호 API를 부르면, Then 토큰이 갱신되고 요청이 성공한다

---

## #5 로그아웃하면 뒤로가기로도 보호 페이지를 못 본다

**담당** A · **선행** #4 · **크기** M · **PRD** auth-member

planner.md에서 명시적으로 요구한 동작. **별도 이슈로 뺀 이유는 이것만 따로 검증해야 하기 때문**이다. 로그아웃 구현은 쉽지만 bfcache 때문에 뒤로가기가 자주 새어나간다.

- [ ] Given 로그인 상태, When 로그아웃하면, Then 쿠키가 지워지고 서버의 Refresh 토큰도 삭제된다
- [ ] Given 로그아웃 직후, When 브라우저 뒤로가기로 마이페이지에 가면, Then 로그인 화면으로 리다이렉트된다
- [ ] Given 보호 페이지 응답, When 헤더를 보면, Then `Cache-Control: no-store`가 있다
- [ ] Given 로그아웃된 Refresh 토큰, When 그 토큰으로 갱신을 시도하면, Then 거절된다

> 데모: 로그인 → 마이페이지 → 로그아웃 → 뒤로가기 → 로그인 화면이 뜬다

---

## #6 비밀번호를 재설정한다

**담당** A · **선행** #4 · **크기** M · **PRD** auth-member

마이페이지 변경은 막고 재설정만 연다. (spec-fixed §2.4)

- [ ] Given 가입한 회원, When "비밀번호 찾기"로 재설정 메일을 요청하면, Then 30분 유효·1회용 토큰 링크가 발송된다
- [ ] Given 유효한 토큰, When 새 비밀번호를 설정하면, Then 비밀번호가 바뀌고 **모든 Refresh 토큰이 무효화된다**
- [ ] Given 이미 쓴 토큰, When 다시 쓰면, Then 거절된다
- [ ] Given 마이페이지, When 화면을 보면, Then "비밀번호 변경" 메뉴가 없다

---

## #7 동의서를 읽고 서명한다

**담당** A · **선행** #2 · **크기** L · **PRD** agreement

서명 캔버스 + `pdf-lib` 병합 + 저장까지. **L인 이유**는 좌표 변환·PDF 병합·파일 저장이 한 흐름이라 쪼개면 중간에 보여줄 게 없기 때문이다.

- [ ] Given 가입 중인 회원, When 동의서를 열면, Then 템플릿 PDF 내용이 화면에 보인다
- [ ] Given 서명 캔버스, When 마우스·터치로 그리면, Then 선이 그려지고 "지우기"로 초기화된다
- [ ] Given 서명을 그린 상태, When 동의하면, Then 서명이 병합된 PDF가 저장되고 `sha256`·`agreedAt`·`templateVersion`이 기록된다
- [ ] Given 서명하지 않은 상태, When 동의를 누르면, Then 막히고 안내가 뜬다
- [ ] Given 저장 완료 후, When 저장소를 보면, Then **원본 서명 PNG는 남아 있지 않다**

> 데모: 서명 그리기 → 제출 → 생성된 PDF에 서명이 박혀 있는 것 확인

---

## #8 내 동의서를 다시 조회한다

**담당** A · **선행** #7 · **크기** S · **PRD** agreement

- [ ] Given 동의서를 제출한 회원, When 마이페이지에서 동의서를 열면, Then 서명이 포함된 PDF가 표시된다
- [ ] Given 다른 회원의 동의서 ID, When 접근하면, Then `FORBIDDEN`으로 막힌다
- [ ] Given 저장된 PDF, When 해시를 다시 계산하면, Then 기록된 `sha256`과 일치한다

---

## #9 탈퇴한다 (보류 조건 판정)

**담당** A · **선행** #4, #27 · **크기** M · **PRD** auth-member

- [ ] Given 잔액 0·진행 중 계약 없음, When 탈퇴하면, Then `deactivatedAt`이 찍히고 Refresh 토큰이 모두 삭제된다
- [ ] Given 비활성화된 계정, When 로그인하면, Then `AUTH_ACCOUNT_DEACTIVATED`로 막힌다
- [ ] Given 포인트 잔액이 남은 회원, When 탈퇴하면, Then 막히고 "남은 포인트를 환전한 뒤" 안내가 뜬다
- [ ] Given `ACCEPTED` 상태 신청이 있는 회원, When 탈퇴하면, Then 막히고 "진행 중인 일거리" 안내가 뜬다
- [ ] Given `OPEN` 공고를 가진 회원, When 탈퇴하면, Then 막히고 "등록한 공고를 마감한 뒤" 안내가 뜬다

---

## #10 비활성화 계정을 재활성화한다

**담당** A · **선행** #9 · **크기** S · **PRD** auth-member

- [ ] Given 비활성화된 계정의 이메일, When 가입을 시도하면, Then 새 계정을 만들지 않고 "재활성화하시겠습니까?"가 뜬다
- [ ] Given 재활성화 동의, When 이메일 인증을 마치면, Then `deactivatedAt`이 지워지고 로그인이 된다
- [ ] Given 재활성화된 계정, When 평점·경고 이력을 보면, Then **탈퇴 전 이력이 그대로 남아 있다**

> 이 마지막 AC가 이 이슈의 존재 이유다. 경고 4건 쌓인 사람의 탈퇴·재가입 세탁을 막는다.

---

# B — 공고 · 매칭 · 규칙 · 결제

## #11 카테고리를 고르면 작성 안내가 뜬다

**담당** B · **선행** 없음 · **크기** S · **PRD** job-post

- [ ] Given seed된 카테고리, When 공고 작성 화면을 열면, Then 활성 카테고리가 정렬순으로 보인다
- [ ] Given 카테고리를 고르면, Then 그 카테고리의 `placeholderText`가 상세 내용 입력란에 뜬다
- [ ] Given `isActive=false` 카테고리, When 목록을 보면, Then 보이지 않는다

---

## #12 공고를 등록하면 목록에 뜬다

**담당** B · **선행** #11, #28 · **크기** L · **PRD** job-post

이 프로젝트의 첫 번째 완전한 세로 흐름. **L인 이유**는 등록 폼·검증·포인트 잠금·목록 표시가 한 동작이기 때문이다.

- [ ] Given 로그인한 구인자와 충분한 잔액, When 필수항목을 채워 등록하면, Then 공고가 `OPEN`으로 저장되고 `version`은 1이다
- [ ] Given 등록 성공, When 잔액을 보면, Then `인원 × 보상금`만큼 `HOLD`로 잠겨 있다
- [ ] Given 잔액이 부족한 구인자, When 등록하면, Then `POINT_INSUFFICIENT_BALANCE`로 막히고 부족 금액이 안내된다
- [ ] Given 필수항목이 빈 폼, When 등록하면, Then 필드별 오류가 뜨고 저장되지 않는다
- [ ] Given 등록된 공고, When 목록을 열면, Then 그 공고가 보인다
- [ ] Given 근무 주소를 비웠을 때, Then 가입 주소가 기본값으로 채워져 있다

> 데모: 포인트 충전 → 공고 등록 → 목록에 뜨고 잔액이 줄어든 것 확인

---

## #13 공고 목록을 검색·필터로 좁혀 본다

**담당** B · **선행** #12 · **크기** L · **PRD** job-post

`FilterableList` 공통 컴포넌트를 여기서 만든다. **관리자 목록 6개가 전부 이걸 재사용**하므로 여기서 제대로 만든다.

- [ ] Given 여러 공고, When 카테고리로 거르면, Then 그 카테고리 공고만 보인다
- [ ] Given 여러 공고, When 시/도·시/군/구로 거르면, Then 해당 지역 공고만 보인다
- [ ] Given 필터 적용 상태, When 새로고침하면, Then 필터가 유지된다 (쿼리스트링)
- [ ] Given 필터 여러 개, When 칩 하나를 지우면, Then 그 조건만 풀리고 나머지는 유지된다
- [ ] Given 조건에 맞는 공고가 없을 때, Then 빈 상태 안내가 뜬다
- [ ] Given 21개 공고와 페이지당 20개, When 2페이지로 가면, Then 나머지 1개가 보인다
- [ ] Given 21개 공고, When 목록을 보면, Then **"총 21건"** 이 표시된다 *(ADR-JOB-5 오프셋 페이징)*
- [ ] Given 필터를 두 번 바꾼 뒤, When 뒤로가기를 누르면, Then 이전 필터 상태로 돌아간다 *(ADR-JOB-4 URL 단일 진실)*

---

## #14 공고 상세를 본다

**담당** B · **선행** #12 · **크기** S · **PRD** job-post

- [ ] Given 목록의 공고, When 클릭하면, Then 상세 화면에 카테고리·주소·시간·보상·인원·내용이 보인다
- [ ] Given 상세 화면, When 확정 인원을 보면, Then "3 / 6" 형태로 표시된다
- [ ] Given 삭제된(soft delete) 공고 ID, When 접근하면, Then `JOB_POST_NOT_FOUND`가 뜬다

---

## #15 필수항목을 고치면 version이 오른다

**담당** B · **선행** #12 · **크기** M · **PRD** job-post

`ADR-JOB-1` **확정: 전체 스냅샷 테이블**(`JobPostVersion`). 착수 가능.

- [ ] Given `version=1` 공고, When 보상금을 고치면, Then `version=2`가 되고 이력에 이전 값이 남는다
- [ ] Given `version=3`인 공고, When v2를 조회하면, Then **그 시점의 필수항목 6개 전문**이 나온다 *(ADR-JOB-1 계약 복원)*
- [ ] Given `version=1` 공고, When 제목만 고치면, Then **`version`은 1 그대로다**
- [ ] Given 필수항목 6개 각각, When 하나씩 고치면, Then 매번 `version`이 오른다
- [ ] Given 필수항목을 고쳤다가 원래 값으로 되돌리면, Then 값이 같으므로 `version`이 오르지 않는다
- [ ] Given `CLOSED` 공고, When 수정하면, Then `JOB_POST_NOT_EDITABLE`로 막힌다

> 데모: 제목 고치기(version 그대로) → 시급 고치기(version 오름)를 나란히 보여준다

---

## #16 공고를 취소한다

**담당** B · **선행** #12, #28 · **크기** M · **PRD** job-post

- [ ] Given 신청자가 없는 `OPEN` 공고, When 취소하면, Then `CANCELLED`가 되고 잠긴 포인트가 전액 `RELEASE`된다
- [ ] Given 수락자가 있는 공고, When 취소하면, Then 취소는 되지만 구인자에게 `Penalty`가 1건 쌓인다
- [ ] Given 취소된 공고, When 목록을 보면, Then 보이지 않지만 DB에는 남아 있다
- [ ] Given 남의 공고, When 취소하면, Then `FORBIDDEN`으로 막힌다

---

## #17 공고에 지원하고 철회한다

**담당** B · **선행** #12 · **크기** M · **PRD** application

- [ ] Given 로그인한 구직자, When `OPEN` 공고에 지원하면, Then `APPLIED` 신청이 생기고 `appliedVersion`에 현재 버전이 저장된다
- [ ] Given 이미 지원한 공고, When 또 지원하면, Then `APPLICATION_ALREADY_APPLIED`로 막힌다
- [ ] Given 본인 공고, When 지원하면, Then 막힌다
- [ ] Given `APPLIED` 상태, When 철회하면, Then `WITHDRAWN`이 되고 **경고가 쌓이지 않는다**
- [ ] Given `ACCEPTED` 상태, When 철회 버튼을 찾으면, Then 없다 (취소는 #20에서 다룬다)

---

## #18 구인자가 지원자를 수락한다 (정원 제어)

**담당** B · **선행** #17 · **크기** M · **PRD** application

- [ ] Given 지원자 목록, When 한 명을 수락하면, Then `ACCEPTED`가 되고 `acceptedAt`이 찍히며 확정 인원이 1 늘어난다
- [ ] Given 지원자 목록, When 평점을 보면, Then 구직자 평점이 표시된다 (표본 3건 미만이면 "신규")
- [ ] Given 정원이 찬 공고, When 더 수락하면, Then `APPLICATION_HEADCOUNT_FULL`로 막힌다
- [ ] Given 정원이 1자리 남은 공고, When **수락 요청 2개를 동시에** 보내면, Then 정확히 1개만 성공한다
- [ ] Given 이미 수락된 신청, When 또 수락하면, Then 확정 인원이 중복으로 늘지 않는다

> 마지막 두 AC가 이 이슈의 핵심이다. 정원이 넘으면 잠긴 포인트보다 지급할 돈이 많아진다.

---

## #19 구인자가 지원자를 거절한다

**담당** B · **선행** #17 · **크기** S · **PRD** application

- [ ] Given `APPLIED` 신청, When 거절하면, Then `REJECTED`가 되고 신청자에게 알림이 간다
- [ ] Given 거절된 신청, When 같은 공고에 다시 지원하면, Then 막힌다
- [ ] Given `ACCEPTED` 신청, When 거절하면, Then 막힌다 (취소 규칙을 따라야 하므로)

---

## #20 수락 2시간 안에는 무상 취소된다

**담당** B · **선행** #18 · **크기** M · **PRD** application

- [ ] Given 수락된 지 1시간 지난 신청, When 구직자가 취소하면, Then `CANCELLED_FREE`가 되고 **경고가 쌓이지 않는다**
- [ ] Given 수락된 지 3시간 지난 신청, When 구직자가 취소하면, Then `CANCELLED_PENALTY`가 되고 `Penalty`가 1건 쌓인다
- [ ] Given 수락된 지 1시간 지난 신청, When 구인자가 취소하면, Then 마찬가지로 무상 취소된다
- [ ] Given 취소된 신청, When 확정 인원을 보면, Then 1 줄어 있다
- [ ] Given 취소로 자리가 빈 공고, When 다른 지원자를 수락하면, Then 성공한다

---

## #21 version이 오르면 신청이 재동의 대기가 된다

**담당** B · **선행** #15, #17 · **크기** M · **PRD** application

- [ ] Given `appliedVersion=1`인 신청들, When 공고가 `version=2`가 되면, Then 그 신청들이 `PENDING_REACCEPT`로 바뀐다
- [ ] Given `ACCEPTED`였던 신청이 `PENDING_REACCEPT`가 되면, Then 확정 인원에서 빠진다
- [ ] Given 부가항목만 수정했을 때, Then 신청 상태는 그대로다
- [ ] Given 재동의 대기 신청, When 신청자가 알림을 보면, Then 무엇이 바뀌었는지 알 수 있다
- [ ] Given 재동의 대기 상태, When 신청 목록을 보면, Then 신청이 **삭제되지 않고** 남아 있다

---

## #22 신청자가 diff를 보고 재동의하거나 거절한다

**담당** B · **선행** #21 · **크기** M · **PRD** application

- [ ] Given 재동의 대기 신청, When 화면을 열면, Then 변경 전/후 값이 나란히 보인다
- [ ] Given diff 화면, When 재동의하면, Then `appliedVersion`이 최신이 되고 **이전 상태로 복귀한다**
- [ ] Given `ACCEPTED`였던 신청, When 재동의하면, Then 다시 `ACCEPTED`가 되고 확정 인원이 복구된다
- [ ] Given diff 화면, When 거절하면, Then `CANCELLED_BY_VERSION_CHANGE`가 되고 **경고가 쌓이지 않는다**

> 마지막 AC가 중요하다. 조건을 바꾼 건 구인자이므로 신청자 귀책이 아니다.

---

## #23 업무 완료를 확인하면 포인트가 지급된다

**담당** B · **선행** #18, #27 · **크기** M · **PRD** application, point-money

- [ ] Given 확정 인원 3명·정원 6명인 공고, When 구인자가 완료 확인하면, Then 3명분은 `PAYOUT`, 3명분은 `RELEASE`된다
- [ ] Given 완료 확인 후, When 구직자 잔액을 보면, Then 보상금만큼 늘어 있다
- [ ] Given 완료 확인 후, When 공고 상태를 보면, Then `COMPLETED`다
- [ ] Given 이미 완료된 공고, When 또 완료 확인하면, Then 지급이 두 번 되지 않는다
- [ ] Given 완료 확인 전, When 구직자가 잔액을 보면, Then 아직 늘지 않았다

---

## #24 노쇼를 기록한다

**담당** B · **선행** #18 · **크기** S · **PRD** application, penalty-rating

- [ ] Given `ACCEPTED` 신청, When 구인자가 노쇼로 표시하면, Then `NO_SHOW`가 되고 `Penalty`가 1건 쌓인다
- [ ] Given 노쇼 처리된 인원, When 완료 확인하면, Then 그 인원분은 지급되지 않고 `RELEASE`된다
- [ ] Given 근무 시작 전, When 노쇼로 표시하면, Then 막힌다

---

## #25 경고가 5건 쌓이면 제재된다

**담당** B · **선행** #20, #24 · **크기** M · **PRD** penalty-rating

- [ ] Given 최근 180일 내 경고 4건, When 5번째 경고가 쌓이면, Then `Suspension`이 생기고 종료일은 5일 뒤다
- [ ] Given 190일 전 경고 3건 + 최근 2건, When 판정하면, Then 롤링 윈도우 밖이므로 제재되지 않는다
- [ ] Given 제재 중인 회원, When 공고를 등록하면, Then `PENALTY_SUSPENDED`로 막힌다
- [ ] Given 제재 중인 회원, When 알바에 신청하면, Then 막힌다
- [ ] Given 제재 중인 회원, When **진행 중인 계약을 이행하거나 환전하면**, Then 정상 동작한다
- [ ] Given 제재 종료일이 지난 회원, When 공고를 등록하면, Then 성공한다

---

## #26 거래 후 별점을 남긴다

**담당** B · **선행** #23 · **크기** M · **PRD** penalty-rating

- [ ] Given `COMPLETED` 거래, When 구인자가 구직자에게 별점을 주면, Then 저장되고 구직자의 `ratingAsWorker`에 반영된다
- [ ] Given 같은 거래, When 또 별점을 주면, Then 막힌다
- [ ] Given `COMPLETED`가 아닌 거래, When 별점을 주면, Then 막힌다
- [ ] Given 별점 2건만 받은 회원, When 평점을 보면, Then 평균 대신 **"신규"** 로 표시된다
- [ ] Given 별점 3건을 받은 회원, When 평점을 보면, Then 평균이 표시된다
- [ ] Given 구인자로도 구직자로도 별점을 받은 회원, When 평점을 보면, Then **두 평균이 따로** 보인다

---

# 공동 — 포인트 원장

## #27 포인트 원장 코어 (페어)

**담당** **A + B 페어** · **선행** 없음 · **크기** L · **PRD** point-money

> **이 이슈만 페어로 한다.** 원장 유형 7개 중 5개를 B가, 2개를 A가 부른다.
> 한 사람만 알면 이후 모든 돈 관련 버그가 그 사람에게 몰린다.

원장 쓰기·잔액 계산·멱등성만 만든다. 결제창이나 화면은 없다.

- [ ] Given 빈 원장, When `CHARGE 10000`을 기록하면, Then 잔액은 10000이다
- [ ] Given 잔액 10000, When `HOLD 12000`을 시도하면, Then `POINT_INSUFFICIENT_BALANCE`로 거절되고 원장에 아무것도 안 남는다
- [ ] Given 잔액 10000, When `HOLD 6000` 후 `RELEASE 6000`하면, Then 잔액은 다시 10000이다
- [ ] Given 같은 `idempotencyKey`, When 원장을 두 번 기록하면, Then **한 건만 남는다**
- [ ] Given 같은 사용자에게 **동시에** `CHARGE`와 `HOLD`가 들어오면, Then 잔액이 음수가 되지 않는다
- [ ] Given 여러 원장 기록 후, When 캐시 잔액과 원장 합계를 비교하면, Then 일치한다

> 데모: 이 이슈에는 화면이 없다. **통합 테스트 결과가 데모다.**
> 수직 슬라이스 원칙의 유일한 예외이며, 돈이라 예외를 허용한다.

---

## #28 포인트를 충전한다

**담당** B · **선행** #27 · **크기** L · **PRD** point-money

- [ ] Given 로그인한 회원, When 금액을 골라 결제하면, Then 포트원 결제창이 뜬다
- [ ] Given 결제 완료, When 서버가 검증하면, Then **포트원 API로 금액을 재조회해 대조한다** (클라이언트 응답을 믿지 않는다)
- [ ] Given 금액이 다를 때, When 검증하면, Then `PAYMENT_AMOUNT_MISMATCH`로 거절되고 충전되지 않는다
- [ ] Given 웹훅이 **두 번 도착**했을 때, Then `CHARGE`는 한 건만 기록된다
- [ ] Given 충전 완료, When 포인트 내역을 보면, Then 충전 건이 보인다

---

## #29 결제를 취소하면 포인트가 회수된다

**담당** B · **선행** #28 · **크기** M · **PRD** point-money

- [ ] Given 충전 후 사용하지 않은 회원, When 결제를 취소하면, Then `REFUND`가 기록되고 잔액이 줄어든다
- [ ] Given 이미 포인트를 써서 잔액이 부족할 때, When 취소하면, Then 막히고 사유가 안내된다
- [ ] Given 같은 결제 건, When 취소를 두 번 하면, Then 한 번만 반영된다

---

## #30 계좌를 등록하고 검증받는다

**담당** A · **선행** #4 · **크기** M · **PRD** point-money

- [ ] Given 로그인한 회원, When 은행·계좌번호·예금주를 등록하면, Then 계좌번호가 암호화되어 저장된다
- [ ] Given 형식이 올바른 계좌, When 검증을 돌리면(stub 모드), Then 즉시 `VERIFIED`가 되고 알림이 간다
- [ ] Given 자릿수가 틀린 계좌번호, When 등록하면, Then `REJECTED`가 되고 사유가 안내된다
- [ ] Given 등록된 계좌, When 화면에서 보면, Then 계좌번호가 마스킹되어 있다

---

## #31 환전을 요청한다

**담당** A · **선행** #23, #30 · **크기** M · **PRD** point-money

- [ ] Given 지급받은 지 7일 지난 포인트 20000, When 10000을 환전 요청하면, Then `REQUESTED`가 생기고 `EXCHANGE_REQUEST`로 잔액이 줄어든다
- [ ] Given 4000원 요청, When 제출하면, Then `EXCHANGE_BELOW_MIN_AMOUNT`로 막힌다
- [ ] Given 10005원 요청, When 제출하면, Then `EXCHANGE_INVALID_UNIT`으로 막힌다
- [ ] Given 지급된 지 3일된 포인트, When 환전 요청하면, Then `EXCHANGE_NOT_MATURED`로 막힌다
- [ ] Given 계좌가 `VERIFIED`가 아닐 때, When 요청하면, Then `EXCHANGE_ACCOUNT_NOT_VERIFIED`로 막힌다

---

# 관리자

## #32 관리자가 회원을 검색해 상세를 본다

**담당** A · **선행** #13, #26 · **크기** L · **PRD** auth-member

`FilterableList`(#13)를 재사용한다.

- [ ] Given 관리자, When 회원 목록을 열면, Then 이름·이메일·가입일·평점·경고 수·상태가 보인다
- [ ] Given 회원 목록, When 이름으로 검색하면, Then 부분 일치하는 회원만 보인다
- [ ] Given 회원 목록, When 시/도로 거르면, Then 그 지역 회원만 보인다
- [ ] Given 비활성화된 회원, When 목록을 보면, Then **사라지지 않고 "비활성화" 배지가 붙어** 보인다
- [ ] Given 회원 행, When 클릭하면, Then 상세에 평점·리뷰 목록·거래 이력·포인트 내역·제재 이력이 보인다
- [ ] Given 일반 회원, When 관리자 URL로 접근하면, Then `FORBIDDEN`으로 막힌다

---

## #33 관리자가 제재를 조기 해제한다

**담당** B · **선행** #25 · **크기** M · **PRD** penalty-rating

- [ ] Given 관리자, When 블랙리스트를 열면, Then 현재 제재 중인 회원만 보인다
- [ ] Given 제재 건, When 사유 없이 해제하면, Then 막힌다 (사유 필수)
- [ ] Given 사유를 적고 해제하면, Then `releasedAt`·`releasedBy`가 기록되고 회원에게 알림이 간다
- [ ] Given 해제된 회원, When 공고를 등록하면, Then 성공한다
- [ ] Given 해제된 회원, When 원본 경고 이력을 보면, Then **`Penalty`는 그대로 남아 있다**

---

## #34 관리자가 환전을 승인하고 완료 처리한다

**담당** A · **선행** #31 · **크기** M · **PRD** point-money

- [ ] Given 관리자, When 환전 요청 목록을 열면, Then 신청자·금액·계좌(마스킹)·검증 상태가 보인다
- [ ] Given `REQUESTED` 건, When 승인하면, Then `APPROVED`가 되고 감사 로그가 남는다
- [ ] Given `APPROVED` 건, When "이체 완료"를 누르면, Then `COMPLETED`가 된다
- [ ] Given 계좌번호 전체 열람 버튼, When 누르면, Then 전체가 보이고 **열람 사실이 감사 로그에 남는다**
- [ ] Given 요청 건, When 사유를 적고 반려하면, Then `EXCHANGE_REVERT`로 포인트가 원복되고 알림이 간다

---

## #35 관리자가 공고를 검색해 강제 취소한다

**담당** B · **선행** #13, #16 · **크기** M · **PRD** job-post

- [ ] Given 관리자, When 공고 목록을 열면, Then 제목·구인자·카테고리·상태·등록일이 보인다
- [ ] Given 공고 목록, When 구인자 이름으로 검색하면, Then 해당 공고만 보인다
- [ ] Given 공고, When 사유를 적고 강제 취소하면, Then `CANCELLED`가 되고 잠긴 포인트가 전액 `RELEASE`된다
- [ ] Given 강제 취소, When 감사 로그를 보면, Then 누가·언제·왜가 남아 있다

---

# 알림 · 스케줄러

## #36 인앱 알림을 받고 읽는다

**담당** A · **선행** #4 · **크기** M · **PRD** notification

- [ ] Given 알림이 발생하면, Then `Notification`이 쌓이고 헤더 벨에 미읽음 수가 표시된다
- [ ] Given 알림 목록, When 알림을 클릭하면, Then 읽음 처리되고 관련 화면으로 이동한다
- [ ] Given 알림이 없을 때, Then 벨에 숫자가 표시되지 않는다

---

## #37 중요 알림은 이메일로도 온다

**담당** A · **선행** #36 · **크기** M · **PRD** notification

- [ ] Given 재동의 요청·수락·거절·모집 미달·제재·계좌 검증·환전 중 하나가 발생하면, Then 인앱과 이메일 양쪽으로 나간다
- [ ] Given 이메일 발송 후, When 발송 이력을 보면, Then DB에 기록이 남아 있다
- [ ] Given 이메일 발송이 실패했을 때, Then **도메인 트랜잭션은 롤백되지 않고** 실패만 기록된다

> 마지막 AC가 중요하다. 메일이 안 나갔다고 수락이 취소되면 안 된다.

---

## #38 모집 미달 3시간 전 알림이 오고 공고가 자동 마감된다

**담당** B · **선행** #12, #36 · **크기** M · **PRD** notification

- [ ] Given `OPEN`이고 시작 3시간 전이며 인원 미달인 공고, When 잡이 돌면, Then 구인자에게 연장/삭제/유지 알림이 간다
- [ ] Given 알림을 이미 보낸 공고, When 잡이 다시 돌면, Then **두 번 보내지 않는다**
- [ ] Given 시작 시각이 지난 `OPEN` 공고, When 잡이 돌면, Then 인원이 찼으면 `CLOSED`, 미달이면 `EXPIRED`가 된다
- [ ] Given 잡이 **동시에 두 번** 실행되면, Then advisory lock으로 하나만 진행된다
- [ ] Given 구인자가 미응답이면, Then 공고는 그대로 유지된다 (기본값)

---

## #39 개인정보 파기 배치가 돈다

**담당** A · **선행** #9 · **크기** M · **PRD** auth-member

- [ ] Given 비활성화된 지 4개월 지난 계정, When 잡이 돌면, Then 이름·주소·연락처·계좌가 비식별 처리되고 동의서 PDF 파일이 삭제된다
- [ ] Given 파기된 계정, When 그 계정의 과거 공고·신청·원장을 조회하면, Then **기록은 그대로 남아 있다**
- [ ] Given 비활성화된 지 1개월된 계정, When 잡이 돌면, Then 파기되지 않는다
- [ ] Given 파기된 계정의 이메일, When 가입하면, Then 재활성화가 아니라 신규 가입이 된다
- [ ] Given 테스트에서 보관 기간을 1분으로 주입하면, Then 1분 뒤 파기가 동작한다

> 마지막 AC 때문에 `RETENTION_*`을 상수 파일 하나로 모으고 주입 가능하게 만든다.

---

## 통계

| 담당     | 이슈 수 | S     | M      | L     |
| -------- | ------- | ----- | ------ | ----- |
| A        | 15      | 2     | 10     | 3     |
| B        | 18      | 4     | 13     | 1     |
| 공동     | 1       |       |        | 1     |
| **합계** | **34**  | **6** | **23** | **5** |

L 5개는 전부 "쪼개면 중간에 보여줄 게 없어지는" 것들이다: #7(서명), #12(공고 등록), #13(목록·필터), #27(원장), #28(충전), #32(회원 관리).

---

## [GATE]

확인해 주실 것:

1. **수직 슬라이스** — 각 이슈가 "완료하면 보여줄 동작이 있는가"를 통과하는가? (#27 원장만 예외 — 화면이 없고 테스트가 데모다)
2. **AC 구체성** — Given-When-Then이 그대로 테스트로 옮겨질 만큼 구체적인가?
3. **의존성 순서** — 앞 이슈의 결과가 다음 이슈의 입력이 되는가? 역방향이 없는가?
4. **크기** — L 5개를 더 쪼갤 것인가?

확정되면 GitHub Issues로 등록한다.
