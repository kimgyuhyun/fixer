import { Injectable } from '@nestjs/common';
import {
  WITHDRAWAL_BLOCKERS,
  WITHDRAWAL_ERRORS,
  type WithdrawalBlocker,
} from '@fixer/shared';
import type { PointLedgerStore } from '../point/point-ledger.service';
import type { RefreshTokenStore } from './login.service';

export interface WithdrawalMemberStore {
  /** 없는 회원이면 `undefined`, 활성이면 `null`, 비활성이면 그 시각 */
  findDeactivatedAt(userId: string): Promise<Date | null | undefined>;
  deactivate(userId: string, at: Date): Promise<void>;
}

/**
 * 탈퇴 보류 조건 중 **다른 도메인에 물어야 하는 것**.
 *
 * `Application`(#17)과 `JobPost`(#12) 모델이 아직 없다. 포트를 지금 만들고
 * 구현체는 `false`를 돌려주다가, 그 이슈가 들어오면 진짜로 센다. 모델이
 * 생길 때까지 기다리면 #9가 A 몫의 끝까지 밀린다.
 */
export interface WithdrawalGuard {
  hasActiveContract(userId: string): Promise<boolean>;
  hasOpenJobPost(userId: string): Promise<boolean>;
}

/** 그 id의 회원이 없다. 404로 나간다 */
export class MemberNotFoundError extends Error {
  readonly code = WITHDRAWAL_ERRORS.NOT_FOUND;
  constructor() {
    super(WITHDRAWAL_ERRORS.NOT_FOUND);
    this.name = 'MemberNotFoundError';
  }
}

/** 탈퇴가 막혔다. **사유를 전부 담는다** — 하나씩 알려주면 세 번 반복하게 된다 */
export class WithdrawalBlockedError extends Error {
  readonly code = WITHDRAWAL_ERRORS.BLOCKED;
  constructor(readonly reasons: WithdrawalBlocker[]) {
    super(WITHDRAWAL_ERRORS.BLOCKED);
    this.name = 'WithdrawalBlockedError';
  }
}

/**
 * 탈퇴. (이슈 #9, `spec-fixed.md` §2.6)
 *
 * **물리 삭제하지 않는다.** `deactivatedAt`을 찍는 것이 전부이고, 개인정보
 * 파기는 4개월 뒤 배치(#39)가 한다. 상태 컬럼을 따로 두지 않는 이유는
 * `ADR-AUTH-3`에 있다 — 두 벌이 되면 어긋날 수 있다.
 */
@Injectable()
export class WithdrawalService {
  constructor(
    private readonly members: WithdrawalMemberStore,
    private readonly refreshTokens: RefreshTokenStore,
    private readonly ledger: PointLedgerStore,
    private readonly guard: WithdrawalGuard,
  ) {}

  async withdraw(userId: string, now: Date): Promise<void> {
    const deactivatedAt = await this.members.findDeactivatedAt(userId);
    if (deactivatedAt === undefined) {
      throw new MemberNotFoundError();
    }

    // 이미 탈퇴한 계정이면 **아무것도 하지 않고** 끝낸다. 다시 찍으면
    // 파기 기한(#39, 비활성 4개월)이 그만큼 미뤄져 개인정보가 더 오래 남는다.
    if (deactivatedAt !== null) {
      return;
    }

    const reasons = await this.blockersFor(userId);

    // 사유를 전부 모아서 던진다. 하나씩 알려주면 고치고 다시 시도하기를
    // 세 번 반복하게 된다.
    if (reasons.length > 0) {
      throw new WithdrawalBlockedError(reasons);
    }

    await this.members.deactivate(userId, now);
    // §2.6 — 비활성화 시 모든 Refresh 토큰 삭제. 다른 기기도 함께 끊는다.
    await this.refreshTokens.deleteAllForUser(userId);
  }

  /** 세 조건을 **모두** 확인한다. 하나 걸렸다고 나머지를 건너뛰지 않는다 */
  private async blockersFor(userId: string): Promise<WithdrawalBlocker[]> {
    const [contract, jobPost, balance] = await Promise.all([
      this.guard.hasActiveContract(userId),
      this.guard.hasOpenJobPost(userId),
      // 캐시가 아니라 원장 합계다 (ADR-PAY-1). 캐시가 틀렸는데 0인 줄 알고
      // 탈퇴시키면 돈이 묶인 채 계정이 잠긴다.
      this.ledger.sumBalance(userId),
    ]);

    const reasons: WithdrawalBlocker[] = [];
    if (contract) reasons.push(WITHDRAWAL_BLOCKERS.ACTIVE_CONTRACT);
    if (jobPost) reasons.push(WITHDRAWAL_BLOCKERS.OPEN_JOB_POST);
    if (balance > 0) reasons.push(WITHDRAWAL_BLOCKERS.POSITIVE_BALANCE);
    return reasons;
  }
}

/** 사유 목록을 만든다. 밖에서도 읽을 수 있게 둔다 */
export const WITHDRAWAL_REASONS = WITHDRAWAL_BLOCKERS;
