# 이슈 #8 — 내 동의서를 다시 조회한다

> 선행 #7 (서명) · 도메인 agreement · 크기 S
> 브랜치 `feat/agreement/issue-8` (base: `feat/agreement/issue-7`)

서명한 동의서를 마이페이지에서 다시 본다. **남의 것은 못 본다.**

---

## 시그니처

```ts
// 기존 포트에 추가
export interface AgreementStore {
  create(...): Promise<AgreementRecord>;
  findById(id: string): Promise<AgreementRecord | null>;   // ← 추가
  findLatestByUser(userId: string): Promise<AgreementRecord | null>;  // ← 추가
}

/**
 * 저장된 동의서 PDF를 돌려준다.
 *
 * **요청자와 소유자가 다르면 거절한다.** 동의서에는 이름·서명이 들어 있어
 * 남이 보면 개인정보 유출이다.
 */
getMyAgreementPdf(input: { agreementId: string; requesterId: string }):
  Promise<{ bytes: Buffer; sha256Matches: boolean }>

/** 마이페이지가 "내 동의서가 있는가"를 묻는다 */
findMyLatest(userId: string): Promise<AgreementSummary | null>
```

```
GET /agreements/mine?userId=...       →  200 { id, templateVersion, agreedAt } | 204
GET /agreements/:id?userId=...        →  200 application/pdf
                                      →  403 AGREEMENT_FORBIDDEN (남의 것)
                                      →  404 AGREEMENT_NOT_FOUND
```

---

## 판단이 갈렸던 지점

**해시를 조회할 때마다 다시 계산해 대조한다.**
AC3이 요구하는 것이고, 저장 후 파일이 바뀌었는지를 잡는 유일한 방법이다. 비용은
파일 하나 읽고 sha256 한 번이라 조회 빈도를 생각하면 부담이 아니다. **어긋나면
막지 않고 기록한다** — 사용자에게는 자기 동의서를 보여주는 편이 낫고, 어긋났다는
사실은 운영이 알아야 한다.

**`FORBIDDEN`과 `NOT_FOUND`를 구분한다.**
없는 것과 남의 것을 같은 코드로 주면 "이 ID가 존재하는가"를 알아낼 수 없어 더
안전하다. 하지만 동의서 ID는 cuid라 추측이 사실상 불가능하고, 구분해야 운영이
"권한 문제인가 데이터 문제인가"를 로그에서 가른다.

**`userId`를 쿼리에서 받는다 — #7과 같은 한시적 전제.**
아직 토큰이 없다. #4가 머지되면 토큰에서 읽도록 바꾼다. 지금 구조는 **소유자
비교 자체는 서버가 한다**는 점이 중요하고, 그 비교의 입력만 나중에 바뀐다.

---

## 시나리오

### 내 동의서 조회 (AC1)

- [ ] [정상] `findMyLatest` — should return the latest agreement summary of that member
- [ ] [경계] `findMyLatest` — should return null when the member never signed
- [ ] [정상] `getMyAgreementPdf` — should return the stored pdf bytes
- [ ] [정상] `GET /agreements/mine` — should return 200 with the summary
- [ ] [경계] `GET /agreements/mine` — should return 204 when the member never signed
- [ ] [정상] `GET /agreements/:id` — should return 200 with application/pdf

### 남의 것은 못 본다 (AC2)

- [ ] [예외] `getMyAgreementPdf` — should reject with AGREEMENT_FORBIDDEN when the requester is not the owner
- [ ] [예외] `getMyAgreementPdf` — should reject with AGREEMENT_NOT_FOUND when the id does not exist
- [ ] [예외] `GET /agreements/:id` — should return 403 for another member's agreement
- [ ] [예외] `GET /agreements/:id` — should return 404 for an unknown id

### 해시 대조 (AC3)

- [ ] [정상] `getMyAgreementPdf` — should report the hash matches when the file is untouched
- [ ] [예외] `getMyAgreementPdf` — should report a mismatch when the stored file changed
- [ ] [경계] `getMyAgreementPdf` — should still return the pdf when the hash does not match

### 화면 (AC1)

- [ ] [화면] `MyAgreement` — should link to the signed pdf when one exists
- [ ] [화면] `MyAgreement` — should say nothing is signed yet when there is none

**총 15개** (정상 6 / 경계 4 / 예외 5)

---

## AC 대조

| #   | AC                                                    | 커버하는 시나리오                                                                                                                   |
| --- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 마이페이지에서 동의서를 열면 서명이 포함된 PDF가 표시 | `findMyLatest` 2건 · `getMyAgreementPdf — pdf bytes` · `GET /agreements/mine` 2건 · `GET /agreements/:id — 200` · `MyAgreement` 2건 |
| 2   | 다른 회원의 동의서 ID로 접근하면 `FORBIDDEN`으로 막힘 | `getMyAgreementPdf — FORBIDDEN` · `— NOT_FOUND` · `GET /agreements/:id — 403` · `— 404`                                             |
| 3   | 저장된 PDF의 해시가 기록된 `sha256`과 일치            | `getMyAgreementPdf — hash matches` · `— mismatch` · `— still return the pdf`                                                        |

**커버리지: AC 3개 전부 커버 / 시나리오 15개 / 미커버 0개**

---

## 이번 범위 밖

| 항목                      | 이유                                            |
| ------------------------- | ----------------------------------------------- |
| 동의서 목록 (여러 건)     | AC는 "내 동의서"이고 한 회원당 최신 하나면 된다 |
| 관리자의 타인 동의서 열람 | #32 (관리자 회원 상세)                          |
| 해시 불일치 시 자동 복구  | 원본이 없다. 기록하고 사람이 판단한다           |
| 다운로드 이력 기록        | AC에 없다                                       |
