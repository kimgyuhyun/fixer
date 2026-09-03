import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AGREEMENT_ERRORS,
  signAgreementRequestSchema,
  signedAgreementSchema,
  type SignedAgreement,
} from '@fixer/shared';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { AgreementError, AgreementService } from './agreement.service';

/**
 * 동의서의 HTTP 경계. (이슈 #7)
 *
 * **`ip`와 `userAgent`는 요청에서 직접 읽는다.** 본문으로 받으면 조작된다 —
 * 동의 시점의 접속 정보는 분쟁 시 증거라 서버가 본 것만 남긴다.
 */
@Controller('agreements')
export class AgreementController {
  constructor(private readonly service: AgreementService) {}

  /** 활성 템플릿 PDF. 화면이 그대로 표시한다 */
  @Get('template')
  async template(@Res() res: Response): Promise<void> {
    try {
      const { version, bytes } = await this.service.getActiveTemplatePdf();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('X-Agreement-Template-Version', String(version));
      res.send(bytes);
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** 서명 제출 */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async sign(
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<SignedAgreement> {
    try {
      const input = signAgreementRequestSchema.parse(body);
      const saved = await this.service.sign({
        // TODO(#4 머지 후): 토큰에서 읽는다. 지금은 본문에 실린 것을 쓴다.
        userId: readUserId(body),
        signaturePng: Buffer.from(input.signaturePngBase64, 'base64'),
        ip: req.ip ?? '',
        userAgent: req.headers['user-agent'] ?? '',
      });

      return signedAgreementSchema.parse({
        id: saved.id,
        templateVersion: saved.templateVersion,
        agreedAt: saved.agreedAt.toISOString(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

/**
 * 가입 흐름이라 아직 토큰이 없다. #3(주소)이 같은 이유로 경로에서 `userId`를
 * 받았고, 여기서도 같은 전제를 쓴다. #4가 머지되면 토큰에서 읽도록 바꾼다.
 */
function readUserId(body: unknown): string {
  const value = (body as { userId?: unknown }).userId;
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestException({
      errorCode: 'VALIDATION_FAILED',
      message: '회원 정보가 없습니다. 가입부터 다시 진행해 주세요.',
    });
  }
  return value;
}

function toHttpError(error: unknown): unknown {
  if (error instanceof AgreementError) {
    // 템플릿이 없는 것은 운영 설정 문제다. 사용자 잘못이 아니므로 4xx가 아니다.
    if (error.code === AGREEMENT_ERRORS.TEMPLATE_MISSING) {
      return new ServiceUnavailableException({
        errorCode: error.code,
        message: '동의서를 준비 중입니다. 잠시 후 다시 시도해 주세요.',
      });
    }
    return new BadRequestException({
      errorCode: error.code,
      message: '서명을 그려 주세요.',
    });
  }

  if (error instanceof ZodError) {
    return new BadRequestException({
      errorCode: AGREEMENT_ERRORS.SIGNATURE_REQUIRED,
      message: error.issues[0]?.message ?? '입력값을 확인해 주세요.',
    });
  }

  return error;
}
