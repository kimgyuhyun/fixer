import { z } from 'zod';
import { APPLICATION_STATUSES } from './application.js';
import { JOB_POST_STATUSES, PENALTY_REASONS } from './job-post.js';
import { POINT_TRANSACTION_TYPES } from './point.js';
import { RATING_ROLES, roleRatingSchema } from './rating.js';

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
  /**
   * 그런 회원이 없다 (#32).
   *
   * 상세 라우트가 `:id`를 받는 이상 없는 id가 반드시 온다. 없으면 500이
   * 나가고 화면이 "잘못된 링크"와 "서버 고장"을 구분하지 못한다.
   */
  MEMBER_NOT_FOUND: 'ADMIN_MEMBER_NOT_FOUND',
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
  /** 환전 승인 (#34) */
  EXCHANGE_APPROVE: 'EXCHANGE_APPROVE',
  /** 이체 완료 (#34) */
  EXCHANGE_COMPLETE: 'EXCHANGE_COMPLETE',
  /** 환전 반려 (#34) */
  EXCHANGE_REJECT: 'EXCHANGE_REJECT',
  /**
   * 계좌번호 전체 열람 (#34, §11.5).
   *
   * **아무것도 바꾸지 않는데 남긴다.** 평문 계좌번호를 본 사실 자체가
   * 나중에 답해야 할 질문이라 조치와 같은 표에 쌓는다.
   */
  EXCHANGE_ACCOUNT_REVEAL: 'EXCHANGE_ACCOUNT_REVEAL',
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

/** 관리자 회원 목록 한 페이지 건수. 관리자 목록 셋과 같은 20 (#32) */
export const ADMIN_MEMBER_PAGE_SIZE = 20;

/**
 * 회원 상태. (#32, `spec-fixed.md` §11.3 "정상 / 제재중 / 비활성화")
 *
 * **DB 컬럼이 아니다** (`ADR-AUTH-3`). `deactivatedAt`과 유효 제재 여부에서
 * 계산해 만든 표시용 값이다 — 컬럼으로 두면 두 벌이 되어 어긋날 자리가 생긴다.
 */
export const ADMIN_MEMBER_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
] as const;

export type AdminMemberStatus = (typeof ADMIN_MEMBER_STATUSES)[number];

/**
 * 두 사실에서 상태 하나를 낸다.
 *
 * **비활성화가 제재를 이긴다.** 둘 다인 회원에게 "제재중"을 붙이면 관리자가
 * 제재 해제를 눌러 볼 텐데, 그 계정은 애초에 로그인이 안 된다 (§2.6).
 *
 * 서버와 화면이 같은 함수를 쓴다. 화면이 따로 판정하면 "목록은 정상인데
 * 배지는 제재중"인 줄이 생긴다.
 */
export function memberStatusOf(member: {
  deactivatedAt: Date | null;
  hasActiveSuspension: boolean;
}): AdminMemberStatus {
  if (member.deactivatedAt !== null) return 'DEACTIVATED';
  return member.hasActiveSuspension ? 'SUSPENDED' : 'ACTIVE';
}

/**
 * 회원 목록 필터. **URL 쿼리스트링이 이 모양 그대로다** (`ADR-JOB-4`).
 *
 * 가입 기간 필터와 컬럼 정렬(§11.2)은 이 이슈의 AC에 없어 넣지 않는다.
 */
export const adminMemberFilterSchema = z.object({
  /** 이름 **또는** 이메일 부분 일치 (§11.2). 검색칸은 하나다 */
  q: z.string().trim().min(1).optional(),
  /** 주소지 1단계 (`ADR-AUTH-2`) */
  sido: z.string().trim().min(1).optional(),
  /** 주소지 2단계. 시/도 없이 단독으로도 걸린다 (#13이 정한 규칙) */
  sigungu: z.string().trim().min(1).optional(),
  status: z.enum(ADMIN_MEMBER_STATUSES).optional(),
  /** 1부터. 범위를 넘으면 오류가 아니라 빈 목록이다 (관리자 목록 셋과 같다) */
  page: z.coerce.number().int().min(1).catch(1).default(1),
});

export type AdminMemberFilter = z.infer<typeof adminMemberFilterSchema>;

/** 목록 한 줄. §11.3이 요구하는 일곱 칸이 그대로 필드다 */
export const adminMemberSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  joinedAt: z.iso.datetime(),
  /** 구인자로서 평점. 평균과 표본 수를 함께 준다 — "신규" 판정은 화면 몫 (#26) */
  asPoster: roleRatingSchema,
  /** 구직자로서 평점 */
  asWorker: roleRatingSchema,
  /** 180일 창 안 누적 경고 수 (§5) */
  penaltyCount: z.number().int(),
  status: z.enum(ADMIN_MEMBER_STATUSES),
});

export type AdminMemberSummary = z.infer<typeof adminMemberSummarySchema>;

/** 목록 응답. 오프셋 페이징이라 전체 건수를 함께 준다 (§11.2) */
export const adminMemberListSchema = z.object({
  items: z.array(adminMemberSummarySchema),
  /** **필터를 적용한 뒤의** 건수 */
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type AdminMemberList = z.infer<typeof adminMemberListSchema>;

/** 받은 별점 한 건. 거래 상대·공고·일시를 함께 준다 (§11.3) */
export const adminMemberReviewSchema = z.object({
  id: z.string(),
  score: z.number().int(),
  /** 그 거래에서 **평가받은 사람의** 역할 (#26) */
  rateeRole: z.enum(RATING_ROLES),
  raterName: z.string(),
  jobPostTitle: z.string(),
  createdAt: z.iso.datetime(),
});

export type AdminMemberReview = z.infer<typeof adminMemberReviewSchema>;

/** 등록한 공고 한 줄 */
export const adminMemberJobPostSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(JOB_POST_STATUSES),
  createdAt: z.iso.datetime(),
});

/** 신청 이력 한 줄 */
export const adminMemberApplicationSchema = z.object({
  id: z.string(),
  jobPostId: z.string(),
  jobPostTitle: z.string(),
  status: z.enum(APPLICATION_STATUSES),
  createdAt: z.iso.datetime(),
});

/** 원장 한 줄. 부호는 `amount`에 담긴다 (§6.1) */
export const adminMemberLedgerEntrySchema = z.object({
  id: z.string(),
  type: z.enum(POINT_TRANSACTION_TYPES),
  amount: z.number().int(),
  createdAt: z.iso.datetime(),
});

/** 경고 한 건. 사유·시각·관련 공고 (§11.3) */
export const adminMemberPenaltySchema = z.object({
  id: z.string(),
  reason: z.enum(PENALTY_REASONS),
  /** 공고와 무관한 경고도 있을 수 있다 */
  jobPostId: z.string().nullable(),
  occurredAt: z.iso.datetime(),
});

/** 제재 한 건. 해제됐으면 해제 시각이 있다 (#33) */
export const adminMemberSuspensionSchema = z.object({
  id: z.string(),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  releasedAt: z.iso.datetime().nullable(),
});

/**
 * 회원 상세. AC5가 요구하는 다섯 덩이가 그대로 필드다.
 *
 * **한 번에 준다.** 화면이 덩이마다 따로 부르면 상세 한 번에 여섯 번을
 * 부른다 — #33·#35가 목록에서 내린 판단과 같다.
 */
export const adminMemberDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  joinedAt: z.iso.datetime(),
  status: z.enum(ADMIN_MEMBER_STATUSES),
  /** 가입 주소. 주소를 아직 안 넣은 회원이 있을 수 있어 nullable이다 */
  address: z
    .object({
      sido: z.string(),
      sigungu: z.string(),
      roadAddress: z.string(),
    })
    .nullable(),
  asPoster: roleRatingSchema,
  asWorker: roleRatingSchema,
  reviews: z.array(adminMemberReviewSchema),
  jobPosts: z.array(adminMemberJobPostSchema),
  applications: z.array(adminMemberApplicationSchema),
  /** **원장 합이다** (`ADR-PAY-1`). `cachedBalance`를 그대로 내지 않는다 */
  pointBalance: z.number().int(),
  ledger: z.array(adminMemberLedgerEntrySchema),
  penalties: z.array(adminMemberPenaltySchema),
  suspensions: z.array(adminMemberSuspensionSchema),
});

export type AdminMemberDetail = z.infer<typeof adminMemberDetailSchema>;
