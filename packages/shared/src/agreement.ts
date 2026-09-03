import { z } from 'zod';

/** 동의서 규칙 (`spec-fixed.md` §2.3) */
export const AGREEMENT_RULES = {
  /**
   * 서명 PNG의 최대 바이트.
   *
   * 캔버스에서 나오는 서명은 수십 KB면 충분하다. 상한이 없으면 거대한 이미지로
   * 서버 메모리를 밀 수 있다 — 병합이 메모리에서 일어나므로 특히 그렇다.
   */
  signatureMaxBytes: 512 * 1024,
} as const;

/** 동의서가 내는 에러 코드 */
export const AGREEMENT_ERRORS = {
  /** 활성 템플릿이 없다. 운영 설정 문제이지 사용자 잘못이 아니다 */
  TEMPLATE_MISSING: 'AGREEMENT_TEMPLATE_MISSING',
  /** 서명을 그리지 않았거나 모양이 서명이 아니다 */
  SIGNATURE_REQUIRED: 'AGREEMENT_SIGNATURE_REQUIRED',
} as const;

export type AgreementErrorCode =
  (typeof AGREEMENT_ERRORS)[keyof typeof AGREEMENT_ERRORS];

/**
 * 서명이 들어갈 사각형. PDF 좌표(좌하단 원점, pt)다.
 *
 * **템플릿이 이 값을 들고 있고 클라이언트는 좌표를 보내지 않는다** (ADR-AGR-1).
 */
export const signatureBoxSchema = z.object({
  page: z.number().int().nonnegative(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type SignatureBox = z.infer<typeof signatureBoxSchema>;

/** 서명 요청. 본문에는 서명 이미지만 담는다 — ip·userAgent는 서버가 읽는다 */
export const signAgreementRequestSchema = z.object({
  /** data URL이 아니라 base64 본문만 */
  signaturePngBase64: z.string().min(1, { error: '서명을 그려 주세요.' }),
});
export type SignAgreementRequest = z.infer<typeof signAgreementRequestSchema>;

/** 서명 결과. 파일 경로와 해시는 응답에 싣지 않는다 */
export const signedAgreementSchema = z.object({
  id: z.string().min(1),
  templateVersion: z.number().int(),
  agreedAt: z.string(),
});
export type SignedAgreement = z.infer<typeof signedAgreementSchema>;
