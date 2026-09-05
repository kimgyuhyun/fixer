import { z } from 'zod';
import { JOB_POST_STATUSES } from './job-post.js';

/**
 * 회원 등급. (`spec-fixed.md` §11.1)
 *
 * 관리자를 별도 테이블로 두지 않는다. `schema.prisma`의 `UserRole`과 같아야
 * 한다 — 둘이 어긋나면 타입은 통과하는데 DB가 거부한다.
 */
export const USER_ROLES = ['USER', 'ADMIN'] as const;

export type UserRole = (typeof USER_ROLES)[number];

/**
 * 관리자 계층이 내는 에러 코드.
 *
 * **401은 여기에 없다.** 로그인 여부는 `LOGIN_ERRORS.UNAUTHENTICATED`가 이미
 * 쓰이고 있다 — 401을 코드 두 개로 내면 화면이 둘 다 처리해야 한다.
 */
export const ADMIN_ERRORS = {
  /** 로그인은 됐지만 관리자가 아니다 */
  FORBIDDEN: 'ADMIN_FORBIDDEN',
  /** 사유가 필수인 조치인데 비었다 (§11.6) */
  REASON_REQUIRED: 'ADMIN_REASON_REQUIRED',
} as const;

export type AdminErrorCode = (typeof ADMIN_ERRORS)[keyof typeof ADMIN_ERRORS];

/**
 * 감사 로그의 `action` 값.
 *
 * 문자열을 호출부마다 손으로 적으면 오타 하나가 조용히 다른 조치로 남는다.
 * #33·#34가 여기에 자기 값을 더한다.
 */
export const ADMIN_ACTIONS = {
  JOB_POST_FORCE_CANCEL: 'JOB_POST_FORCE_CANCEL',
} as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[keyof typeof ADMIN_ACTIONS];

/**
 * 관리자 공고 목록 필터.
 *
 * 일반 목록(`jobPostFilterSchema`)과 나눈 이유가 둘이다. 관리자는 **`OPEN`이
 * 아닌 공고도 봐야 하고**, 검색어가 제목뿐 아니라 **구인자 이름**에도 걸린다.
 */
export const adminJobPostFilterSchema = z.object({
  /** 제목 **또는** 구인자 이름 부분 일치 (AC2) */
  q: z.string().trim().min(1).optional(),
  /** 없으면 전부. 관리자 목록은 OPEN만 보는 화면이 아니다 */
  status: z.enum(JOB_POST_STATUSES).optional(),
  category: z.string().trim().min(1).optional(),
  /** 1부터. 범위를 넘으면 오류가 아니라 빈 목록이다 (일반 목록과 같은 규칙) */
  page: z.coerce.number().int().min(1).catch(1).default(1),
});

export type AdminJobPostFilter = z.infer<typeof adminJobPostFilterSchema>;

/** 목록 한 줄. AC1이 요구하는 다섯 칸이 그대로 필드다 */
export const adminJobPostSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  employerName: z.string(),
  categoryName: z.string(),
  status: z.enum(JOB_POST_STATUSES),
  createdAt: z.iso.datetime(),
});

export type AdminJobPostSummary = z.infer<typeof adminJobPostSummarySchema>;

/** 목록 응답. 오프셋 페이징이라 전체 건수를 함께 준다 (ADR-JOB-5) */
export const adminJobPostListSchema = z.object({
  items: z.array(adminJobPostSummarySchema),
  /** **필터를 적용한 뒤의** 건수 */
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type AdminJobPostList = z.infer<typeof adminJobPostListSchema>;

/** 강제 취소 요청. **사유가 필수다** (§11.6) */
export const forceCancelRequestSchema = z.object({
  reason: z.string().trim().min(1, { error: '취소 사유를 입력해 주세요.' }),
});

export type ForceCancelRequest = z.infer<typeof forceCancelRequestSchema>;
