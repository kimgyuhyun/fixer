import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { PdfLibMerger } from './pdf-lib.merger';

/** 실제 템플릿을 쓴다. 가짜 PDF로는 pdf-lib이 읽히는지 알 수 없다 */
const TEMPLATE = readFileSync(
  join(__dirname, '../../assets/agreement-templates/v1.pdf'),
);

const BOX = { page: 0, x: 140, y: 180, width: 180, height: 60 };

/** 1×1 투명 PNG. 내용은 상관없고 pdf-lib이 embedPng로 읽을 수만 있으면 된다 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('PdfLibMerger', () => {
  it('should produce a pdf that pdf-lib can load back', async () => {
    const merged = await new PdfLibMerger().merge(TEMPLATE, TINY_PNG, BOX);

    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(1);
  });

  it('should keep the template page size', async () => {
    // 서명을 얹는 것이지 문서를 다시 만드는 것이 아니다
    const before = (await PDFDocument.load(TEMPLATE)).getPage(0).getSize();

    const merged = await new PdfLibMerger().merge(TEMPLATE, TINY_PNG, BOX);

    const after = (await PDFDocument.load(merged)).getPage(0).getSize();
    expect(after).toEqual(before);
  });

  it('should grow the document because something was drawn into it', async () => {
    const merged = await new PdfLibMerger().merge(TEMPLATE, TINY_PNG, BOX);

    // 서명이 실제로 들어갔으면 원본보다 커진다. 픽셀 위치까지는 E2E 몫이다.
    expect(merged.length).toBeGreaterThan(TEMPLATE.length);
  });

  it('should reject when the signatureBox points at a page that does not exist', async () => {
    // 템플릿을 바꾸고 사각형을 안 고치면 여기서 걸린다. 조용히 넘기면
    // 서명이 사라진 PDF가 저장된다.
    await expect(
      new PdfLibMerger().merge(TEMPLATE, TINY_PNG, { ...BOX, page: 9 }),
    ).rejects.toThrow(/9번 페이지가 없습니다/);
  });
});
