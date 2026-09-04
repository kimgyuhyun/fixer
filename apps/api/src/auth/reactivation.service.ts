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
import type { EmailVerificationChecker, UserRecord } from './signup.service';

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
    private readonly verification: EmailVerificationChecker,
  ) {}

  async reactivate(input: ReactivateRequest): Promise<SignedUp> {
    const { email, password } = reactivateRequestSchema.parse(input);
    const normalizedEmail = email.toLowerCase();

    // 인증을 먼저 본다. 메일함을 쥐고 있다는 증명이 없으면 그 이메일로
    // 계정이 있는지조차 알려주지 않는다.
    if (!(await this.verification.isVerified(normalizedEmail))) {
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
