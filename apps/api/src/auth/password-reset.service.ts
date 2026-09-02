import { Injectable } from '@nestjs/common';
import { type PasswordResetErrorCode } from '@fixer/shared';
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
  async requestReset(_email: string, _now: Date): Promise<void> {
    throw new Error('not implemented');
  }

  /** 새 비밀번호를 설정한다. 토큰을 소비하고 그 회원의 Refresh를 전부 지운다 */
  async resetPassword(
    _input: { token: string; newPassword: string },
    _now: Date,
  ): Promise<void> {
    throw new Error('not implemented');
  }
}
