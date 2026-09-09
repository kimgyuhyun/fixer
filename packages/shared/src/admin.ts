import { z } from 'zod';
import { JOB_POST_STATUSES, PENALTY_REASONS } from './job-post.js';

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
  /**
   * 그런 제재 건이 없다 (#33).
   *
   * `PENALTY_ERRORS`가 아니라 여기다. `PENALTY_SUSPENDED`는 "제재 때문에
   * 회원이 막혔다"는 회원용 코드고, 이건 **관리자 조치의 실패**다.
   */
  SUSPENSION_NOT_FOUND: 'ADMIN_SUSPENSION_NOT_FOUND',
  /** 이미 풀린 제재다 (#33). 두 번 풀면 감사 로그가 두 줄 남는다 */
  SUSPENSION_ALREADY_RELEASED: 'ADMIN_SUSPENSION_ALREADY_RELEASED',
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
  /** 관리자가 제재를 만료 전에 풀었다 (#33, §11.4) */
  SUSPENSION_RELEASE: 'SUSPENSION_RELEASE',
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

/** 블랙리스트 한 페이지 건수. 관리자 공고 목록과 같은 20 (#33) */
export const ADMIN_SUSPENSION_PAGE_SIZE = 20;

/**
 * 블랙리스트 필터. (#33, `spec-fixed.md` §11.4)
 *
 * **상태 필터가 없다.** 이 목록은 정의상 "현재 제재 중"만 보여준다 —
 * 해제된 이력 탭은 이 이슈 범위 밖이다.
 */
export const adminSuspensionFilterSchema = z.object({
  /** 회원 이름 부분 일치 (§11.4 "이름 검색") */
  q: z.string().trim().min(1).optional(),
  /** 1부터. 범위를 넘으면 오류가 아니라 빈 목록이다 (관리자 공고 목록과 같다) */
  page: z.coerce.number().int().min(1).catch(1).default(1),
});

export type AdminSuspensionFilter = z.infer<typeof adminSuspensionFilterSchema>;

/** 블랙리스트 한 줄. §11.4가 요구하는 다섯 칸이 그대로 필드다 */
export const adminSuspensionSummarySchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string(),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  /**
   * 사유 요약. **문자열이 아니라 코드 배열이다** — 문구를 서버가 만들면
   * 화면 문구를 바꿀 때 API를 고치게 된다. 라벨은 화면이 붙인다.
   */
  reasons: z.array(z.enum(PENALTY_REASONS)),
  /** 180일 창 안 누적 경고 수. 창 밖 경고는 세지 않는다 (§5) */
  penaltyCount: z.number().int(),
});

export type AdminSuspensionSummary = z.infer<
  typeof adminSuspensionSummarySchema
>;

/** 목록 응답. 오프셋 페이징이라 전체 건수를 함께 준다 (ADR-JOB-5) */
export const adminSuspensionListSchema = z.object({
  items: z.array(adminSuspensionSummarySchema),
  /** **필터를 적용한 뒤의** 건수 */
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type AdminSuspensionList = z.infer<typeof adminSuspensionListSchema>;

/** 제재 해제 요청. **사유가 필수다** (§11.4) */
export const releaseSuspensionRequestSchema = z.object({
  reason: z.string().trim().min(1, { error: '해제 사유를 입력해 주세요.' }),
});

export type ReleaseSuspensionRequest = z.infer<
  typeof releaseSuspensionRequestSchema
>;

/** 해제 결과. AC3이 요구하는 두 값이 그대로 필드다 */
export const releaseSuspensionResultSchema = z.object({
  id: z.string(),
  userId: z.string(),
  releasedAt: z.iso.datetime(),
  releasedBy: z.string(),
});

export type ReleaseSuspensionResult = z.infer<
  typeof releaseSuspensionResultSchema
>;
