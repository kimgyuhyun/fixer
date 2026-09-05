import { Injectable } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import type { SignatureBox } from '@fixer/shared';
import type { PdfMerger } from './agreement.service';

/**
 * `pdf-lib`로 템플릿에 서명을 얹는다. (`spec-fixed.md` §2.3, ADR-AGR-2)
 *
 * **좌표 계산이 여기 한 곳에만 있다.** 클라이언트는 좌표를 보내지 않고
 * 템플릿이 사각형을 들고 있으므로(ADR-AGR-1), 어긋날 자리가 없다.
 */
@Injectable()
export class PdfLibMerger implements PdfMerger {
  async merge(
    templatePdf: Buffer,
    signaturePng: Buffer,
    box: SignatureBox,
  ): Promise<Buffer> {
    const doc = await PDFDocument.load(templatePdf);
    const png = await doc.embedPng(signaturePng);

    const pages = doc.getPages();
    const page = pages[box.page];
    if (!page) {
      throw new Error(
        `템플릿에 ${box.page}번 페이지가 없습니다. signatureBox를 확인하세요.`,
      );
    }

    // 종횡비를 지키며 사각형 안에 맞춘다. 늘리면 서명이 일그러진다.
    const scale = Math.min(box.width / png.width, box.height / png.height);
    const width = png.width * scale;
    const height = png.height * scale;

    page.drawImage(png, {
      // 남는 공간은 가운데로. 사각형 왼쪽에 붙이면 서명이 칸을 벗어난 듯 보인다.
      x: box.x + (box.width - width) / 2,
      y: box.y + (box.height - height) / 2,
      width,
      height,
    });

    return Buffer.from(await doc.save());
  }
}
