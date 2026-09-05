import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { SIGNUP_ERRORS } from '@fixer/shared';
import { describe, expect, it } from 'vitest';
import { SignupController } from './signup.controller';
import { SignupError, type SignupService } from './signup.service';

/**
 * 컨트롤러는 HTTP 경계다. 여기서 검증하는 것은 도메인 규칙이 아니라
 * "어떤 실패가 어떤 상태 코드와 본문이 되는가" 하나다.
 *
 * #1에서는 컨트롤러 테스트가 없어 입력 검증 실패가 500으로 나가는 버그가
 * 서비스 테스트 28개가 초록인 채로 살아 있었다. 이번에는 처음부터 쓴다.
 */
function controllerWith(impl: Partial<SignupService>): SignupController {
  return new SignupController(impl as SignupService);
}

/** HttpException의 본문을 객체로 꺼낸다 */
function bodyOf(error: unknown): Record<string, unknown> {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse() as Record<string, unknown>;
}

/** 거절될 때까지 기다렸다가 던져진 값을 돌려준다 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

const VALID_BODY = {
  email: 'worker@example.com',
  password: 'good-password',
  name: '김구직',
};

const CREATED = {
  id: 'usr_1',
  email: 'worker@example.com',
  name: '김구직',
  createdAt: '2026-09-01T00:00:00.000Z',
};

describe('POST /auth/signup', () => {
  it('should return 201 with the created member when signup succeeds', async () => {
    const controller = controllerWith({
      signup: () => Promise.resolve(CREATED),
    });

    const result = await controller.signup(VALID_BODY);

    expect(result).toEqual(CREATED);
    // 성공 응답은 201이다. 데코레이터가 실제로 붙어 있는지 메타데이터로 본다.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- 호출하지 않고 데코레이터가 남긴 메타데이터만 읽는다
    const handler = SignupController.prototype.signup;
    expect(Reflect.getMetadata('__httpCode__', handler)).toBe(
      HttpStatus.CREATED,
    );
  });

  it('should return 400 with VALIDATION_FAILED and a password field error when the password is too short', async () => {
    const controller = controllerWith({
      signup: () => {
        throw new Error('서비스까지 오면 안 된다');
      },
    });

    const error = await rejectionOf(
      controller.signup({ ...VALID_BODY, password: 'short' }),
    );

    expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(error).errorCode).toBe('VALIDATION_FAILED');
    expect(
      (bodyOf(error).fieldErrors as Record<string, string[]>).password,
    ).toBeTruthy();
  });

  it('should return 403 with AUTH_EMAIL_NOT_VERIFIED when the email is not verified', async () => {
    const controller = controllerWith({
      signup: () =>
        Promise.reject(new SignupError(SIGNUP_ERRORS.EMAIL_NOT_VERIFIED)),
    });

    const error = await rejectionOf(controller.signup(VALID_BODY));

    expect((error as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(bodyOf(error).errorCode).toBe(SIGNUP_ERRORS.EMAIL_NOT_VERIFIED);
  });

  it('should return 409 with MEMBER_EMAIL_ALREADY_EXISTS when the email is taken', async () => {
    const controller = controllerWith({
      signup: () =>
        Promise.reject(new SignupError(SIGNUP_ERRORS.EMAIL_ALREADY_EXISTS)),
    });

    const error = await rejectionOf(controller.signup(VALID_BODY));

    expect((error as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
    expect(bodyOf(error).errorCode).toBe(SIGNUP_ERRORS.EMAIL_ALREADY_EXISTS);
  });

  it('should return 409 with AUTH_REACTIVATION_AVAILABLE for a deactivated account', async () => {
    // 중복과 같은 409지만 코드가 다르다. 상태만 보면 웹이 재활성화
    // 안내를 띄울지 "이미 가입된 이메일"을 띄울지 가릴 수 없다. (#10)
    const controller = controllerWith({
      signup: () =>
        Promise.reject(new SignupError(SIGNUP_ERRORS.REACTIVATION_AVAILABLE)),
    });

    const error = await rejectionOf(controller.signup(VALID_BODY));

    expect((error as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
    expect(bodyOf(error).errorCode).toBe(SIGNUP_ERRORS.REACTIVATION_AVAILABLE);
    expect(bodyOf(error).message).toContain('재활성화');
  });

  it('should let an unknown error through so it becomes 500', async () => {
    // 여기서 삼키면 원인 모를 400이 되어 디버깅이 어려워진다.
    const unknown = new Error('DB가 죽었다');
    const controller = controllerWith({
      signup: () => Promise.reject(unknown),
    });

    const error = await rejectionOf(controller.signup(VALID_BODY));

    expect(error).toBe(unknown);
  });

  it('should never expose the password or its hash in the response', async () => {
    // 서비스가 실수로 User를 통째로 돌려줘도 경계에서 걸러져야 한다.
    const controller = controllerWith({
      signup: () =>
        Promise.resolve({
          ...CREATED,
          passwordHash: '$2b$12$leaked',
        } as never),
    });

    const result = await controller.signup(VALID_BODY);

    expect(result).not.toHaveProperty('passwordHash');
  });
});
