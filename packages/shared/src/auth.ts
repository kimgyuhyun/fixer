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

/**
 * 가입 규칙. (이슈 #2)
 *
 * 인증을 마친 이메일에 비밀번호와 이름을 붙여 `User`를 만든다.
 * 주소(#3)와 동의서(#7)는 뒤 이슈가 붙인다.
 */
export const SIGNUP_RULES = {
  /** 8자 미만은 거절된다 */
  passwordMinLength: 8,
  /**
   * bcrypt(비밀번호 단방향 해시 알고리즘)는 72바이트를 넘는 입력을 조용히
   * 잘라낸다. 상한을 두지 않으면 73바이트부터는 뒷부분이 비밀번호에 아무
   * 영향을 주지 않는데 사용자는 그 사실을 알 수 없다.
   *
   * 글자 수가 아니라 바이트 수로 재는 이유가 이것이다 — 한글 한 글자는 3바이트다.
   */
  passwordMaxBytes: 72,
  /** 공백만 있는 이름을 막는다. 앞뒤를 다듬은 뒤에 잰다 */
  nameMinLength: 1,
  /** 방어적 상한. 사양에 값이 없어 입력 폭주만 막는 선에서 정했다 */
  nameMaxLength: 20,
  /** spec-fixed §2.2 "비밀번호 설정 (bcrypt cost 12)" */
  bcryptCostFactor: 12,
} as const;

/**
 * 가입이 내는 에러 코드. 둘 다 이슈 #2의 AC에 적힌 문자열 그대로다.
 */
export const SIGNUP_ERRORS = {
  /** 이메일 인증을 마치지 않았다 */
  EMAIL_NOT_VERIFIED: 'AUTH_EMAIL_NOT_VERIFIED',
  /** 그 이메일로 이미 회원이 있다 */
  EMAIL_ALREADY_EXISTS: 'MEMBER_EMAIL_ALREADY_EXISTS',
} as const;

export type SignupErrorCode =
  (typeof SIGNUP_ERRORS)[keyof typeof SIGNUP_ERRORS];

/**
 * 문자열의 UTF-8 바이트 길이. 한글 한 글자는 3바이트다.
 *
 * `TextEncoder`를 쓰지 않는 이유는 이 패키지가 웹과 API 양쪽에서 쓰이는데
 * 브라우저·Node 타입 정의를 어느 쪽도 끌어오지 않기 때문이다. 코드 포인트를
 * 직접 세면 어디서든 같은 값이 나온다. (`for...of`는 서로게이트 쌍을
 * 한 글자로 순회한다)
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

export const signupRequestSchema = z.object({
  email: z.email({ error: '이메일 형식이 올바르지 않습니다.' }),
  password: z
    .string({ error: '비밀번호를 입력해 주세요.' })
    .min(SIGNUP_RULES.passwordMinLength, {
      error: `비밀번호는 ${SIGNUP_RULES.passwordMinLength}자 이상이어야 합니다.`,
    })
    .refine((value) => utf8ByteLength(value) <= SIGNUP_RULES.passwordMaxBytes, {
      error: `비밀번호가 너무 깁니다. (최대 ${SIGNUP_RULES.passwordMaxBytes}바이트)`,
    }),
  name: z
    .string({ error: '이름을 입력해 주세요.' })
    .trim()
    .min(SIGNUP_RULES.nameMinLength, { error: '이름을 입력해 주세요.' })
    .max(SIGNUP_RULES.nameMaxLength, {
      error: `이름은 ${SIGNUP_RULES.nameMaxLength}자 이내로 입력해 주세요.`,
    }),
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;

/** 가입 결과. 비밀번호도 해시도 여기에 들어가지 않는다 */
export const signedUpSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  createdAt: z.iso.datetime(),
});
export type SignedUp = z.infer<typeof signedUpSchema>;

/**
 * 로그인 토큰 규칙. (이슈 #4, spec-fixed §2.5)
 *
 * 이 값들은 사양에서 이미 확정됐다. 여기서 다시 정하지 않는다.
 */
export const AUTH_TOKEN_RULES = {
  /** Access 토큰(JWT)의 수명 */
  accessTokenMinutes: 15,
  /** Refresh 토큰의 수명 */
  refreshTokenDays: 14,
} as const;

/**
 * 토큰을 담는 쿠키 이름.
 *
 * 웹 미들웨어(#5)와 API가 같은 문자열을 봐야 하므로 shared에 둔다.
 */
export const AUTH_COOKIES = {
  access: 'fixer_access',
  refresh: 'fixer_refresh',
} as const;

/**
 * 로그인·인증이 내는 에러 코드.
 */
export const LOGIN_ERRORS = {
  /**
   * 이메일이 없거나 비밀번호가 틀렸다.
   *
   * 둘을 구분해서 알려주지 않는다. 구분하면 이메일만 넣어보고 가입 여부를
   * 알아낼 수 있다.
   */
  INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  /** 유효한 Access도, 살아 있는 Refresh도 없다 */
  UNAUTHENTICATED: 'AUTH_UNAUTHENTICATED',
} as const;

export type LoginErrorCode = (typeof LOGIN_ERRORS)[keyof typeof LOGIN_ERRORS];

export const loginRequestSchema = z.object({
  email: z.email({ error: '이메일 형식이 올바르지 않습니다.' }),
  password: z
    .string({ error: '비밀번호를 입력해 주세요.' })
    .min(1, { error: '비밀번호를 입력해 주세요.' }),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** 로그인 성공 응답. 토큰은 본문이 아니라 httpOnly 쿠키로만 나간다 */
export const signedInSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
});
export type SignedIn = z.infer<typeof signedInSchema>;

/** 마이페이지가 읽는 내 정보 */
export const myProfileSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  /**
   * 주소는 #3(주소 등록)이 채운다. 그전까지 항상 null이다.
   *
   * 자리를 아예 비워두지 않는 이유는, 나중에 #3이 응답 모양을 바꾸면 웹이
   * 함께 깨지기 때문이다. 자리만 만들어 두고 채우는 것은 #3에 맡긴다.
   */
  address: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type MyProfile = z.infer<typeof myProfileSchema>;
