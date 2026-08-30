import { HttpException, HttpStatus } from '@nestjs/common';
import { EMAIL_VERIFICATION_ERRORS } from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import { EmailVerificationController } from './email-verification.controller';
import {
  EmailVerificationError,
  type EmailVerificationService,
} from './email-verification.service';

/**
 * 컨트롤러는 HTTP 경계다. 여기서 검증하는 것은 도메인 규칙이 아니라
 * "어떤 실패가 어떤 상태 코드와 본문이 되는가" 하나다.
 *
 * 서비스 단위 테스트가 28개 통과하는 동안 ZodError가 500으로 나가는 버그가
 * 살아 있었다. 서비스만 보면 경계의 실수가 보이지 않기 때문이다.
 */
function controllerWith(
  impl: Partial<EmailVerificationService>,
): EmailVerificationController {
  return new EmailVerificationController(impl as EmailVerificationService);
}

/** HttpException의 본문을 객체로 꺼낸다 */
function bodyOf(error: unknown): Record<string, unknown> {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse() as Record<string, unknown>;
}

describe('EmailVerificationController.request', () => {
  it('should return 400 when the email is not a valid address', async () => {
    const controller = controllerWith({
      requestCode: () => {
        throw new Error('서비스까지 오면 안 된다');
      },
    });

    const error = await controller.request({ email: 'not-an-email' }).then(
      () => {
        throw new Error('거절되어야 한다');
      },
      (e: unknown) => e,
    );

    expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(error).errorCode).toBe('VALIDATION_FAILED');
  });

  it('should return 429 with the remaining seconds when rejected by the cooldown', async () => {
    const controller = controllerWith({
      requestCode: () =>
        Promise.reject(
          new EmailVerificationError(
            EMAIL_VERIFICATION_ERRORS.RESEND_COOLDOWN,
            42,
          ),
        ),
    });

    const error = await controller
      .request({ email: 'worker@example.com' })
      .then(
        () => {
          throw new Error('거절되어야 한다');
        },
        (e: unknown) => e,
      );

    expect((error as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    const body = bodyOf(error);
    expect(body.errorCode).toBe(EMAIL_VERIFICATION_ERRORS.RESEND_COOLDOWN);
    expect(body.retryAfterSeconds).toBe(42);
    // 남은 시간이 문구에도 들어가야 화면이 그대로 보여줄 수 있다.
    expect(String(body.message)).toContain('42');
  });

  it('should let an unknown error through so it surfaces as 500', async () => {
    const boom = new Error('DB 연결 끊김');
    const controller = controllerWith({
      requestCode: () => Promise.reject(boom),
    });

    await expect(
      controller.request({ email: 'worker@example.com' }),
    ).rejects.toBe(boom);
  });
});

describe('EmailVerificationController.verify', () => {
  it('should return 400 when the code is wrong', async () => {
    const controller = controllerWith({
      verifyCode: () =>
        Promise.reject(
          new EmailVerificationError(EMAIL_VERIFICATION_ERRORS.INVALID),
        ),
    });

    const error = await controller
      .verify({ email: 'worker@example.com', code: '000000' })
      .then(
        () => {
          throw new Error('거절되어야 한다');
        },
        (e: unknown) => e,
      );

    expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(error).errorCode).toBe(EMAIL_VERIFICATION_ERRORS.INVALID);
  });

  it('should return 429 when the attempt limit is exceeded', async () => {
    const controller = controllerWith({
      verifyCode: () =>
        Promise.reject(
          new EmailVerificationError(
            EMAIL_VERIFICATION_ERRORS.ATTEMPTS_EXCEEDED,
          ),
        ),
    });

    const error = await controller
      .verify({ email: 'worker@example.com', code: '000000' })
      .then(
        () => {
          throw new Error('거절되어야 한다');
        },
        (e: unknown) => e,
      );

    expect((error as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  it('should return the verified result when the code matches', async () => {
    const verifiedAt = '2026-09-01T00:00:00.000Z';
    const controller = controllerWith({
      verifyCode: () =>
        Promise.resolve({ email: 'worker@example.com', verifiedAt }),
    });

    await expect(
      controller.verify({ email: 'worker@example.com', code: '123456' }),
    ).resolves.toEqual({ email: 'worker@example.com', verifiedAt });
  });
});
