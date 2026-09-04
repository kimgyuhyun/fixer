import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { AGREEMENT_ERRORS } from '@fixer/shared';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AgreementController } from './agreement.controller';
import { AgreementError, type AgreementService } from './agreement.service';

/**
 * 컨트롤러는 HTTP 경계다. 서비스 테스트로는 증명할 수 없는 것을 본다 —
 * **본문에 실려온 `ip`·`userAgent`를 무시하고 서버가 본 값을 쓰는가**가 특히 그렇다.
 *
 * (#1에서 컨트롤러 테스트가 없어 입력 검증 실패가 500으로 나가는 버그가
 * 서비스 테스트 28개가 초록인 채로 살아 있었다. 같은 실수를 반복하지 않는다.)
 */
function controllerWith(impl: Partial<AgreementService>): AgreementController {
  return new AgreementController(impl as AgreementService);
}

/** `@Res()`가 넘겨주는 것 중 우리가 쓰는 것만 흉내낸다 */
function fakeResponse() {
  return {
    setHeader: vi.fn(),
    send: vi.fn(),
  } as unknown as Response;
}

function headersOf(res: Response): Map<string, string> {
  const mock = (
    res as unknown as { setHeader: { mock: { calls: [string, string][] } } }
  ).setHeader.mock;
  return new Map(mock.calls);
}

function sentBody(res: Response): unknown {
  return (res as unknown as { send: { mock: { calls: unknown[][] } } }).send
    .mock.calls[0]?.[0];
}

/** 요청. `ip`와 `user-agent`는 서버가 여기서 읽는다 */
function fakeRequest(overrides: Partial<Request> = {}): Request {
  return {
    ip: OBSERVED_IP,
    headers: { 'user-agent': OBSERVED_UA },
    ...overrides,
  } as unknown as Request;
}

function statusOf(error: unknown): number {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getStatus();
}

function bodyOf(error: unknown): Record<string, unknown> {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse() as Record<string, unknown>;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거절되어야 한다');
    },
    (error: unknown) => error,
  );
}

const OBSERVED_IP = '203.0.113.7';
const OBSERVED_UA = 'Mozilla/5.0 (real browser)';
const TEMPLATE_PDF = Buffer.from('%PDF-1.7 template');
const NOW = new Date('2026-09-03T00:00:00.000Z');

/** 1×1 PNG. 모양만 맞으면 컨트롤러 경계 테스트에는 충분하다 */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const SAVED = {
  id: 'agr_1',
  userId: 'usr_1',
  templateVersion: 3,
  filePath: 'agreements/abc.pdf',
  sha256: 'merged-hash',
  agreedAt: NOW,
  ip: OBSERVED_IP,
  userAgent: OBSERVED_UA,
};

describe('GET /agreements/template', () => {
  it('should return 200 with application/pdf and set Content-Type', async () => {
    const controller = controllerWith({
      getActiveTemplatePdf: vi
        .fn()
        .mockResolvedValue({ version: 3, bytes: TEMPLATE_PDF }),
    });
    const res = fakeResponse();

    await controller.template(res);

    expect(headersOf(res).get('Content-Type')).toBe('application/pdf');
    expect(sentBody(res)).toEqual(TEMPLATE_PDF);
  });

  it('should return 503 with errorCode AGREEMENT_TEMPLATE_MISSING when no template is active', async () => {
    // 운영 설정 문제이지 사용자 잘못이 아니다. 4xx로 주면 사용자가
    // 자기가 뭘 잘못했다고 생각한다.
    const controller = controllerWith({
      getActiveTemplatePdf: vi
        .fn()
        .mockRejectedValue(
          new AgreementError(AGREEMENT_ERRORS.TEMPLATE_MISSING),
        ),
    });

    const error = await rejectionOf(controller.template(fakeResponse()));

    expect(statusOf(error)).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(bodyOf(error)).toMatchObject({
      errorCode: AGREEMENT_ERRORS.TEMPLATE_MISSING,
    });
  });
});

describe('POST /agreements', () => {
  it('should return 201 with id, agreedAt and templateVersion', async () => {
    const controller = controllerWith({
      sign: vi.fn().mockResolvedValue(SAVED),
    });

    const body = await controller.sign(
      { userId: 'usr_1', signaturePngBase64: TINY_PNG_BASE64 },
      fakeRequest(),
    );

    expect(body).toEqual({
      id: 'agr_1',
      templateVersion: 3,
      agreedAt: NOW.toISOString(),
    });
    // 파일 경로와 해시는 응답에 싣지 않는다
    expect(body).not.toHaveProperty('filePath');
    expect(body).not.toHaveProperty('sha256');
  });

  it('should ignore ip and userAgent in the body and use what the server observed', async () => {
    // 본문으로 받으면 조작된다. 동의 시점의 접속 정보는 분쟁 시 증거다.
    const sign = vi.fn().mockResolvedValue(SAVED);
    const controller = controllerWith({ sign });

    await controller.sign(
      {
        userId: 'usr_1',
        signaturePngBase64: TINY_PNG_BASE64,
        ip: '10.0.0.1',
        userAgent: 'forged-agent',
      },
      fakeRequest(),
    );

    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({ ip: OBSERVED_IP, userAgent: OBSERVED_UA }),
    );
  });

  it('should return 400 with AGREEMENT_SIGNATURE_REQUIRED for an empty signature', async () => {
    const controller = controllerWith({ sign: vi.fn() });

    const error = await rejectionOf(
      controller.sign(
        { userId: 'usr_1', signaturePngBase64: '' },
        fakeRequest(),
      ),
    );

    expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(error)).toMatchObject({
      errorCode: AGREEMENT_ERRORS.SIGNATURE_REQUIRED,
    });
  });

  it('should return 400 when the signature is rejected by the service', async () => {
    const controller = controllerWith({
      sign: vi
        .fn()
        .mockRejectedValue(
          new AgreementError(AGREEMENT_ERRORS.SIGNATURE_REQUIRED),
        ),
    });

    const error = await rejectionOf(
      controller.sign(
        { userId: 'usr_1', signaturePngBase64: TINY_PNG_BASE64 },
        fakeRequest(),
      ),
    );

    expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST);
  });
});
