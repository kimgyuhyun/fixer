import { Injectable } from '@nestjs/common';
import { hash } from 'bcrypt';
import {
  REACTIVATION_ERRORS,
  SIGNUP_RULES,
  reactivateRequestSchema,
  type ReactivateRequest,
  type ReactivationErrorCode,
  type SignedUp,
} from '@fixer/shared';
import type { UserRecord } from './signup.service';

/**
 * "**이번에** 인증을 마쳤는가"를 묻는 포트.
 *
 * 가입의 `EmailVerificationChecker`를 재사용하지 않는다. 그건 "언젠가
 * 인증한 적 있다"라서 최초 가입 때 남은 행 하나로 영구히 참이 된다.
 * 가입은 계정이 없을 때만 도는 1회성 경로라 그걸로 충분하지만, 되살리기는
 * **기존 계정에 새 비밀번호를 심는** 작업이라 같은 기준을 쓰면
 * 이메일 주소만 아는 사람이 남의 탈퇴 계정을 가져간다.
 */
export interface FreshVerificationChecker {
  isVerifiedSince(email: string, since: Date): Promise<boolean>;
}

/**
 * 되살리기가 인정하는 인증의 유효 시간.
 *
 * 비밀번호 재설정 토큰(#6)과 같은 30분이다. 두 경로가 주는 권한이 같으므로
 * 유효 시간도 같아야 한다 — 한쪽만 길면 공격자는 긴 쪽으로 온다.
 *
 * "탈퇴 시각 이후"로 잡을 수도 있었지만 그러려면 회원을 먼저 조회해야 하고,
 * 그러면 인증하지 않은 사람에게 "그 계정이 탈퇴 상태다"가 새어나간다.
 */
export const REACTIVATION_VERIFICATION_WINDOW_MS = 30 * 60 * 1000;

/** 재활성화가 내는 실패 */
export class ReactivationError extends Error {
  constructor(readonly code: ReactivationErrorCode) {
    super(code);
    this.name = 'ReactivationError';
  }
}

/**
 * 되살리기에 필요한 만큼만 여는 포트.
 *
 * `UserStore`를 넓히지 않고 따로 둔다 — 가입은 되살리기를 모르고,
 * 되살리기는 만들기를 모른다.
 */
export interface ReactivationStore {
  findByEmail(email: string): Promise<UserRecord | null>;
  /** `deactivatedAt`을 지우고 비밀번호를 갈아끼운다. **행은 그대로 둔다** */
  reactivate(userId: string, passwordHash: string): Promise<UserRecord>;
}

/**
 * 비활성화된 계정을 되살린다. (이슈 #10)
 *
 * **같은 행을 되살린다.** 새 행을 만들면 그 id를 참조하던 평점·경고가
 * 통째로 끊겨, 경고 4건 쌓인 사람의 탈퇴·재가입 세탁이 성공한다.
 */
@Injectable()
export class ReactivationService {
  constructor(
    private readonly members: ReactivationStore,
    private readonly verification: FreshVerificationChecker,
  ) {}

  async reactivate(input: ReactivateRequest, now: Date): Promise<SignedUp> {
    const { email, password } = reactivateRequestSchema.parse(input);
    const normalizedEmail = email.toLowerCase();

    // 인증을 먼저 본다. 지금 메일함을 쥐고 있다는 증명이 없으면 그 이메일로
    // 계정이 있는지, 탈퇴 상태인지조차 알려주지 않는다.
    const since = new Date(now.getTime() - REACTIVATION_VERIFICATION_WINDOW_MS);
    if (!(await this.verification.isVerifiedSince(normalizedEmail, since))) {
      throw new ReactivationError(REACTIVATION_ERRORS.EMAIL_NOT_VERIFIED);
    }

    const member = await this.members.findByEmail(normalizedEmail);
    // 없는 계정과 이미 활성인 계정을 같은 코드로 묶는다. 되살릴 것이
    // 없다는 점에서 같고, 나눠 봐야 사용자가 할 수 있는 일도 같다.
    if (!member || !member.deactivatedAt) {
      throw new ReactivationError(REACTIVATION_ERRORS.NOT_DEACTIVATED);
    }

    const passwordHash = await hash(password, SIGNUP_RULES.bcryptCostFactor);
    const revived = await this.members.reactivate(member.id, passwordHash);

    return {
      id: revived.id,
      email: revived.email,
      name: revived.name,
      createdAt: revived.createdAt.toISOString(),
    };
  }
}
