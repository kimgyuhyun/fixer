import { createHash } from 'node:crypto';
import { AGREEMENT_ERRORS } from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import {
  AgreementService,
  type AgreementRecord,
  type AgreementStore,
  type AgreementTemplateRecord,
  type AgreementTemplateStore,
  type FileStore,
  type PdfMerger,
} from './agreement.service';

/** 이슈 #8 — 조회. 서명(#7)과 파일을 나눈 이유는 관심사가 다르기 때문이다 */
const OWNER = 'usr_owner';
const STRANGER = 'usr_stranger';
const NOW = new Date('2026-09-03T00:00:00.000Z');

const STORED_PDF = Buffer.from('%PDF-1.7 signed agreement');
const STORED_SHA = createHash('sha256').update(STORED_PDF).digest('hex');

function agreement(overrides: Partial<AgreementRecord> = {}): AgreementRecord {
  return {
    id: 'agr_1',
    userId: OWNER,
    templateVersion: 1,
    filePath: 'agreements/agr_1.pdf',
    sha256: STORED_SHA,
    agreedAt: NOW,
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0',
    ...overrides,
  };
}

class FakeAgreementStore implements AgreementStore {
  constructor(private readonly rows: AgreementRecord[] = []) {}
  create(): Promise<AgreementRecord> {
    throw new Error('이 테스트는 조회만 본다');
  }
  findById(id: string): Promise<AgreementRecord | null> {
    return Promise.resolve(this.rows.find((r) => r.id === id) ?? null);
  }
  findLatestByUser(userId: string): Promise<AgreementRecord | null> {
    const mine = this.rows
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.agreedAt.getTime() - a.agreedAt.getTime());
    return Promise.resolve(mine[0] ?? null);
  }
}

class FakeFileStore implements FileStore {
  constructor(private readonly bytes: Buffer = STORED_PDF) {}
  put(): Promise<{ sha256: string; bytes: number }> {
    throw new Error('이 테스트는 조회만 본다');
  }
  get(): Promise<Buffer> {
    return Promise.resolve(this.bytes);
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
}

const TEMPLATES: AgreementTemplateStore = {
  findActive: (): Promise<AgreementTemplateRecord | null> =>
    Promise.resolve(null),
};
const MERGER: PdfMerger = {
  merge: (): Promise<Buffer> => {
    throw new Error('이 테스트는 조회만 본다');
  },
};

function setup(rows: AgreementRecord[] = [agreement()], stored = STORED_PDF) {
  const agreements = new FakeAgreementStore(rows);
  const files = new FakeFileStore(stored);
  return {
    service: new AgreementService(TEMPLATES, agreements, files, MERGER),
  };
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

describe('findMyLatest', () => {
  it('should return the latest agreement summary of that member', async () => {
    const older = agreement({
      id: 'agr_old',
      agreedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const { service } = setup([older, agreement()]);

    const found = await service.findMyLatest(OWNER);

    expect(found?.id).toBe('agr_1');
  });

  it('should return null when the member never signed', async () => {
    const { service } = setup([]);

    await expect(service.findMyLatest(OWNER)).resolves.toBeNull();
  });
});

describe('getMyAgreementPdf', () => {
  it('should return the stored pdf bytes', async () => {
    const { service } = setup();

    const result = await service.getMyAgreementPdf({
      agreementId: 'agr_1',
      requesterId: OWNER,
    });

    expect(result.bytes).toEqual(STORED_PDF);
  });

  it('should reject with AGREEMENT_FORBIDDEN when the requester is not the owner', async () => {
    // 동의서에는 이름과 서명이 들어 있다. 남이 보면 개인정보 유출이다.
    const { service } = setup();

    const error = await rejectionOf(
      service.getMyAgreementPdf({
        agreementId: 'agr_1',
        requesterId: STRANGER,
      }),
    );

    expect(codeOf(error)).toBe(AGREEMENT_ERRORS.FORBIDDEN);
  });

  it('should reject with AGREEMENT_NOT_FOUND when the id does not exist', async () => {
    const { service } = setup();

    const error = await rejectionOf(
      service.getMyAgreementPdf({
        agreementId: 'agr_missing',
        requesterId: OWNER,
      }),
    );

    expect(codeOf(error)).toBe(AGREEMENT_ERRORS.NOT_FOUND);
  });

  it('should report the hash matches when the file is untouched', async () => {
    const { service } = setup();

    const result = await service.getMyAgreementPdf({
      agreementId: 'agr_1',
      requesterId: OWNER,
    });

    expect(result.sha256Matches).toBe(true);
  });

  it('should report a mismatch when the stored file changed', async () => {
    // 저장 후 파일이 바뀌었는지를 잡는 유일한 방법이다 (AC3)
    const tampered = Buffer.from('%PDF-1.7 tampered');
    const { service } = setup([agreement()], tampered);

    const result = await service.getMyAgreementPdf({
      agreementId: 'agr_1',
      requesterId: OWNER,
    });

    expect(result.sha256Matches).toBe(false);
  });

  it('should still return the pdf when the hash does not match', async () => {
    // 막지 않는다. 사용자에게는 자기 동의서를 보여주는 편이 낫고,
    // 어긋났다는 사실은 운영이 알아야 한다.
    const tampered = Buffer.from('%PDF-1.7 tampered');
    const { service } = setup([agreement()], tampered);

    const result = await service.getMyAgreementPdf({
      agreementId: 'agr_1',
      requesterId: OWNER,
    });

    expect(result.bytes).toEqual(tampered);
  });
});
