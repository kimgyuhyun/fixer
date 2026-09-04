# 이슈 #7 — 동의서를 읽고 서명한다

> 선행 #2 (가입) · 도메인 agreement · 크기 L
> 브랜치 `feat/agreement/issue-7` (base: `main`)

서명 캔버스 + `pdf-lib` 병합 + 저장까지 한 흐름. 쪼개면 중간에 보여줄 게 없어서 L이다.

---

## 시그니처

### 데이터 (`ADR-AGR-4`)

```prisma
/// 동의서 템플릿. 파일은 git으로, 메타데이터는 여기로 (ADR-AGR-4)
model AgreementTemplate {
  version      Int      @id
  fileKey      String
  sha256       String
  /// 서명이 들어갈 사각형 (PDF 좌표). ADR-AGR-1이 여기서 좌표를 통제한다
  signatureBox Json
  isActive     Boolean  @default(false)
  activatedAt  DateTime @default(now())
}

/// 서명이 병합된 최종 PDF와 그 메타데이터 (spec-fixed §2.3)
model Agreement {
  id              String   @id @default(cuid())
  userId          String
  templateVersion Int
  /// 상대경로. 절대경로 저장 금지 (§2.3)
  filePath        String
  /// 파기 후에도 남길 값 (§9)
  sha256          String
  agreedAt        DateTime @default(now())
  ip              String
  userAgent       String
  user            User     @relation(fields: [userId], references: [id])

  @@index([userId, agreedAt])
}
```

### 서버

```ts
/** ADR-AGR-3. 논리 키를 받고 저장소가 실제 위치로 매핑한다 */
export interface FileStore {
  put(key: string, bytes: Buffer): Promise<{ sha256: string; bytes: number }>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** ADR-AGR-2. 병합은 서버에서만 한다 */
export interface PdfMerger {
  /** 템플릿의 signatureBox에 서명 PNG를 넣고 최종 PDF를 돌려준다 */
  merge(templatePdf: Buffer, signaturePng: Buffer, box: SignatureBox): Promise<Buffer>;
}

export interface AgreementTemplateStore {
  findActive(): Promise<AgreementTemplateRecord | null>;
}

export interface AgreementStore {
  create(input: {
    userId: string; templateVersion: number; filePath: string;
    sha256: string; ip: string; userAgent: string;
  }): Promise<AgreementRecord>;
}

/** 활성 템플릿 PDF를 그대로 돌려준다 (화면이 표시한다) */
getActiveTemplatePdf(): Promise<{ version: number; bytes: Buffer }>

/**
 * 서명 PNG를 받아 병합하고 저장한다.
 *
 * **원본 PNG는 어디에도 저장하지 않는다** (§2.3). 메모리에서 병합하고 버린다.
 */
sign(input: {
  userId: string; signaturePng: Buffer; ip: string; userAgent: string;
}): Promise<AgreementRecord>
```

```
GET  /agreements/template   →  200 application/pdf   (활성 템플릿)
POST /agreements            →  201 { id, agreedAt, templateVersion }
```

### 웹

```
/signup/agreement   동의서 화면 — PDF 표시 + 서명 캔버스 + 동의 버튼
```

---

## 판단이 갈렸던 지점

**서명 PNG를 어디에도 저장하지 않는다.**
§2.3이 "원본 서명 PNG는 병합 직후 폐기"라고 정했다. 임시 파일로도 쓰지 않는다 — 쓰면 지웠는지 확인해야 하고, 그 확인이 또 테스트 대상이 된다. **`FileStore.put`이 PDF 키로만 불렸는지 단언하는 것**이 "저장하지 않았다"의 증명이다.

**캔버스 그리기 자체는 단위 테스트로 검증하지 않는다.**
jsdom에 canvas 2D 컨텍스트가 없다. 픽셀이 실제로 그려지는지는 E2E 몫이고, 단위 테스트는 **"그렸다는 상태가 잡히는가"와 "지우기가 그 상태를 되돌리는가"** 까지만 본다. 이 경계를 지키지 않으면 canvas를 흉내 내는 가짜 테스트가 된다.

**`ip`·`userAgent`는 서버가 요청에서 읽는다.**
클라이언트가 보내면 조작된다. 동의 시점의 접속 정보는 분쟁 시 증거라 서버가 직접 본 것만 남긴다.

---

## 시나리오

### 템플릿 조회 (AC1)

- [x] [정상] `getActiveTemplatePdf` — should return the active template bytes and its version
- [x] [예외] `getActiveTemplatePdf` — should reject with AGREEMENT_TEMPLATE_MISSING when no template is active
- [x] [정상] `GET /agreements/template` — should return 200 with application/pdf
- [x] [예외] `GET /agreements/template` — should return 503 with errorCode AGREEMENT_TEMPLATE_MISSING when no template is active

### 병합과 저장 (AC3)

- [x] [정상] `sign` — should store the merged pdf and record sha256, templateVersion and agreedAt
- [x] [정상] `sign` — should record the ip and userAgent the server observed
- [x] [정상] `sign` — should pass the template signatureBox to the merger
- [x] [경계] `sign` — should keep the filePath relative, never absolute
- [x] [예외] `sign` — should reject when the merger throws and store nothing
- [x] [정상] `POST /agreements` — should return 201 with id, agreedAt and templateVersion
- [x] [보안] `POST /agreements` — should ignore ip and userAgent in the body and use what the server observed
- [x] [예외] `POST /agreements` — should return 400 when the signature is rejected by the service

### 서명 없이 동의 금지 (AC4)

- [x] [예외] `sign` — should reject with AGREEMENT_SIGNATURE_REQUIRED when the png is empty
- [x] [경계] `sign` — should reject a png that is not a png
- [x] [경계] `sign` — should reject a png larger than the allowed size
- [x] [예외] `POST /agreements` — should return 400 with AGREEMENT_SIGNATURE_REQUIRED for an empty signature

### 원본 PNG를 남기지 않는다 (AC5)

- [x] [정상] `sign` — should never put the signature png into the file store
- [x] [정상] `sign` — should put exactly one file, the merged pdf

### 실제 PDF 병합 (AC3 — 진짜 템플릿으로)

가짜 PDF로는 `pdf-lib`이 읽히는지 알 수 없다. 저장소의 실제 템플릿을 쓴다.

- [x] [정상] `PdfLibMerger` — should produce a pdf that pdf-lib can load back
- [x] [정상] `PdfLibMerger` — should keep the template page size
- [x] [정상] `PdfLibMerger` — should grow the document because something was drawn into it
- [x] [예외] `PdfLibMerger` — should reject when the signatureBox points at a page that does not exist

### 서명 캔버스 (AC2)

- [x] [화면] `SignaturePad` — should mark itself signed after a pointer stroke
- [x] [화면] `SignaturePad` — should clear the signed state when 지우기 is pressed
- [x] [화면] `SignaturePad` — should report the drawn image to its parent on stroke end

### 동의서 화면 (AC1·AC2·AC4)

- [x] [화면] `AgreementPage` — should show the template pdf
- [x] [화면] `AgreementPage` — should keep the 동의 button disabled until something is drawn
- [x] [화면] `AgreementPage` — should send the signature and move on when 동의 is pressed
- [x] [화면] `AgreementPage` — should show the server message when the server rejects

**총 29개** (정상 13 / 경계 4 / 예외 7 / 보안 1 / 화면 5 — 일부 중복 집계 없음)

> AC 검증에서 **컨트롤러 테스트 5건이 체크만 되고 실재하지 않는 것**이 잡혔다.
> #6에서 똑같은 실수를 했고 `signup.controller.test.ts:9-13`의 회고 주석이
> 이미 경고하고 있었는데 또 반복했다. 체크박스는 테스트를 쓴 뒤에 채운다.
>
> 그리고 **API 전체가 부팅 시 크래시하고 있었다.** `.env`에 `AGREEMENT_STORAGE_PATH`가
> 없어 `LocalFileStore` 생성자가 던졌고 `AppModule`이 통째로 죽었다. 동의서만이
> 아니라 API 프로세스 전부다. seed까지 넣고 실제로 `GET /agreements/template`이
> 200에 776바이트 PDF를 주는 것을 확인했다.

---

## AC 대조

| #   | AC                                                                        | 커버하는 시나리오                                                                                                                   |
| --- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 동의서를 열면 템플릿 PDF 내용이 화면에 보인다                             | `getActiveTemplatePdf` 2건 · `GET /agreements/template` 2건 · `AgreementPage — should show the template pdf`                        |
| 2   | 캔버스에 그리면 선이 그려지고 "지우기"로 초기화된다                       | `SignaturePad` 3건                                                                                                                  |
| 3   | 동의하면 병합 PDF가 저장되고 `sha256`·`agreedAt`·`templateVersion`이 기록 | `sign` 5건 · `POST /agreements` 2건 · `AgreementPage — should send the signature and move on`                                       |
| 4   | 서명하지 않고 동의하면 막히고 안내가 뜬다                                 | `sign` 3건 · `POST /agreements — 400` · `AgreementPage — should keep the 동의 button disabled` · `— should show the server message` |
| 5   | 저장소에 원본 서명 PNG가 남아 있지 않다                                   | `sign — should never put the signature png into the file store` · `— should put exactly one file, the merged pdf`                   |

**커버리지: AC 5개 전부 커버 / 시나리오 29개 / 미커버 0개**

---

## 이번 범위 밖

| 항목                        | 어디서                                                   |
| --------------------------- | -------------------------------------------------------- |
| 내 동의서 다시 조회         | #8                                                       |
| 캔버스 픽셀이 실제로 그려짐 | E2E. jsdom에 canvas 2D 컨텍스트가 없다                   |
| PDF 뷰어의 확대·페이지 이동 | AC에 없다. `<iframe>`이나 `<object>`로 브라우저에 맡긴다 |
| 관리자 템플릿 업로드 화면   | `ADR-AGR-4` — seed·git으로 관리                          |
| 서명 후 재서명·수정         | AC에 없다. 동의서는 한 번 서명하면 그대로다              |
