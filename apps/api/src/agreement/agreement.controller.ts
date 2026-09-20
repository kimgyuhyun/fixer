import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  AGREEMENT_ERRORS,
  agreementSummarySchema,
  signAgreementRequestSchema,
  signedAgreementSchema,
  type AgreementSummary,
  type SignedAgreement,
} from '@fixer/shared';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { CurrentMember, MemberGuard } from '../auth/member.guard';
import { AgreementError, AgreementService } from './agreement.service';

/**
 * 동의서의 HTTP 경계. (이슈 #7)
 *
 * **`ip`와 `userAgent`는 요청에서 직접 읽는다.** 본문으로 받으면 조작된다 —
 * 동의 시점의 접속 정보는 분쟁 시 증거라 서버가 본 것만 남긴다.
 *
 * **가드는 컨트롤러가 아니라 라우트마다 붙는다.** (이슈 #72) 템플릿은 가입
 * 전에 읽는 문서이고 서명은 가입 5단계라 그 시점에 세션이 없다
 * (`spec-fixed.md` §2.2). 통째로 붙이면 가입이 그 자리에서 막힌다.
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
        // 몸체에 실린 것을 쓴다. 이 시점에 세션이 없다 — 아래 참고.
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

  /** 마이페이지가 "내 동의서가 있는가"를 묻는다 (#8) */
  @Get('mine')
  @UseGuards(MemberGuard)
  async mine(
    @CurrentMember() userId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AgreementSummary | undefined> {
    const found = await this.service.findMyLatest(userId);
    if (!found) {
      // 없는 것은 오류가 아니다. 아직 서명하지 않았을 뿐이다.
      res.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return agreementSummarySchema.parse({
      id: found.id,
      templateVersion: found.templateVersion,
      agreedAt: found.agreedAt.toISOString(),
    });
  }

  /**
   * 서명한 동의서 PDF. **남의 것은 못 본다** (#8 AC2)
   *
   * 가드는 "로그인했는가"만 본다. 그 회원이 **이 동의서의 주인인가**는
   * `getMyAgreementPdf`가 그대로 판정한다 — 이 이슈가 바꾼 것은 대조에
   * 넣는 값의 출처다.
   */
  @Get(':id')
  @UseGuards(MemberGuard)
  async one(
    @Param('id') id: string,
    @CurrentMember() userId: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const { bytes, sha256Matches } = await this.service.getMyAgreementPdf({
        agreementId: id,
        requesterId: userId,
      });

      // 어긋나도 막지 않는다. 헤더로 알리고 운영이 판단한다.
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('X-Agreement-Hash-Matches', String(sha256Matches));
      res.send(bytes);
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

/**
 * 가입 흐름이라 아직 토큰이 없다. #3(주소)이 같은 이유로 경로에서 `userId`를
 * 받았고, 여기서도 같은 전제를 쓴다.
 *
 * **#72에서 다시 확인했다.** 서명은 가입 5단계이고 6단계가 "가입 완료"다
 * (`spec-fixed.md` §2.2). 가입 응답은 쿠키를 내려주지 않으므로 이 요청에는
 * 실을 쿠키가 없다. 서명을 세션에 묶으려면 가입 직후 자동 로그인이나 1회용
 * 서명 토큰 중 하나를 **새로 정해야 하고**, 그건 ADR이 먼저다.
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
    if (error.code === AGREEMENT_ERRORS.FORBIDDEN) {
      return new ForbiddenException({
        errorCode: error.code,
        message: '다른 회원의 동의서는 볼 수 없습니다.',
      });
    }
    if (error.code === AGREEMENT_ERRORS.NOT_FOUND) {
      return new NotFoundException({
        errorCode: error.code,
        message: '동의서를 찾을 수 없습니다.',
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
