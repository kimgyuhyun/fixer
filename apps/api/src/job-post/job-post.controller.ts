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
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  JOB_POST_ERRORS,
  createJobPostRequestSchema,
  jobPostDetailSchema,
  jobPostFilterSchema,
  cancelJobPostResultSchema,
  jobPostListSchema,
  jobPostSummarySchema,
  jobPostVersionSchema,
  type JobPostDetail,
  type JobPostList,
  type JobPostSummary,
  type JobPostVersionSnapshot,
  type CancelJobPostResult,
} from '@fixer/shared';
import { ZodError } from 'zod';
import { JobPostError, JobPostService } from './job-post.service';

/**
 * 공고의 HTTP 경계. (이슈 #12)
 *
 * 회원 식별은 아직 본문으로 받는다. #4의 토큰 주체로 바꾸는 것은 그
 * 브랜치가 머지된 뒤다.
 */
@Controller('job-posts')
export class JobPostController {
  constructor(private readonly service: JobPostService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown): Promise<JobPostSummary> {
    const employerId = employerIdOf(body);
    try {
      const input = createJobPostRequestSchema.parse(body);
      return jobPostSummarySchema.parse(
        await this.service.create(employerId, input),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /**
   * 목록. 필터는 **쿼리스트링에서만** 온다 (ADR-JOB-4).
   *
   * 잘못된 `page`는 오류로 만들지 않고 1로 본다. 링크를 손으로 고친
   * 사람에게 500을 주는 것보다 첫 페이지를 보여주는 편이 낫다.
   */
  @Get()
  async list(@Query() query: unknown): Promise<JobPostList> {
    const filter = jobPostFilterSchema.parse(query ?? {});
    return jobPostListSchema.parse(await this.service.list(filter));
  }

  /** 필수항목을 고치면 version이 오른다 (#15) */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<JobPostDetail> {
    const employerId = employerIdOf(body);
    try {
      return jobPostDetailSchema.parse(
        await this.service.update({
          employerId,
          jobPostId: id,
          // employerId는 본문에서 빼고 넘긴다. 수정 대상이 아니다.
          patch: withoutEmployer(body),
        }),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** 공고를 취소한다. 잠긴 돈은 전액 되돌아간다 (#16) */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CancelJobPostResult> {
    const employerId = employerIdOf(body);
    try {
      return cancelJobPostResultSchema.parse(
        await this.service.cancel({ employerId, jobPostId: id }),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** 그 버전의 필수항목 6개. 분쟁 시 근거가 되는 계약 내용이다 (ADR-JOB-1) */
  @Get(':id/versions/:version')
  async version(
    @Param('id') id: string,
    @Param('version') version: string,
  ): Promise<JobPostVersionSnapshot> {
    try {
      return jobPostVersionSchema.parse(
        await this.service.findVersion(id, Number(version)),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** 공고 하나. 소프트 삭제된 것은 404다 — 있었다는 사실도 알려주지 않는다 */
  @Get(':id')
  async detail(@Param('id') id: string): Promise<JobPostDetail> {
    try {
      return jobPostDetailSchema.parse(await this.service.findById(id));
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

/** 수정 본문에서 회원 id를 뺀다. 그건 고칠 대상이 아니다 */
function withoutEmployer(body: unknown): Record<string, unknown> {
  const rest = { ...((body ?? {}) as Record<string, unknown>) };
  delete rest.employerId;
  return rest;
}

function employerIdOf(body: unknown): string {
  const employerId = (body as { employerId?: unknown } | null)?.employerId;
  if (typeof employerId !== 'string' || employerId.length === 0) {
    throw new BadRequestException({
      errorCode: 'VALIDATION_FAILED',
      message: '회원 정보가 없습니다.',
    });
  }
  return employerId;
}

function toHttpError(error: unknown): unknown {
  if (error instanceof ZodError) {
    return new BadRequestException({
      errorCode: 'VALIDATION_FAILED',
      message: '입력값을 확인해 주세요.',
      // 어느 칸이 잘못됐는지 화면이 그 칸 아래에 표시할 수 있어야 한다.
      fieldErrors: toFieldErrors(error),
    });
  }

  if (error instanceof JobPostError) {
    if (
      error.code === JOB_POST_ERRORS.NOT_FOUND ||
      error.code === JOB_POST_ERRORS.VERSION_NOT_FOUND
    ) {
      return new NotFoundException({
        errorCode: error.code,
        message: '공고를 찾을 수 없습니다.',
      });
    }

    if (error.code === JOB_POST_ERRORS.NOT_OWNED) {
      // 없다고 하지 않는다. 본인 것이 아니라는 사실만 말한다.
      return new ForbiddenException({
        errorCode: error.code,
        message: '본인의 공고가 아닙니다.',
      });
    }

    if (error.code === JOB_POST_ERRORS.NOT_EDITABLE) {
      return new ConflictException({
        errorCode: error.code,
        message: '모집 중인 공고만 고칠 수 있습니다.',
      });
    }

    if (error.code === JOB_POST_ERRORS.INVALID_TRANSITION) {
      return new ConflictException({
        errorCode: error.code,
        message: '지금 상태에서는 취소할 수 없습니다.',
      });
    }

    if (error.code === JOB_POST_ERRORS.NO_DEFAULT_ADDRESS) {
      return new BadRequestException({
        errorCode: error.code,
        message: '근무 주소를 입력하거나 가입 주소를 먼저 등록해 주세요.',
      });
    }

    if (error.code === JOB_POST_ERRORS.INSUFFICIENT_BALANCE) {
      // 얼마가 모자란지 함께 준다. 본인 계정의 숫자라 감출 정보가 아니다.
      const shortfall = error.detail?.shortfall ?? 0;
      return new ConflictException({
        errorCode: error.code,
        message: `포인트가 ${Number(shortfall).toLocaleString('ko-KR')}원 부족합니다. 충전 후 다시 시도해 주세요.`,
        ...error.detail,
      });
    }

    return new ConflictException({
      errorCode: error.code,
      message: '지금은 처리할 수 없습니다.',
    });
  }

  return error;
}

/** zod 오류를 `{ 필드명: [문구] }` 모양으로 모은다 */
function toFieldErrors(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = issue.path.join('.');
    if (field === '') continue;
    (fieldErrors[field] ??= []).push(issue.message);
  }

  return fieldErrors;
}
