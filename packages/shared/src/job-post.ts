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
  workStartAt: z.iso.datetime(),
  workEndAt: z.iso.datetime(),
  headcount: z.number().int(),
  rewardPerPerson: z.number().int(),
  /** 잠긴 예산. `headcount × rewardPerPerson`이다 */
  budget: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type JobPostSummary = z.infer<typeof jobPostSummarySchema>;

/** 목록 응답. 총 건수를 함께 준다 (ADR-JOB-5 오프셋 페이징) */
export const jobPostListSchema = z.object({
  items: z.array(jobPostSummarySchema),
  total: z.number().int(),
});
export type JobPostList = z.infer<typeof jobPostListSchema>;

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
