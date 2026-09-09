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
 * 유효 제재를 가리는 조건. **§5.1의 `releasedAt IS NULL AND endAt > now()`다.**
 *
 * 판정을 쓰는 곳이 셋이다 — 중복 제재 방지, `PrismaSuspensionReader`(차단
 * 판정), 그리고 블랙리스트 목록(#33). 같은 규칙을 세 번 적으면 한 곳만
 * 고쳐지는 날이 온다.
 */
export function activeSuspensionAtWhere(now: Date): {
  releasedAt: null;
  endAt: { gt: Date };
} {
  return { releasedAt: null, endAt: { gt: now } };
}

/** 위 조건을 회원 한 명으로 좁힌 것 */
export function activeSuspensionWhere(
  userId: string,
  now: Date,
): { userId: string; releasedAt: null; endAt: { gt: Date } } {
  return { userId, ...activeSuspensionAtWhere(now) };
}

/** `SuspensionRecord`가 필요로 하는 칸. 두 조회가 같은 모양을 돌려준다 */
export const SUSPENSION_FIELDS = {
  id: true,
  userId: true,
  startAt: true,
  endAt: true,
  releasedAt: true,
} as const;

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
    where: activeSuspensionWhere(input.userId, input.now),
  });
  if (current !== null) return null;

  return await tx.suspension.create({
    data: {
      userId: input.userId,
      startAt: input.now,
      endAt: suspensionEndAt(input.now),
    },
    select: SUSPENSION_FIELDS,
  });
}
