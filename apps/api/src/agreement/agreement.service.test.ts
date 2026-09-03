import { AGREEMENT_ERRORS, AGREEMENT_RULES } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  AgreementService,
  type AgreementRecord,
  type AgreementStore,
  type AgreementTemplateRecord,
  type AgreementTemplateStore,
  type FileStore,
  type PdfMerger,
} from './agreement.service';

const USER_ID = 'usr_1';
const IP = '203.0.113.7';
const USER_AGENT = 'Mozilla/5.0 (test)';
const NOW = new Date('2026-09-03T00:00:00.000Z');

const BOX = { page: 0, x: 100, y: 120, width: 180, height: 60 };

/** PNG 시그니처(매직 넘버)로 시작해야 진짜 PNG다 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SIGNATURE_PNG = Buffer.concat([PNG_MAGIC, Buffer.from('drawn-strokes')]);
const TEMPLATE_PDF = Buffer.from('%PDF-1.7 template');
const MERGED_PDF = Buffer.from('%PDF-1.7 merged with signature');

function template(
  overrides: Partial<AgreementTemplateRecord> = {},
): AgreementTemplateRecord {
  return {
    version: 3,
    fileKey: 'agreement-templates/v3.pdf',
    sha256: 'template-hash',
    signatureBox: BOX,
    isActive: true,
    ...overrides,
  };
}

class FakeTemplateStore implements AgreementTemplateStore {
  constructor(private readonly row: AgreementTemplateRecord | null) {}
  findActive(): Promise<AgreementTemplateRecord | null> {
    return Promise.resolve(this.row);
  }
}

class FakeAgreementStore implements AgreementStore {
  readonly rows: AgreementRecord[] = [];
  create(input: {
    userId: string;
    templateVersion: number;
    filePath: string;
    sha256: string;
    ip: string;
    userAgent: string;
  }): Promise<AgreementRecord> {
    const row: AgreementRecord = {
      id: `agr_${this.rows.length + 1}`,
      agreedAt: NOW,
      ...input,
    };
    this.rows.push(row);
    return Promise.resolve(row);
  }
}

/**
 * **AC5의 증명 장치.** `put`에 들어온 것을 전부 기록해 두고,
 * 서명 PNG가 한 번도 안 들어왔음을 단언한다.
 */
class RecordingFileStore implements FileStore {
  readonly puts: { key: string; bytes: Buffer }[] = [];
  constructor(private readonly template: Buffer = TEMPLATE_PDF) {}

  put(key: string, bytes: Buffer): Promise<{ sha256: string; bytes: number }> {
    this.puts.push({ key, bytes });
    return Promise.resolve({ sha256: `sha-of-${key}`, bytes: bytes.length });
  }
  get(): Promise<Buffer> {
    return Promise.resolve(this.template);
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
}

function setup(
  opts: {
    templateRow?: AgreementTemplateRecord | null;
    merge?: PdfMerger['merge'];
  } = {},
) {
  const templates = new FakeTemplateStore(
    opts.templateRow === undefined ? template() : opts.templateRow,
  );
  const agreements = new FakeAgreementStore();
  const files = new RecordingFileStore();
  const merge = vi.fn(opts.merge ?? (() => Promise.resolve(MERGED_PDF)));
  const merger: PdfMerger = { merge };
  const service = new AgreementService(templates, agreements, files, merger);
  return { service, templates, agreements, files, merge };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

function codeOf(error: unknown): unknown {
  return (error as { code?: unknown }).code;
}

function signInput(overrides: Partial<{ signaturePng: Buffer }> = {}) {
  return {
    userId: USER_ID,
    signaturePng: SIGNATURE_PNG,
    ip: IP,
    userAgent: USER_AGENT,
    ...overrides,
  };
}

describe('getActiveTemplatePdf', () => {
  it('should return the active template bytes and its version', async () => {
    const { service } = setup();

    await expect(service.getActiveTemplatePdf()).resolves.toEqual({
      version: 3,
      bytes: TEMPLATE_PDF,
    });
  });

  it('should reject with AGREEMENT_TEMPLATE_MISSING when no template is active', async () => {
    // 운영 설정 문제이지 사용자 잘못이 아니다
    const { service } = setup({ templateRow: null });

    const error = await rejectionOf(service.getActiveTemplatePdf());

    expect(codeOf(error)).toBe(AGREEMENT_ERRORS.TEMPLATE_MISSING);
  });
});

describe('sign', () => {
  it('should store the merged pdf and record sha256, templateVersion and agreedAt', async () => {
    const { service, agreements, files } = setup();

    const saved = await service.sign(signInput());

    expect(files.puts).toHaveLength(1);
    expect(files.puts[0].bytes).toEqual(MERGED_PDF);
    expect(agreements.rows[0]).toMatchObject({
      templateVersion: 3,
      sha256: files.puts[0].key ? `sha-of-${files.puts[0].key}` : '',
    });
    expect(saved.agreedAt).toEqual(NOW);
  });

  it('should record the ip and userAgent the server observed', async () => {
    // 클라이언트가 보내면 조작된다. 분쟁 시 증거라 서버가 본 것만 남긴다.
    const { service, agreements } = setup();

    await service.sign(signInput());

    expect(agreements.rows[0]).toMatchObject({ ip: IP, userAgent: USER_AGENT });
  });

  it('should pass the template signatureBox to the merger', async () => {
    // ADR-AGR-1: 좌표는 템플릿이 들고 있다. 클라이언트가 보내지 않는다.
    const { service, merge } = setup();

    await service.sign(signInput());

    expect(merge).toHaveBeenCalledWith(TEMPLATE_PDF, SIGNATURE_PNG, BOX);
  });

  it('should keep the filePath relative, never absolute', async () => {
    // §2.3 — DB에는 절대경로 저장 금지
    const { service, agreements } = setup();

    await service.sign(signInput());

    const { filePath } = agreements.rows[0];
    expect(filePath.startsWith('/')).toBe(false);
    expect(/^[A-Za-z]:/.test(filePath)).toBe(false);
  });

  it('should reject when the merger throws and store nothing', async () => {
    const { service, agreements, files } = setup({
      merge: () => Promise.reject(new Error('pdf-lib blew up')),
    });

    await rejectionOf(service.sign(signInput()));

    expect(files.puts).toHaveLength(0);
    expect(agreements.rows).toHaveLength(0);
  });

  it('should reject with AGREEMENT_SIGNATURE_REQUIRED when the png is empty', async () => {
    const { service } = setup();

    const error = await rejectionOf(
      service.sign(signInput({ signaturePng: Buffer.alloc(0) })),
    );

    expect(codeOf(error)).toBe(AGREEMENT_ERRORS.SIGNATURE_REQUIRED);
  });

  it('should reject a png that is not a png', async () => {
    // 매직 넘버가 다르면 서명 이미지가 아니다
    const { service } = setup();

    const error = await rejectionOf(
      service.sign(signInput({ signaturePng: Buffer.from('not-an-image') })),
    );

    expect(codeOf(error)).toBe(AGREEMENT_ERRORS.SIGNATURE_REQUIRED);
  });

  it('should reject a png larger than the allowed size', async () => {
    // 병합이 메모리에서 일어나므로 상한이 없으면 서버를 밀 수 있다
    const { service } = setup();
    const huge = Buffer.concat([
      PNG_MAGIC,
      Buffer.alloc(AGREEMENT_RULES.signatureMaxBytes),
    ]);

    const error = await rejectionOf(
      service.sign(signInput({ signaturePng: huge })),
    );

    expect(codeOf(error)).toBe(AGREEMENT_ERRORS.SIGNATURE_REQUIRED);
  });

  it('should never put the signature png into the file store', async () => {
    // AC5. 임시로도 저장하지 않는다 — 메모리에서 병합하고 버린다.
    const { service, files } = setup();

    await service.sign(signInput());

    const storedSignature = files.puts.find((p) =>
      p.bytes.equals(SIGNATURE_PNG),
    );
    expect(storedSignature).toBeUndefined();
  });

  it('should put exactly one file, the merged pdf', async () => {
    const { service, files } = setup();

    await service.sign(signInput());

    expect(files.puts).toHaveLength(1);
    expect(files.puts[0].bytes).toEqual(MERGED_PDF);
    expect(files.puts[0].key).toMatch(/\.pdf$/);
  });
});
