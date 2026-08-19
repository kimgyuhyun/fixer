import { z } from 'zod';

/**
 * 서버 상태 응답 규격.
 *
 * 이 파일 하나가 API의 응답 검증과 웹의 응답 타입을 동시에 책임진다.
 * 필드를 바꾸면 웹 쪽이 컴파일 에러로 즉시 드러나는 것이 이 패키지의 존재 이유다.
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  database: z.enum(['connected', 'disconnected']),
  checkedAt: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
