import {
  penaltyWindowStart,
  shouldSuspend,
  suspensionEndAt,
  type PenaltyReason,
} from '@fixer/shared';
import type { Prisma } from '../generated/prisma/client';

/** 저장된 제재 한 건 */
export interface SuspensionRecord {
  id: string;
  userId: string;
  startAt: Date;
  endAt: Date;
  /** 관리자가 조기 종료한 시각 (#33). 아직이면 null */
  releasedAt: Date | null;
}

/**
 * 경고 1건을 쓰고, **그 자리에서** 제재 여부를 판정한다. (이슈 #25, §5)
 *
 * `point/job-post-lock.ts`와 같은 자리다 — 남의 트랜잭션 안에서 도는 헬퍼라
 * `tx`를 받는다. 경고 삽입과 판정을 나누면 `Penalty` 5건은 커밋됐는데
 * `Suspension`이 없는 상태가 남고, **그걸 고쳐 줄 배치가 없다** (§8.1).
 *
 * 새로 만든 제재를 돌려준다. 창 안 건수가 모자라거나 이미 제재 중이면 `null`이다 —
 * 호출부는 이 값으로 제재 발생 알림을 보낼지 정한다.
 */
export async function recordPenalty(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    reason: PenaltyReason;
    jobPostId: string | null;
    now: Date;
  },
): Promise<SuspensionRecord | null> {
  await tx.penalty.create({
    data: {
      userId: input.userId,
      reason: input.reason,
      jobPostId: input.jobPostId,
      occurredAt: input.now,
    },
  });

  const recent = await tx.penalty.count({
    where: {
      userId: input.userId,
      occurredAt: { gte: penaltyWindowStart(input.now) },
    },
  });
  if (!shouldSuspend(recent)) return null;

  // 이미 제재 중이면 하나 더 만들지 않는다. 겹치면 5일이 10일이 된다 —
  // 규칙은 5건 → 5일 하나뿐이다 (PRD Out of Scope: 단계별 차등 없음).
  const current = await tx.suspension.findFirst({
    where: { userId: input.userId, releasedAt: null, endAt: { gt: input.now } },
  });
  if (current !== null) return null;

  return await tx.suspension.create({
    data: {
      userId: input.userId,
      startAt: input.now,
      endAt: suspensionEndAt(input.now),
    },
    select: {
      id: true,
      userId: true,
      startAt: true,
      endAt: true,
      releasedAt: true,
    },
  });
}
