import { Injectable } from '@nestjs/common';
import { type AgreementErrorCode, type SignatureBox } from '@fixer/shared';

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
    throw new Error('not implemented');
  }

  /** 서명 PNG를 받아 병합하고 저장한다 */
  async sign(_input: {
    userId: string;
    signaturePng: Buffer;
    ip: string;
    userAgent: string;
  }): Promise<AgreementRecord> {
    throw new Error('not implemented');
  }
}
