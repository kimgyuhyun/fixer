import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  APPLICATION_ERRORS,
  acceptApplicationRequestSchema,
  applicantListSchema,
  applicationSummarySchema,
  applyRequestSchema,
  type ApplicantList,
  type ApplicationErrorCode,
  type ApplicationSummary,
} from '@fixer/shared';
import { z, ZodError } from 'zod';
import { ApplicationError, ApplicationService } from './application.service';

/**
 * 지원자 목록 조회 파라미터.
 *
 * 화면이 쿼리 문자열을 직접 만들어 보내므로 공유 타입이 필요 없다 —
 * 여기서만 쓰는 모양이라 `packages/shared`에 두지 않는다.
 */
const employerListQuerySchema = z.object({
  jobPostId: z.string().min(1, { error: '공고를 알 수 없습니다.' }),
  employerId: z.string().min(1, { error: '구인자를 알 수 없습니다.' }),
});

/**
 * 신청의 HTTP 경계. (이슈 #17)
 *
 * 회원 식별은 #12와 마찬가지로 아직 본문·쿼리로 받는다. #4의 토큰 주체로
 * 바꾸는 것은 그 배선이 머지된 뒤다.
 */
@Controller('applications')
export class ApplicationController {
  constructor(private readonly service: ApplicationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async apply(@Body() body: unknown): Promise<ApplicationSummary> {
    try {
      const input = applyRequestSchema.parse(body);
      return applicationSummarySchema.parse(await this.service.apply(input));
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** 수락 전 철회. 경고가 쌓이지 않는다 (AC4) */
  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  async withdraw(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ApplicationSummary> {
    try {
      return applicationSummarySchema.parse(
        await this.service.withdraw({
          applicantId: applicantIdOf(body),
          applicationId: id,
        }),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** 구인자가 지원자 한 명을 수락한다. **이 순간이 계약 체결** (#18) */
  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ApplicationSummary> {
    try {
      const { employerId } = acceptApplicationRequestSchema.parse(body ?? {});
      return applicationSummarySchema.parse(
        await this.service.accept({ employerId, applicationId: id }),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** 구인자가 보는 지원자 목록 (#18 AC1·AC2) */
  @Get()
  async listForEmployer(@Query() query: unknown): Promise<ApplicantList> {
    try {
      const parsed = employerListQuerySchema.parse(query ?? {});
      return applicantListSchema.parse(
        await this.service.listForEmployer(parsed),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /**
   * 화면이 지원/철회/없음 중 무엇을 그릴지 정하는 데 쓴다 (AC5).
   *
   * 신청이 없으면 404다. `null`을 200으로 주면 화면이 "없음"과 "요청이
   * 실패했다"를 구분할 수 없다.
   */
  @Get('me')
  async mine(@Query() query: unknown): Promise<ApplicationSummary> {
    try {
      // 조회 파라미터의 모양이 지원 요청과 같다. 스키마를 다시 쓰지 않는다.
      const { jobPostId, applicantId } = applyRequestSchema.parse(query ?? {});
      const mine = await this.service.findMine(jobPostId, applicantId);
      if (mine === null) {
        throw new ApplicationError(APPLICATION_ERRORS.NOT_FOUND);
      }
      return applicationSummarySchema.parse(mine);
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

function applicantIdOf(body: unknown): string {
  const applicantId = (body as { applicantId?: unknown } | null)?.applicantId;
  if (typeof applicantId !== 'string' || applicantId.length === 0) {
    throw new BadRequestException({
      errorCode: 'VALIDATION_FAILED',
      message: '회원 정보가 없습니다.',
    });
  }
  return applicantId;
}

/**
 * 에러 코드별 안내 문구.
 *
 * 상태 코드 분기와 나란히 두지 않고 여기 모은 이유는, #19·#20이 코드를
 * 더할 때 **표에 한 줄을 더하면 끝나게** 하기 위해서다. 분기 안에 두면
 * 새 코드마다 이미 중첩된 식에 가지가 하나씩 붙는다.
 */
const MESSAGES: Record<ApplicationErrorCode, string> = {
  [APPLICATION_ERRORS.ALREADY_APPLIED]: '이미 지원한 공고입니다.',
  [APPLICATION_ERRORS.OWN_JOB_POST]: '본인이 올린 공고에는 지원할 수 없습니다.',
  [APPLICATION_ERRORS.JOB_POST_NOT_OPEN]: '모집 중인 공고가 아닙니다.',
  [APPLICATION_ERRORS.NOT_FOUND]: '신청을 찾을 수 없습니다.',
  [APPLICATION_ERRORS.NOT_OWNED]: '본인의 신청이 아닙니다.',
  [APPLICATION_ERRORS.INVALID_TRANSITION]: '지금 상태에서는 할 수 없습니다.',
  [APPLICATION_ERRORS.JOB_POST_NOT_FOUND]: '공고를 찾을 수 없습니다.',
  [APPLICATION_ERRORS.HEADCOUNT_FULL]: '이미 정원이 찼습니다.',
  [APPLICATION_ERRORS.NOT_EMPLOYER]: '이 공고의 구인자가 아닙니다.',
};

function toHttpError(error: unknown): unknown {
  if (error instanceof ZodError) {
    return new BadRequestException({
      errorCode: 'VALIDATION_FAILED',
      message: '입력값을 확인해 주세요.',
      fieldErrors: toFieldErrors(error),
    });
  }

  if (error instanceof ApplicationError) {
    const body = { errorCode: error.code, message: MESSAGES[error.code] };

    if (
      error.code === APPLICATION_ERRORS.NOT_FOUND ||
      error.code === APPLICATION_ERRORS.JOB_POST_NOT_FOUND
    ) {
      return new NotFoundException(body);
    }

    if (
      error.code === APPLICATION_ERRORS.OWN_JOB_POST ||
      error.code === APPLICATION_ERRORS.NOT_OWNED ||
      error.code === APPLICATION_ERRORS.NOT_EMPLOYER
    ) {
      // 없다고 하지 않는다. 지원할 수 없는 이유만 말한다.
      return new ForbiddenException(body);
    }

    return new ConflictException(body);
  }

  return error;
}

/** 어느 칸이 잘못됐는지 화면이 그 칸 아래에 표시할 수 있어야 한다 */
function toFieldErrors(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    fields[key] ??= issue.message;
  }
  return fields;
}
