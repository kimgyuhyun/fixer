import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AGREEMENT_ERRORS,
  AGREEMENT_RULES,
  type AgreementErrorCode,
  type SignatureBox,
} from '@fixer/shared';

/** 활성 템플릿 한 줄 */
export interface AgreementTemplateRecord {
  version: number;
  fileKey: string;
  sha256: string;
  signatureBox: SignatureBox;
  isActive: boolean;
}

/** 저장된 동의서 한 줄 */
export interface AgreementRecord {
  id: string;
  userId: string;
  templateVersion: number;
  filePath: string;
  sha256: string;
  agreedAt: Date;
  ip: string;
  userAgent: string;
}

/**
 * 파일 저장소. **논리 키를 받고 저장소가 실제 위치로 매핑한다** (ADR-AGR-3).
 *
 * 도메인이 `agreements/{id}.pdf` 같은 키를 정하므로, 로컬 볼륨에서 S3로 옮길 때
 * 구현체만 바꾸면 된다.
 */
export interface FileStore {
  /** 저장하고 내용 해시를 돌려준다. 파기 후에도 남길 값이다 (§9) */
  put(key: string, bytes: Buffer): Promise<{ sha256: string; bytes: number }>;
  get(key: string): Promise<Buffer>;
  /** 없는 키를 지워도 성공이다. 파기 배치가 멱등해야 한다 */
  delete(key: string): Promise<void>;
}

/** PDF 병합. **서버에서만 한다** (ADR-AGR-2) */
export interface PdfMerger {
  merge(
    templatePdf: Buffer,
    signaturePng: Buffer,
    box: SignatureBox,
  ): Promise<Buffer>;
}

export interface AgreementTemplateStore {
  findActive(): Promise<AgreementTemplateRecord | null>;
}

export interface AgreementStore {
  create(input: {
    userId: string;
    templateVersion: number;
    filePath: string;
    sha256: string;
    ip: string;
    userAgent: string;
  }): Promise<AgreementRecord>;
}

/** 동의서가 던지는 도메인 에러 */
export class AgreementError extends Error {
  constructor(readonly code: AgreementErrorCode) {
    super(code);
    this.name = 'AgreementError';
  }
}

/**
 * 동의서 읽기와 서명. (이슈 #7, `spec-fixed.md` §2.3)
 *
 * **원본 서명 PNG는 어디에도 저장하지 않는다.** 메모리에서 병합하고 버린다 —
 * 임시 파일로도 쓰지 않는다. 쓰면 지웠는지 확인해야 하고 그 확인이 또 검증 대상이 된다.
 */
@Injectable()
export class AgreementService {
  constructor(
    private readonly templates: AgreementTemplateStore,
    private readonly agreements: AgreementStore,
    private readonly files: FileStore,
    private readonly merger: PdfMerger,
  ) {}

  /** 활성 템플릿 PDF를 그대로 돌려준다. 화면이 표시한다 */
  async getActiveTemplatePdf(): Promise<{ version: number; bytes: Buffer }> {
    const template = await this.activeTemplate();
    return {
      version: template.version,
      bytes: await this.files.get(template.fileKey),
    };
  }

  /** 서명 PNG를 받아 병합하고 저장한다 */
  async sign(input: {
    userId: string;
    signaturePng: Buffer;
    ip: string;
    userAgent: string;
  }): Promise<AgreementRecord> {
    assertLooksLikeSignature(input.signaturePng);

    const template = await this.activeTemplate();
    const templatePdf = await this.files.get(template.fileKey);

    // 병합이 실패하면 여기서 끝난다. 아직 아무것도 저장하지 않았다.
    const merged = await this.merger.merge(
      templatePdf,
      input.signaturePng,
      template.signatureBox,
    );

    // 상대경로만 만든다. 절대경로는 DB에 넣지 않는다 (§2.3).
    const filePath = `agreements/${randomUUID()}.pdf`;
    const { sha256 } = await this.files.put(filePath, merged);

    // 원본 PNG는 여기서 그냥 버려진다. 어디에도 쓰지 않았다 (AC5).
    return this.agreements.create({
      userId: input.userId,
      templateVersion: template.version,
      filePath,
      sha256,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  private async activeTemplate(): Promise<AgreementTemplateRecord> {
    const template = await this.templates.findActive();
    if (!template) {
      throw new AgreementError(AGREEMENT_ERRORS.TEMPLATE_MISSING);
    }
    return template;
  }
}

/** PNG 시그니처(매직 넘버). 이걸로 시작하지 않으면 PNG가 아니다 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 서명처럼 생겼는지 본다.
 *
 * 픽셀을 뜯어보지는 않는다 — 빈 캔버스와 그린 캔버스를 구분하는 것은 화면의
 * 몫이고(AC4의 버튼 비활성화), 서버는 **모양과 크기**만 본다. 상한이 특히
 * 중요하다. 병합이 메모리에서 일어나므로 거대한 이미지가 서버를 밀 수 있다.
 */
function assertLooksLikeSignature(png: Buffer): void {
  const ok =
    png.length > PNG_MAGIC.length &&
    png.length < AGREEMENT_RULES.signatureMaxBytes &&
    png.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);

  if (!ok) {
    throw new AgreementError(AGREEMENT_ERRORS.SIGNATURE_REQUIRED);
  }
}
