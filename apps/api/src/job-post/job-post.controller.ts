import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  JOB_POST_ERRORS,
  createJobPostRequestSchema,
  jobPostFilterSchema,
  jobPostListSchema,
  jobPostSummarySchema,
  type JobPostList,
  type JobPostSummary,
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
