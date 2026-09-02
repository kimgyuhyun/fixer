import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { compare } from 'bcrypt';
import {
  AUTH_TOKEN_RULES,
  LOGIN_ERRORS,
  loginRequestSchema,
  type LoginErrorCode,
  type LoginRequest,
  type MyProfile,
  type SignedIn,
} from '@fixer/shared';
import type { UserRecord } from './signup.service';
import { AccessTokenSigner } from './access-token';

/**
 * 로그인·인증이 내는 실패. 코드로 분기하고 HTTP 상태 매핑은 컨트롤러에서만
 * 한다. 서비스는 HTTP를 모른다. (`SignupError`와 같은 모양)
 */
export class LoginError extends Error {
  constructor(readonly code: LoginErrorCode) {
    super(code);
    this.name = 'LoginError';
  }
}

/**
 * `RefreshToken` 한 행. ADR-AUTH-1의 "로그인 세션 하나"에 대응한다.
 */
export interface RefreshTokenRecord {
  id: string;
  userId: string;
  /** 평문 저장 금지. 유출돼도 토큰을 알 수 없어야 한다 */
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Refresh 토큰 저장소 포트.
 *
 * 회전(rotation)하지 않기로 했으므로(ADR-AUTH-1) 갱신용 메서드가 없다.
 * 로그인에서 만들고 갱신에서 읽는 것이 전부다. 삭제(로그아웃·전체 무효화)는
 * #5·#6이 자기 메서드를 들고 온다.
 */
export interface RefreshTokenStore {
  create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshTokenRecord>;

  findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** 로그아웃이 그 세션의 행 하나만 지운다 (ADR-AUTH-1) */
  deleteByTokenHash(tokenHash: string): Promise<void>;
}

/**
 * 로그인이 쓰는 회원 조회 포트.
 *
 * #2의 `UserStore`를 그대로 쓰지 않는 이유는 필요한 것이 다르기 때문이다 —
 * 가입은 `create`가, 로그인은 `findById`가 필요하다. 포트를 좁게 나누면
 * 각자의 가짜 저장소가 남의 메서드를 구현하지 않아도 된다.
 * (Prisma 구현체 `PrismaUserStore`는 두 포트를 함께 만족한다)
 */
export interface AuthUserStore {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
}

/** 로그인이 발급한 것. 컨트롤러가 이걸 쿠키 두 개로 옮긴다 */
export interface IssuedSession {
  user: SignedIn;
  accessToken: { value: string; expiresAt: Date };
  refreshToken: { value: string; expiresAt: Date };
}

/**
 * 인증 결과. `renewedAccessToken`이 있으면 컨트롤러가 쿠키를 다시 심는다.
 *
 * Refresh 토큰은 회전하지 않으므로 여기에 자리가 없다. (ADR-AUTH-1)
 */
export interface AuthenticatedSession {
  userId: string;
  renewedAccessToken?: { value: string; expiresAt: Date };
}

/** 요청이 들고 온 토큰 두 개. 없을 수 있다 */
export interface SessionCookies {
  accessToken?: string;
  refreshToken?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 추측할 수 없을 만큼 넉넉한 길이. 16진수 문자열로는 64자가 된다 */
const REFRESH_TOKEN_BYTES = 32;

/**
 * 그 이메일의 회원이 없을 때 대신 대조할 해시.
 *
 * 회원이 없다고 곧바로 거절하면, 없는 이메일은 bcrypt 연산 없이 즉시
 * 응답하고 틀린 비밀번호는 수백 밀리초를 쓴 뒤 응답한다. 에러 코드와 문구가
 * 같아도 **걸린 시간이 가입 여부를 알려준다** — AC2가 막으려는 바로 그
 * 노출이다. 그래서 회원이 없을 때도 같은 비용을 치르게 한다.
 *
 * 값은 아무도 모르는 32바이트 난수를 cost 12(가입이 쓰는 값, `SIGNUP_RULES`)로
 * 해시한 결과다. 어떤 비밀번호와도 일치하지 않으며 비밀값이 아니다 —
 * 원문을 만들어낸 쪽이 없으므로 이 해시를 알아도 할 수 있는 일이 없다.
 */
const ABSENT_MEMBER_PASSWORD_HASH =
  '$2b$12$qnLRrwhAZfQpjxhZ5xUFRuZ5XHLceWJDY65FgzwSNo6w.djgUaHde';

@Injectable()
export class LoginService {
  constructor(
    private readonly users: AuthUserStore,
    private readonly refreshTokens: RefreshTokenStore,
    private readonly accessTokens: AccessTokenSigner,
  ) {}

  /** 조회 → 비밀번호 대조 → 토큰 두 개 발급 → Refresh 행 추가 */
  async login(
    input: LoginRequest,
    now: Date = new Date(),
  ): Promise<IssuedSession> {
    const { email, password } = loginRequestSchema.parse(input);

    // 가입(#2)이 소문자로 정규화해서 저장한다. 여기서 맞춰주지 않으면
    // 대문자로 입력한 사람은 가입은 됐는데 로그인이 안 되는 상태가 된다.
    const user = await this.users.findByEmail(email.toLowerCase());

    // 없는 이메일과 틀린 비밀번호를 구분해서 알려주지 않는다. 구분하면
    // 이메일만 넣어보고 가입 여부를 알아낼 수 있다. (AC2)
    //
    // 회원이 없어도 대조를 건너뛰지 않는다. 건너뛰면 문구는 같은데 응답이
    // 눈에 띄게 빨라져서, 시간만 재도 가입 여부를 알 수 있게 된다.
    const passwordMatches = await compare(
      password,
      user?.passwordHash ?? ABSENT_MEMBER_PASSWORD_HASH,
    );
    if (!user || !passwordMatches) {
      throw new LoginError(LOGIN_ERRORS.INVALID_CREDENTIALS);
    }

    const accessToken = this.accessTokens.sign(user.id, now);
    const refreshToken = {
      value: randomBytes(REFRESH_TOKEN_BYTES).toString('hex'),
      expiresAt: new Date(
        now.getTime() + AUTH_TOKEN_RULES.refreshTokenDays * DAY_MS,
      ),
    };

    // 로그인마다 행을 추가한다. 덮어쓰지 않으므로 휴대폰과 PC에 동시에
    // 로그인할 수 있다. (ADR-AUTH-1)
    await this.refreshTokens.create({
      userId: user.id,
      tokenHash: hashToken(refreshToken.value),
      expiresAt: refreshToken.expiresAt,
    });

    return {
      user: { id: user.id, email: user.email, name: user.name },
      accessToken,
      refreshToken,
    };
  }

  /** Access가 살아 있으면 그대로, 만료됐고 Refresh가 유효하면 Access만 다시 발급 */
  async authenticate(
    cookies: SessionCookies,
    now: Date = new Date(),
  ): Promise<AuthenticatedSession> {
    if (cookies.accessToken !== undefined) {
      const payload = this.accessTokens.verify(cookies.accessToken, now);
      if (payload) return { userId: payload.sub };
    }

    if (cookies.refreshToken === undefined) {
      throw new LoginError(LOGIN_ERRORS.UNAUTHENTICATED);
    }

    const session = await this.refreshTokens.findByTokenHash(
      hashToken(cookies.refreshToken),
    );
    // 만료 시각 그 자체는 이미 만료다.
    if (!session || session.expiresAt.getTime() <= now.getTime()) {
      throw new LoginError(LOGIN_ERRORS.UNAUTHENTICATED);
    }

    // Access만 다시 발급한다. Refresh는 회전하지 않으므로 그 행을 건드리지
    // 않는다. (ADR-AUTH-1)
    return {
      userId: session.userId,
      renewedAccessToken: this.accessTokens.sign(session.userId, now),
    };
  }

  /** 마이페이지가 읽는 내 정보 */
  async getMyProfile(userId: string): Promise<MyProfile> {
    const user = await this.users.findById(userId);
    if (!user) throw new LoginError(LOGIN_ERRORS.UNAUTHENTICATED);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      // 주소는 #3이 채운다. 이 이슈는 자리만 만들어 둔다.
      address: null,
      createdAt: user.createdAt.toISOString(),
    };
  }

  /**
   * 로그아웃. 서버에 남은 Refresh 토큰 행을 지운다.
   *
   * 토큰이 없거나 이미 지워졌어도 성공으로 본다 — 로그아웃은 멱등해야 한다.
   * "이미 로그아웃된 상태"는 사용자가 고칠 수 있는 잘못이 아니다.
   */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken === undefined) {
      return;
    }
    await this.refreshTokens.deleteByTokenHash(hashToken(refreshToken));
  }
}

/**
 * Refresh 토큰은 해시로 저장한다. `EmailVerification.codeHash`(#1)와 같은
 * 방식이며, DB가 통째로 새어나가도 토큰 자체는 알 수 없어야 한다.
 *
 * 비밀번호와 달리 bcrypt를 쓰지 않는 이유는 두 가지다 — 이 값은 사람이 고른
 * 것이 아니라 32바이트 난수라 사전 공격이 성립하지 않고, `tokenHash`가 조회
 * 키(유니크)라서 같은 입력이 항상 같은 해시가 되어야 찾을 수 있다.
 */
function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
