import { Injectable } from '@nestjs/common';
import type {
  AdminSuspensionFilter,
  AdminSuspensionList,
  PenaltyReason,
  ReleaseSuspensionResult,
} from '@fixer/shared';
import type { NotificationPublisher } from '../notification/notification.service';

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
  list(filter: AdminSuspensionFilter): Promise<AdminSuspensionList> {
    throw new Error('not implemented');
  }

  /** 사유를 남기고 조기 해제한다. 사유 없는 해제는 막힌다 (§11.4) */
  release(input: {
    adminId: string;
    suspensionId: string;
    reason: string;
  }): Promise<ReleaseSuspensionResult> {
    throw new Error('not implemented');
  }
}
