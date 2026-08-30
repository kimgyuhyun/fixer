import { z } from 'zod';

/**
 * 이메일 인증 코드 규칙. (이슈 #1, ADR-AUTH-4)
 *
 * 상수를 한 곳에 모으는 이유는 테스트에서 짧은 값을 주입하기 위해서다.
 * 만료 10분을 실제로 기다릴 수는 없다.
 */
export const EMAIL_VERIFICATION_RULES = {
  codeLength: 6,
  expiryMinutes: 10,
  resendCooldownSeconds: 60,
  maxSendsPerHour: 5,
  /** 코드 하나당 3회까지 틀릴 수 있고, 3번째 실패에서 그 코드는 폐기된다 */
  maxAttempts: 3,
} as const;

/**
 * 이 이슈에서 쓰는 에러 코드.
 *
 * 사용자에게 보여줄 문구와 프로그램이 분기할 코드를 분리한다.
 * 문구는 바뀌어도 코드는 바뀌지 않으므로, 웹은 코드로만 분기한다.
 */
export const EMAIL_VERIFICATION_ERRORS = {
  /** 발송된 지 10분이 지났다 */
  EXPIRED: 'MEMBER_VERIFICATION_CODE_EXPIRED',
  /** 코드가 일치하지 않는다 */
  INVALID: 'MEMBER_VERIFICATION_CODE_INVALID',
  /** 3회 틀려서 코드가 폐기됐다 */
  ATTEMPTS_EXCEEDED: 'MEMBER_VERIFICATION_ATTEMPTS_EXCEEDED',
  /** 60초 안에 재발송을 요청했다 */
  RESEND_COOLDOWN: 'MEMBER_RESEND_COOLDOWN',
  /** 1시간에 5회를 넘겼다 */
  RESEND_LIMIT_EXCEEDED: 'MEMBER_RESEND_LIMIT_EXCEEDED',
} as const;

export type EmailVerificationErrorCode =
  (typeof EMAIL_VERIFICATION_ERRORS)[keyof typeof EMAIL_VERIFICATION_ERRORS];

export const emailVerificationRequestSchema = z.object({
  email: z.email(),
});
export type EmailVerificationRequest = z.infer<
  typeof emailVerificationRequestSchema
>;

export const emailVerificationSentSchema = z.object({
  /** 이 시각이 지나면 코드가 만료된다 */
  expiresAt: z.iso.datetime(),
  /** 이 시각 전에는 재발송이 거절된다. 화면이 남은 초를 표시한다 */
  resendAvailableAt: z.iso.datetime(),
});
export type EmailVerificationSent = z.infer<typeof emailVerificationSentSchema>;

export const verifyEmailCodeRequestSchema = z.object({
  email: z.email(),
  code: z.string().regex(/^\d{6}$/),
});
export type VerifyEmailCodeRequest = z.infer<
  typeof verifyEmailCodeRequestSchema
>;

export const emailVerifiedSchema = z.object({
  email: z.email(),
  verifiedAt: z.iso.datetime(),
});
export type EmailVerified = z.infer<typeof emailVerifiedSchema>;
