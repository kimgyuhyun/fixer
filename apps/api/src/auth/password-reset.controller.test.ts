import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { PASSWORD_RESET_ERRORS } from '@fixer/shared';
import { describe, expect, it, vi } from 'vitest';
import { PasswordResetController } from './password-reset.controller';
import {
  PasswordResetError,
  type PasswordResetService,
} from './password-reset.service';

/**
 * 컨트롤러는 HTTP 경계다. 여기서 보는 것은 도메인 규칙이 아니라
 * "무엇이 어떤 상태가 되는가"와 "있고 없고가 응답으로 새지 않는가"다.
 */
function controllerWith(
  impl: Partial<PasswordResetService>,
): PasswordResetController {
  return new PasswordResetController(impl as PasswordResetService);
}

function bodyOf(error: unknown): Record<string, unknown> {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse() as Record<string, unknown>;
}

function statusOf(error: unknown): number {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getStatus();
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

const EMAIL = 'worker@example.com';
const NEW_PASSWORD = 'new-good-password';

describe('POST /auth/password-reset', () => {
  it('should return 204', async () => {
    const requestReset = vi.fn().mockResolvedValue(undefined);
    const controller = controllerWith({ requestReset });

    await expect(controller.request({ email: EMAIL })).resolves.toBeUndefined();

    expect(requestReset).toHaveBeenCalledWith(EMAIL, expect.any(Date));
  });

  it('should return 204 even when the email belongs to nobody', async () => {
    // 서비스가 조용히 끝내므로 컨트롤러도 있을 때와 똑같이 응답한다.
    // 여기서 404를 주면 이메일만 넣어보고 가입 여부를 알아낼 수 있다.
    const requestReset = vi.fn().mockResolvedValue(undefined);
    const controller = controllerWith({ requestReset });

    await expect(
      controller.request({ email: 'nobody@example.com' }),
    ).resolves.toBeUndefined();
  });

  it('should return 400 when the email is malformed', async () => {
    const controller = controllerWith({ requestReset: vi.fn() });

    const error = await rejectionOf(controller.request({ email: 'not-email' }));

    expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST);
  });
});

describe('POST /auth/password-reset/confirm', () => {
  it('should return 204', async () => {
    const resetPassword = vi.fn().mockResolvedValue(undefined);
    const controller = controllerWith({ resetPassword });

    await expect(
      controller.confirm({ token: 'issued-token', newPassword: NEW_PASSWORD }),
    ).resolves.toBeUndefined();

    expect(resetPassword).toHaveBeenCalledWith(
      { token: 'issued-token', newPassword: NEW_PASSWORD },
      expect.any(Date),
    );
  });

  it('should return 400 with AUTH_RESET_TOKEN_INVALID for a used token', async () => {
    const resetPassword = vi
      .fn()
      .mockRejectedValue(
        new PasswordResetError(PASSWORD_RESET_ERRORS.TOKEN_INVALID),
      );
    const controller = controllerWith({ resetPassword });

    const error = await rejectionOf(
      controller.confirm({ token: 'used-token', newPassword: NEW_PASSWORD }),
    );

    expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(error)).toMatchObject({
      errorCode: PASSWORD_RESET_ERRORS.TOKEN_INVALID,
    });
  });

  it('should return 400 without calling the service when the new password is too short', async () => {
    // 규칙에 걸린 요청이 1회용 토큰을 태우면 안 된다
    const resetPassword = vi.fn();
    const controller = controllerWith({ resetPassword });

    const error = await rejectionOf(
      controller.confirm({ token: 'issued-token', newPassword: 'short12' }),
    );

    expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST);
    expect(resetPassword).not.toHaveBeenCalled();
  });
});
