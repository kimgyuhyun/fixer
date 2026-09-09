import { Injectable } from '@nestjs/common';
import {
  ADMIN_ERRORS,
  ADMIN_MEMBER_PAGE_SIZE,
  memberStatusOf,
  type AdminMemberDetail,
  type AdminMemberFilter,
  type AdminMemberList,
  type AdminMemberSummary,
  type ApplicationStatus,
  type JobPostStatus,
  type PenaltyReason,
  type PointTransactionType,
  type RatingRole,
} from '@fixer/shared';
import { AdminError } from './admin-job-post.service';

/**
 * 목록 한 줄에 필요한 것들. (이슈 #32, `spec-fixed.md` §11.3)
 *
 * 평점 캐시와 경고 집계를 **함께** 조인해서 온다. 목록을 그린 뒤 화면이 따로
 * 부르면 한 페이지에 스무 번을 더 부른다 (#33·#35와 같은 판단).
 */
export interface AdminMemberRow {
  id: string;
  name: string;
  email: string;
  joinedAt: Date;
  /** 상태 계산의 재료 하나 (`ADR-AUTH-3`). 상태 컬럼은 없다 */
  deactivatedAt: Date | null;
  /** 상태 계산의 재료 둘. §5.1의 조건으로 저장소가 판정해서 준다 */
  hasActiveSuspension: boolean;
  ratingAsPoster: number | null;
  ratingAsPosterCount: number;
  ratingAsWorker: number | null;
  ratingAsWorkerCount: number;
  /** 180일 창 안 경고 수 (§5). 창 밖까지 세면 #33의 숫자와 어긋난다 */
  penaltyCount: number;
}

/** 상세 한 건. 목록 한 줄에 AC5가 요구하는 다섯 덩이를 더한 모양이다 */
export interface AdminMemberDetailRow extends AdminMemberRow {
  address: { sido: string; sigungu: string; roadAddress: string } | null;
  reviews: {
    id: string;
    score: number;
    rateeRole: RatingRole;
    raterName: string;
    jobPostTitle: string;
    createdAt: Date;
  }[];
  jobPosts: {
    id: string;
    title: string;
    status: JobPostStatus;
    createdAt: Date;
  }[];
  applications: {
    id: string;
    jobPostId: string;
    jobPostTitle: string;
    status: ApplicationStatus;
    createdAt: Date;
  }[];
  /** **원장 합이다** (`ADR-PAY-1`). `cachedBalance`를 그대로 내지 않는다 */
  pointBalance: number;
  ledger: {
    id: string;
    type: PointTransactionType;
    amount: number;
    createdAt: Date;
  }[];
  penalties: {
    id: string;
    reason: PenaltyReason;
    jobPostId: string | null;
    occurredAt: Date;
  }[];
  suspensions: {
    id: string;
    startAt: Date;
    endAt: Date;
    releasedAt: Date | null;
  }[];
}

/**
 * 회원 조회 저장소. **쓰기가 없다** — 이 이슈는 읽기 전용이다.
 *
 * 관리자 화면에서 회원 정보를 직접 고치는 기능은 PRD §4가 명시적으로 뺐다.
 */
export interface AdminMemberStore {
  list(
    filter: AdminMemberFilter,
    pageSize: number,
    now: Date,
  ): Promise<{ items: AdminMemberRow[]; total: number }>;

  /** 없으면 `null`. 서비스가 에러로 바꾼다 */
  findDetail(userId: string, now: Date): Promise<AdminMemberDetailRow | null>;
}

/** 관리자의 회원 조회. (이슈 #32, `spec-fixed.md` §11.3) */
@Injectable()
export class AdminMemberService {
  constructor(private readonly store: AdminMemberStore) {}

  /** 비활성화 회원도 사라지지 않는다. 상태로 구분해서 함께 준다 (AC4) */
  async list(filter: AdminMemberFilter): Promise<AdminMemberList> {
    const { items, total } = await this.store.list(
      filter,
      ADMIN_MEMBER_PAGE_SIZE,
      new Date(),
    );

    return {
      items: items.map(toSummary),
      total,
      page: filter.page,
      pageSize: ADMIN_MEMBER_PAGE_SIZE,
    };
  }

  /** @throws AdminError(`ADMIN_MEMBER_NOT_FOUND`) */
  async detail(userId: string): Promise<AdminMemberDetail> {
    const row = await this.store.findDetail(userId, new Date());
    if (row === null) {
      throw new AdminError(ADMIN_ERRORS.MEMBER_NOT_FOUND);
    }

    return {
      ...toSummaryWithoutPenalty(row),
      address: row.address,
      reviews: row.reviews.map((review) => ({
        id: review.id,
        score: review.score,
        rateeRole: review.rateeRole,
        raterName: review.raterName,
        jobPostTitle: review.jobPostTitle,
        createdAt: review.createdAt.toISOString(),
      })),
      jobPosts: row.jobPosts.map((post) => ({
        id: post.id,
        title: post.title,
        status: post.status,
        createdAt: post.createdAt.toISOString(),
      })),
      applications: row.applications.map((application) => ({
        id: application.id,
        jobPostId: application.jobPostId,
        jobPostTitle: application.jobPostTitle,
        status: application.status,
        createdAt: application.createdAt.toISOString(),
      })),
      pointBalance: row.pointBalance,
      ledger: row.ledger.map((entry) => ({
        id: entry.id,
        type: entry.type,
        amount: entry.amount,
        createdAt: entry.createdAt.toISOString(),
      })),
      penalties: row.penalties.map((penalty) => ({
        id: penalty.id,
        reason: penalty.reason,
        jobPostId: penalty.jobPostId,
        occurredAt: penalty.occurredAt.toISOString(),
      })),
      suspensions: row.suspensions.map((suspension) => ({
        id: suspension.id,
        startAt: suspension.startAt.toISOString(),
        endAt: suspension.endAt.toISOString(),
        releasedAt: suspension.releasedAt?.toISOString() ?? null,
      })),
    };
  }
}

/** 상세와 목록이 함께 쓰는 여섯 칸. 경고 수는 목록에만 있다 */
function toSummaryWithoutPenalty(
  row: AdminMemberRow,
): Omit<AdminMemberSummary, 'penaltyCount'> {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    joinedAt: row.joinedAt.toISOString(),
    asPoster: { average: row.ratingAsPoster, count: row.ratingAsPosterCount },
    asWorker: { average: row.ratingAsWorker, count: row.ratingAsWorkerCount },
    // **상태 컬럼이 없다** (`ADR-AUTH-3`). 두 재료에서 계산한다
    status: memberStatusOf(row),
  };
}

function toSummary(row: AdminMemberRow): AdminMemberSummary {
  return { ...toSummaryWithoutPenalty(row), penaltyCount: row.penaltyCount };
}
