import { createHash, randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  EMAIL_VERIFICATION_ERRORS,
  EMAIL_VERIFICATION_RULES,
  emailVerificationRequestSchema,
  type EmailVerificationSent,
  type EmailVerified,
} from '@fixer/shared';

/**
 * 발급된 인증 코드 한 건. ADR-AUTH-4의 `EmailVerification` 행에 대응한다.
 */
export interface EmailVerificationRecord {
  id: string;
  email: string;
  /** 평문 저장 금지. 유출돼도 코드를 알 수 없어야 한다 */
  codeHash: string;
  expiresAt: Date;
  /** 인증에 사용된 시각. 1회용이므로 이 값이 있으면 재사용 불가 */
  consumedAt: Date | null;
  attemptCount: number;
  createdAt: Date;
}

/**
 * 발급 이력 저장소.
 *
 * 서비스가 Prisma를 직접 부르지 않고 이 포트를 통하는 이유는, 시간·횟수 판정
 * 로직을 DB 없이 단위 테스트하기 위해서다. Prisma 구현체는 Green에서 붙인다.
 */
export interface EmailVerificationStore {
  create(input: {
    email: string;
    codeHash: string;
    expiresAt: Date;
  }): Promise<EmailVerificationRecord>;

  /** 쿨다운 판정용. 소비·만료 여부와 무관하게 가장 최근 1건 */
  findLatest(email: string): Promise<EmailVerificationRecord | null>;

  /** 시간당 발송 수 판정용 */
  countSince(email: string, since: Date): Promise<number>;

  markConsumed(id: string, consumedAt: Date): Promise<void>;

  incrementAttempt(id: string): Promise<void>;
}

export interface MailProvider {
  sendVerificationCode(email: string, code: string): Promise<void>;
}

const COOLDOWN_MS = EMAIL_VERIFICATION_RULES.resendCooldownSeconds * 1000;
const EXPIRY_MS = EMAIL_VERIFICATION_RULES.expiryMinutes * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** 암호학적으로 안전한 난수로 6자리를 만든다. Math.random()은 예측 가능해서 쓰지 않는다 */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(
    EMAIL_VERIFICATION_RULES.codeLength,
    '0',
  );
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly store: EmailVerificationStore,
    private readonly mail: MailProvider,
  ) {}

  /** 6자리 코드를 발급하고 메일로 보낸다. 쿨다운·발송 제한을 여기서 판정한다 */
  async requestCode(email: string): Promise<EmailVerificationSent> {
    emailVerificationRequestSchema.parse({ email });

    const now = new Date();

    const latest = await this.store.findLatest(email);
    if (latest && now.getTime() - latest.createdAt.getTime() < COOLDOWN_MS) {
      throw new Error(EMAIL_VERIFICATION_ERRORS.RESEND_COOLDOWN);
    }

    // ADR-AUTH-4: 최근 1시간 내 발급된 행을 세어 판정한다. Penalty의 180일 롤링과 같은 방식.
    const sentWithinHour = await this.store.countSince(
      email,
      new Date(now.getTime() - HOUR_MS),
    );
    if (sentWithinHour >= EMAIL_VERIFICATION_RULES.maxSendsPerHour) {
      throw new Error(EMAIL_VERIFICATION_ERRORS.RESEND_LIMIT_EXCEEDED);
    }

    const code = generateCode();
    await this.store.create({
      email,
      codeHash: hashCode(code),
      expiresAt: new Date(now.getTime() + EXPIRY_MS),
    });
    await this.mail.sendVerificationCode(email, code);

    return {
      expiresAt: new Date(now.getTime() + EXPIRY_MS).toISOString(),
      resendAvailableAt: new Date(now.getTime() + COOLDOWN_MS).toISOString(),
    };
  }

  /** 코드를 대조해 이메일을 인증됨으로 만든다 */
  async verifyCode(email: string, code: string): Promise<EmailVerified> {
    const now = new Date();

    // ADR-AUTH-4: 유효한 코드는 "가장 최근" 행 하나뿐이다.
    // 이전 코드로 시도하면 최신 행과 대조되어 자연히 불일치가 된다.
    const latest = await this.store.findLatest(email);

    // 발급된 적 없음·이미 소비됨을 따로 알리지 않는다. 가입 여부가 새어나간다.
    if (!latest || latest.consumedAt) {
      throw new Error(EMAIL_VERIFICATION_ERRORS.INVALID);
    }

    if (latest.attemptCount >= EMAIL_VERIFICATION_RULES.maxAttempts) {
      throw new Error(EMAIL_VERIFICATION_ERRORS.ATTEMPTS_EXCEEDED);
    }

    if (now.getTime() >= latest.expiresAt.getTime()) {
      throw new Error(EMAIL_VERIFICATION_ERRORS.EXPIRED);
    }

    if (hashCode(code) !== latest.codeHash) {
      await this.store.incrementAttempt(latest.id);
      // 이번 실패로 한도에 도달했으면 그 사실을 알려 재발송을 유도한다.
      throw new Error(
        latest.attemptCount + 1 >= EMAIL_VERIFICATION_RULES.maxAttempts
          ? EMAIL_VERIFICATION_ERRORS.ATTEMPTS_EXCEEDED
          : EMAIL_VERIFICATION_ERRORS.INVALID,
      );
    }

    await this.store.markConsumed(latest.id, now);

    return { email, verifiedAt: now.toISOString() };
  }
}
