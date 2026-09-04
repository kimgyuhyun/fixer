import { z } from 'zod';
import { CHARGE_UNIT } from './payment.js';

/** 공고 상태. (`spec-fixed.md` §3.3) */
export const JOB_POST_STATUSES = [
  /** 작성 중. 포인트 잠금 전 */
  'DRAFT',
  /** 모집 중. 포인트 HOLD 완료 */
  'OPEN',
  /** 모집 마감 (정원 충족 또는 시작 시각 도달) */
  'CLOSED',
  /** 업무 완료 확인됨. PAYOUT 실행됨 */
  'COMPLETED',
  /** 구인자 취소 */
  'CANCELLED',
  /** 미달 상태로 시작 시각 경과 */
  'EXPIRED',
] as const;

export type JobPostStatus = (typeof JOB_POST_STATUSES)[number];

/**
 * 허용된 상태 전이. (`ADR-JOB-3`)
 *
 * **표에 없는 전이는 거부된다.** 메서드마다 분기를 흩뿌리면 "지금 어떤
 * 전이가 허용되는가"를 한눈에 볼 수 없고, 새 상태를 넣을 때 빠뜨리는
 * 곳이 생긴다.
 *
 * guard는 판정만 하고 **부수 효과는 호출부에 둔다** — 표가 선언적이라는
 * 인상과 실제 동작이 어긋나지 않게 하기 위해서다.
 */
export const JOB_POST_TRANSITIONS = [
  { from: 'DRAFT', to: 'OPEN' },
  { from: 'OPEN', to: 'CLOSED' },
  { from: 'OPEN', to: 'CANCELLED' },
  { from: 'OPEN', to: 'EXPIRED' },
  { from: 'CLOSED', to: 'COMPLETED' },
  { from: 'CLOSED', to: 'CANCELLED' },
] as const satisfies readonly { from: JobPostStatus; to: JobPostStatus }[];

/** 이 전이가 표에 있나 */
export function canTransition(from: JobPostStatus, to: JobPostStatus): boolean {
  return JOB_POST_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

/**
 * 버전을 올리는 필드 6개. (`spec-fixed.md` §3.4)
 *
 * **여기에 필드를 더하면 #15의 테스트도 함께 늘려야 한다.** `ADR-JOB-2`가
 * 그 위험을 알고도 이 방식을 고른 이유는, 판정이 한 곳에 모여 있어야
 * 신청자가 모르는 사이 조건이 바뀌는 일을 막을 수 있기 때문이다.
 */
export const JOB_POST_REQUIRED_FIELDS = [
  'workAddress',
  'workStartAt',
  'workEndAt',
  'headcount',
  'rewardPerPerson',
  'requiredDescription',
] as const;

/** 공고가 내는 에러 코드 */
export const JOB_POST_ERRORS = {
  /** 예산이 잔액보다 크다. 부족 금액을 함께 안내한다 */
  INSUFFICIENT_BALANCE: 'POINT_INSUFFICIENT_BALANCE',
  /** 근무 주소를 비웠는데 가입 주소도 없다 */
  NO_DEFAULT_ADDRESS: 'JOB_POST_NO_DEFAULT_ADDRESS',
  /** 그런 공고가 없다 */
  NOT_FOUND: 'JOB_POST_NOT_FOUND',
  /** 본인 공고가 아니다 */
  NOT_OWNED: 'JOB_POST_NOT_OWNED',
  /** 표에 없는 상태 전이다 (ADR-JOB-3) */
  INVALID_TRANSITION: 'JOB_POST_INVALID_TRANSITION',
} as const;

export type JobPostErrorCode =
  (typeof JOB_POST_ERRORS)[keyof typeof JOB_POST_ERRORS];

/** 한 번에 모집할 수 있는 최대 인원. 오타로 999를 넣는 것을 막는다 */
export const JOB_POST_MAX_HEADCOUNT = 50;

/**
 * 공고 등록 요청.
 *
 * `workAddress`는 **비워 보낼 수 있다.** 그러면 서버가 가입 주소로 채운다 —
 * 화면이 채우면 주소를 바꾼 사용자가 옛 값을 보낼 수 있고, 서버는 그게
 * 기본값인지 사용자가 고른 값인지 구분할 방법이 없다.
 */
export const createJobPostRequestSchema = z
  .object({
    categoryId: z.string().min(1, { error: '카테고리를 골라 주세요.' }),
    title: z
      .string()
      .trim()
      .min(1, { error: '제목을 입력해 주세요.' })
      .max(80, { error: '제목은 80자까지 쓸 수 있습니다.' }),
    workAddress: z.string().trim().optional(),
    /**
     * 지역. **주소를 직접 보내면 이것도 함께 보내야 한다** (#13).
     *
     * 주소 문자열에서 뽑아내면 파싱이 틀린 공고가 조용히 지역 필터에서
     * 사라진다. #3의 우편번호 팝업이 둘을 함께 주므로 화면이 못 채울 일은 없다.
     */
    workSido: z.string().trim().optional(),
    workSigungu: z.string().trim().optional(),
    workStartAt: z.iso.datetime({ error: '근무 시작 일시를 골라 주세요.' }),
    workEndAt: z.iso.datetime({ error: '근무 종료 일시를 골라 주세요.' }),
    headcount: z
      .number()
      .int({ error: '모집 인원은 정수여야 합니다.' })
      .min(1, { error: '한 명 이상 모집해야 합니다.' })
      .max(JOB_POST_MAX_HEADCOUNT, {
        error: `한 번에 ${JOB_POST_MAX_HEADCOUNT}명까지 모집할 수 있습니다.`,
      }),
    rewardPerPerson: z
      .number()
      .int({ error: '보상금은 정수여야 합니다.' })
      .positive({ error: '보상금을 입력해 주세요.' })
      .refine((v) => v % CHARGE_UNIT === 0, {
        error: '보상금은 1,000원 단위로 정해 주세요.',
      }),
    requiredDescription: z
      .string()
      .trim()
      .min(1, { error: '상세 내용을 입력해 주세요.' }),
  })
  // 종료가 시작보다 이르면 근무 시간이 음수가 된다.
  .refine((v) => new Date(v.workEndAt) > new Date(v.workStartAt), {
    error: '근무 종료는 시작보다 뒤여야 합니다.',
    path: ['workEndAt'],
  })
  // 주소를 직접 정했으면 지역도 정해야 한다. 없으면 그 공고는 지역
  // 필터에서 조용히 빠져 아무에게도 안 보인다.
  .refine((v) => (v.workAddress ?? '') === '' || (v.workSido ?? '') !== '', {
    error: '주소를 직접 입력하면 시/도도 함께 골라 주세요.',
    path: ['workSido'],
  });

export type CreateJobPostRequest = z.infer<typeof createJobPostRequestSchema>;

/** 목록과 등록 응답이 함께 쓰는 모양 */
export const jobPostSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  categoryId: z.string(),
  status: z.enum(JOB_POST_STATUSES),
  version: z.number().int(),
  workAddress: z.string(),
  workSido: z.string(),
  workSigungu: z.string(),
  workStartAt: z.iso.datetime(),
  workEndAt: z.iso.datetime(),
  headcount: z.number().int(),
  rewardPerPerson: z.number().int(),
  /** 잠긴 예산. `headcount × rewardPerPerson`이다 */
  budget: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type JobPostSummary = z.infer<typeof jobPostSummarySchema>;

/**
 * 공고 상세. 목록 요약에 내용·카테고리 이름·확정 인원이 더 붙는다. (#14)
 *
 * 카테고리 이름을 함께 주는 이유는, 화면이 다시 조회해 id를 이름으로 바꾸면
 * 요청이 두 번 나가고 그 사이에 이름이 늦게 채워지는 깜빡임이 생기기 때문이다.
 */
export const jobPostDetailSchema = jobPostSummarySchema.extend({
  categoryName: z.string(),
  requiredDescription: z.string(),
  /** 수락된 신청 수. 화면에 `수락 / 모집`으로 보인다 */
  acceptedCount: z.number().int(),
});
export type JobPostDetail = z.infer<typeof jobPostDetailSchema>;

/** 한 페이지에 몇 건. 관리자 목록도 같은 값을 쓴다 (§11.2) */
export const JOB_POST_PAGE_SIZE = 20;

/**
 * 목록 필터. **URL 쿼리스트링이 이 모양 그대로다** (ADR-JOB-4).
 *
 * 필터 상태의 진실은 URL 하나다. 컴포넌트가 따로 들고 있으면 뒤로가기에서
 * 둘이 어긋난다.
 */
export const jobPostFilterSchema = z.object({
  category: z.string().trim().min(1).optional(),
  sido: z.string().trim().min(1).optional(),
  sigungu: z.string().trim().min(1).optional(),
  /** 제목 부분 일치. 상세 내용은 안 뒤진다 (ADR-JOB-5) */
  q: z.string().trim().min(1).optional(),
  /** 1부터. 범위를 넘으면 오류가 아니라 빈 목록이다 */
  page: z.coerce.number().int().min(1).catch(1).default(1),
});
export type JobPostFilter = z.infer<typeof jobPostFilterSchema>;

/** 목록 응답. 총 건수를 함께 준다 (ADR-JOB-5 오프셋 페이징) */
export const jobPostListSchema = z.object({
  items: z.array(jobPostSummarySchema),
  /** **필터를 적용한 뒤의** 건수. 전체를 주면 "총 152건인데 3건만 보이는" 화면이 된다 */
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type JobPostList = z.infer<typeof jobPostListSchema>;

/**
 * 필터를 URL 쿼리스트링으로. 빈 값은 아예 넣지 않는다 — 링크가 지저분해진다.
 *
 * `page=1`도 넣지 않는다. 첫 페이지가 기본값이라 넣으면 같은 화면을 가리키는
 * 주소가 두 개가 되고, 뒤로가기가 한 번 더 필요해진다.
 */
export function filterToQuery(filter: JobPostFilter): string {
  const pairs: [string, string][] = [];
  if (filter.category) pairs.push(['category', filter.category]);
  if (filter.sido) pairs.push(['sido', filter.sido]);
  if (filter.sigungu) pairs.push(['sigungu', filter.sigungu]);
  if (filter.q) pairs.push(['q', filter.q]);
  if (filter.page > 1) pairs.push(['page', String(filter.page)]);

  return pairs
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/** 예산. 이 계산이 여러 곳에 흩어지면 한 곳만 틀려도 돈이 어긋난다 */
export function budgetOf(input: {
  headcount: number;
  rewardPerPerson: number;
}): number {
  return input.headcount * input.rewardPerPerson;
}

/** 공고 예산 잠금의 멱등 키. 같은 공고는 한 번만 잠근다 */
export function holdIdempotencyKey(jobPostId: string, version: number): string {
  return `hold:${jobPostId}:${version}`;
}
