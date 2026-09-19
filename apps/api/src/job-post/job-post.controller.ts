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
  UseGuards,
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
import { CurrentMember, MemberGuard } from '../auth/member.guard';
import { JobPostError, JobPostService } from './job-post.service';

/**
 * 공고의 HTTP 경계. (이슈 #12)
 *
 * **구인자는 쿠키에서 온다** (#69). 읽기 세 곳(목록·상세·버전)은 가드 없이
 * 둔다 — 공고 열람은 로그인 전에도 되는 것이 이 서비스의 첫 화면이다.
 */
@Controller('job-posts')
export class JobPostController {
  constructor(private readonly service: JobPostService) {}

  @Post()
  @UseGuards(MemberGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentMember() employerId: string,
    @Body() body: unknown,
  ): Promise<JobPostSummary> {
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
  @UseGuards(MemberGuard)
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentMember() employerId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<JobPostDetail> {
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
  @UseGuards(MemberGuard)
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentMember() employerId: string,
    @Param('id') id: string,
  ): Promise<CancelJobPostResult> {
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

/**
 * 수정 본문에서 회원 id를 뺀다.
 *
 * 스키마에 없는 칸이라 서비스가 쓰지는 않지만, 요청자가 실어 보낸 값이
 * 고칠 값 목록에 섞여 내려가는 길 자체를 막는다 (#69).
 */
function withoutEmployer(body: unknown): Record<string, unknown> {
  const rest = { ...((body ?? {}) as Record<string, unknown>) };
  delete rest.employerId;
  return rest;
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

    if (error.code === JOB_POST_ERRORS.SUSPENDED) {
      // 며칠짜리라 다시 눌러도 소용없다. 409(잠시 뒤 다시)가 아니라 403이다.
      return new ForbiddenException({
        errorCode: error.code,
        message: '제재 중에는 공고를 올릴 수 없습니다.',
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
