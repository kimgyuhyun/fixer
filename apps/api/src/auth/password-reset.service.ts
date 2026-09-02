import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { hash } from 'bcrypt';
import {
  PASSWORD_RESET_ERRORS,
  PASSWORD_RESET_RULES,
  SIGNUP_RULES,
  passwordSchema,
  type PasswordResetErrorCode,
} from '@fixer/shared';
import { type AuthUserStore, type RefreshTokenStore } from './login.service';
import { type MailProvider } from './email-verification.service';

/** 재설정 토큰 한 줄 */
export interface PasswordResetRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface PasswordResetStore {
  create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<PasswordResetRecord | null>;
  consume(id: string, at: Date): Promise<void>;
}

/** 재설정이 던지는 도메인 에러 */
export class PasswordResetError extends Error {
  constructor(readonly code: PasswordResetErrorCode) {
    super(code);
    this.name = 'PasswordResetError';
  }
}

/**
 * 비밀번호 재설정. (이슈 #6, `spec-fixed.md` §2.4)
 *
 * 마이페이지 변경은 아예 만들지 않고 재설정만 연다.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly users: AuthUserStore,
    private readonly resets: PasswordResetStore,
    private readonly refreshTokens: RefreshTokenStore,
    private readonly mail: MailProvider,
  ) {}

  /**
   * 재설정 메일을 요청한다.
   *
   * **회원이 없어도 성공으로 응답한다.** 없다고 알려주면 이메일만 넣어보고
   * 가입 여부를 알아낼 수 있다.
   */
  async requestReset(email: string, now: Date): Promise<void> {
    // 가입(#2)이 소문자로 저장하므로 같은 기준으로 찾는다
    const user = await this.users.findByEmail(email.toLowerCase());

    // 회원이 없어도 여기서 조용히 끝낸다. 응답은 있을 때와 같다.
    if (!user) {
      return;
    }

    const token = randomBytes(32).toString('hex');
    await this.resets.create({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + EXPIRY_MS),
    });

    await this.mail.sendPasswordResetLink(user.email, token);
  }

  /** 새 비밀번호를 설정한다. 토큰을 소비하고 그 회원의 Refresh를 전부 지운다 */
  async resetPassword(
    input: { token: string; newPassword: string },
    now: Date,
  ): Promise<void> {
    // 비밀번호 규칙을 먼저 본다. 토큰을 소비하기 전에 걸러야 규칙에 걸린
    // 요청이 1회용 토큰을 태우지 않는다.
    const newPassword = passwordSchema.parse(input.newPassword);

    const row = await this.resets.findByTokenHash(hashToken(input.token));

    // 없거나·이미 썼거나·만료됐거나 — 셋을 구분해 알려주지 않는다.
    // 사용자가 할 일은 어느 쪽이든 "다시 요청하기"로 같다.
    if (
      !row ||
      row.consumedAt !== null ||
      row.expiresAt.getTime() <= now.getTime()
    ) {
      throw new PasswordResetError(PASSWORD_RESET_ERRORS.TOKEN_INVALID);
    }

    await this.users.updatePasswordHash(
      row.userId,
      await hash(newPassword, SIGNUP_RULES.bcryptCostFactor),
    );
    await this.resets.consume(row.id, now);

    // spec-fixed §2.4 — 그 기기만이 아니라 전부다. 비밀번호가 털린 상황이다.
    await this.refreshTokens.deleteAllForUser(row.userId);
  }
}

const EXPIRY_MS = PASSWORD_RESET_RULES.expiryMinutes * 60 * 1000;

/**
 * 토큰을 해시로 저장한다. `RefreshToken.tokenHash`(#4)와 같은 방식이다.
 *
 * bcrypt가 아닌 이유는 두 가지다 — 32바이트 난수라 사전 공격이 성립하지 않고,
 * `tokenHash`가 조회 키라서 같은 입력이 항상 같은 해시가 되어야 찾을 수 있다.
 */
function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
