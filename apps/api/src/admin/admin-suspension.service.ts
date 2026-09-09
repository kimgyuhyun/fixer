import { Injectable } from '@nestjs/common';
import {
  ADMIN_ERRORS,
  ADMIN_SUSPENSION_PAGE_SIZE,
  type AdminSuspensionFilter,
  type AdminSuspensionList,
  type AdminSuspensionSummary,
  type PenaltyReason,
  type ReleaseSuspensionResult,
} from '@fixer/shared';
import type { NotificationPublisher } from '../notification/notification.service';
import { AdminError } from './admin-job-post.service';

/** 블랙리스트 한 줄에 필요한 것들. 이름과 경고 집계를 조인해서 함께 온다 */
export interface AdminSuspensionRow {
  id: string;
  userId: string;
  userName: string;
  startAt: Date;
  endAt: Date;
  /** 180일 창 안 경고 사유들 (§11.4 "사유 요약") */
  reasons: PenaltyReason[];
  /** 180일 창 안 누적 경고 수 */
  penaltyCount: number;
}

/** 해제된 제재 한 건 */
export interface ReleasedSuspension {
  id: string;
  userId: string;
  releasedAt: Date;
  releasedBy: string;
}

/**
 * 블랙리스트 저장소. (이슈 #33, `spec-fixed.md` §11.4)
 *
 * **새 테이블이 없다** — 블랙리스트는 `Suspension` 조회의 다른 이름이다 (§5.1).
 */
export interface AdminSuspensionStore {
  /**
   * 지금 유효한 제재 한 페이지. **`activeSuspensionWhere`와 같은 조건이다**
   * (`releasedAt IS NULL AND endAt > now()`).
   *
   * 이름과 180일 창 안 경고 집계를 **함께** 준다. 목록을 그린 뒤 화면이 따로
   * 부르면 한 페이지에 스무 번을 더 부른다 (#35와 같은 판단).
   */
  listActive(
    filter: AdminSuspensionFilter,
    pageSize: number,
    now: Date,
  ): Promise<{ items: AdminSuspensionRow[]; total: number }>;

  /**
   * 조건부 해제. **`releasedAt IS NULL`인 행만 갱신한다.**
   *
   * 감사 로그를 **같은 트랜잭션에** 남긴다 (§11.5). 뒤에 따로 쓰면 그 사이에
   * 죽었을 때 "풀렸는데 누가 풀었는지 없는" 상태가 남는다.
   *
   * `'STALE'`을 돌려주는 #16의 `cancelAndRelease`와 같은 모양이다.
   */
  release(input: {
    suspensionId: string;
    adminId: string;
    reason: string;
    now: Date;
  }): Promise<ReleasedSuspension | 'NOT_FOUND' | 'ALREADY_RELEASED'>;
}

/**
 * 관리자의 제재 관리. (이슈 #33, `spec-fixed.md` §5.1 §11.4)
 *
 * **`Penalty`를 건드리지 않는다** (§5.1). 경고 이력은 분쟁 대응 근거라 남는다 —
 * 이 서비스가 쓰는 것은 `Suspension`의 세 칸뿐이다.
 */
@Injectable()
export class AdminSuspensionService {
  constructor(
    private readonly store: AdminSuspensionStore,
    /** 해제 사실을 당사자에게 알린다 (§11.4). 포트만 본다 (ADR-NOT-1) */
    private readonly notifications: NotificationPublisher,
  ) {}

  /** 현재 제재 중인 회원만. 만료된 건도 해제된 건도 나오지 않는다 */
  async list(filter: AdminSuspensionFilter): Promise<AdminSuspensionList> {
    const { items, total } = await this.store.listActive(
      filter,
      ADMIN_SUSPENSION_PAGE_SIZE,
      new Date(),
    );

    return {
      items: items.map(toSummary),
      total,
      page: filter.page,
      pageSize: ADMIN_SUSPENSION_PAGE_SIZE,
    };
  }

  /** 사유를 남기고 조기 해제한다. 사유 없는 해제는 막힌다 (§11.4) */
  async release(input: {
    adminId: string;
    suspensionId: string;
    reason: string;
  }): Promise<ReleaseSuspensionResult> {
    const reason = input.reason.trim();
    // 사유 검증이 가장 먼저다. 사유 없는 조치는 저장소도 알림도 건드리지 않는다.
    if (reason === '') {
      throw new AdminError(ADMIN_ERRORS.REASON_REQUIRED);
    }

    const released = await this.store.release({
      suspensionId: input.suspensionId,
      adminId: input.adminId,
      reason,
      now: new Date(),
    });

    if (released === 'NOT_FOUND') {
      throw new AdminError(ADMIN_ERRORS.SUSPENSION_NOT_FOUND);
    }
    if (released === 'ALREADY_RELEASED') {
      // 두 번 풀면 감사 로그가 두 줄 남고 알림도 두 번 간다. 동시에 두
      // 관리자가 눌렀을 때 진 쪽도 여기로 온다.
      throw new AdminError(ADMIN_ERRORS.SUSPENSION_ALREADY_RELEASED);
    }

    // 트랜잭션 밖이다. 발행은 던지지 않으므로(ADR-NOT-1) 이 줄이 해제를
    // 되돌리지 않는다 — #25의 제재 발생 알림과 같은 자리다.
    await this.notifications.publish({
      userId: released.userId,
      type: 'SUSPENSION_RELEASED',
      title: '이용 제한이 해제되었습니다',
      body: '관리자가 제재를 해제했습니다. 공고 등록과 지원을 다시 할 수 있습니다.',
      // 제재 이력 화면은 아직 없다(#32). 없는 경로를 넣지 않는다 — #25와 같다.
      linkUrl: '/my/account',
    });

    return {
      id: released.id,
      userId: released.userId,
      releasedAt: released.releasedAt.toISOString(),
      releasedBy: released.releasedBy,
    };
  }
}

function toSummary(row: AdminSuspensionRow): AdminSuspensionSummary {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    reasons: row.reasons,
    penaltyCount: row.penaltyCount,
  };
}
