import { Injectable } from '@nestjs/common';
import { hash } from 'bcrypt';
import {
  SIGNUP_ERRORS,
  SIGNUP_RULES,
  signupRequestSchema,
  type SignedUp,
  type SignupErrorCode,
  type SignupRequest,
} from '@fixer/shared';

/**
 * 가입이 내는 실패. 코드로 분기하고 HTTP 상태 매핑은 컨트롤러에서만 한다.
 * 서비스는 HTTP를 모른다.
 */
export class SignupError extends Error {
  constructor(readonly code: SignupErrorCode) {
    super(code);
    this.name = 'SignupError';
  }
}

/** 회원 한 명. 이슈 #2 범위의 컬럼만 담는다 */
export interface UserRecord {
  id: string;
  email: string;
  name: string;
  /** bcrypt 해시. 평문은 어디에도 남기지 않는다 */
  passwordHash: string;
  createdAt: Date;
  /** 비활성화 시각. `null`이면 활성이다 (#9, ADR-AUTH-3) */
  deactivatedAt?: Date | null;
}

/**
 * 회원 저장소 포트. Prisma 구현체는 `prisma-user.store.ts`에 있다.
 *
 * 서비스가 Prisma를 직접 부르지 않는 이유는 #1과 같다 — 판정 로직을 DB 없이
 * 단위 테스트하기 위해서다.
 */
export interface UserStore {
  findByEmail(email: string): Promise<UserRecord | null>;

  create(input: {
    email: string;
    name: string;
    passwordHash: string;
  }): Promise<UserRecord>;
}

/**
 * "이 이메일이 인증을 마쳤는가"만 묻는 포트.
 *
 * #1의 `EmailVerificationStore`를 통째로 끌어오지 않는 이유는, 가입이 알아야
 * 하는 것이 인증 이력 전체가 아니라 예/아니오 하나이기 때문이다.
 */
export interface EmailVerificationChecker {
  isVerified(email: string): Promise<boolean>;
}

@Injectable()
export class SignupService {
  constructor(
    private readonly users: UserStore,
    private readonly verification: EmailVerificationChecker,
  ) {}

  /** 검증 → 인증 여부 → 중복 → 해시 → 저장 순으로 판정한다 */
  async signup(input: SignupRequest): Promise<SignedUp> {
    // 검증이 가장 먼저다. 형식이 틀린 요청은 저장소를 건드리지 않고 끝난다.
    const { email, password, name } = signupRequestSchema.parse(input);

    // 대소문자만 다른 주소를 같은 계정으로 본다. 정규화하지 않으면
    // A@b.com과 a@b.com이 별개 계정이 되어 중복 검사가 뚫린다.
    const normalizedEmail = email.toLowerCase();

    // 인증 여부를 중복보다 먼저 본다. 순서가 반대면 인증하지 않은 사람이
    // 이메일만 넣어보고 가입 여부를 알아낼 수 있다.
    if (!(await this.verification.isVerified(normalizedEmail))) {
      throw new SignupError(SIGNUP_ERRORS.EMAIL_NOT_VERIFIED);
    }

    if (await this.users.findByEmail(normalizedEmail)) {
      throw new SignupError(SIGNUP_ERRORS.EMAIL_ALREADY_EXISTS);
    }

    const passwordHash = await hash(password, SIGNUP_RULES.bcryptCostFactor);

    const user = await this.users.create({
      email: normalizedEmail,
      name,
      passwordHash,
    });

    // 해시는 여기서 걸러 내보내지 않는다. 반환 타입에도 자리가 없다.
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
