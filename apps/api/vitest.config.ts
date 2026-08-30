import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 아직 테스트가 없는 패키지도 통과시킨다. TDD로 이슈를 하나씩 구현하면서
    // 테스트가 채워지는 중이라, 지금 실패시키면 pnpm test가 항상 빨간불이 된다.
    passWithNoTests: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],

    // 통합 테스트는 Testcontainers로 진짜 Postgres를 띄운다. (spec-fixed §9)
    // 컨테이너 기동에 시간이 걸리므로 기본 타임아웃으로는 모자란다.
    testTimeout: 60_000,
    hookTimeout: 120_000,

    // 통합 테스트가 같은 DB를 공유하지 않도록 파일 단위로 순차 실행한다.
    fileParallelism: false,

    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Prisma 생성물과 Nest 부트스트랩은 우리가 쓴 코드가 아니라 측정 대상이 아니다.
      exclude: [
        'src/generated/**',
        'src/main.ts',
        'src/**/*.module.ts',
        'src/**/*.test.ts',
      ],
    },
  },
});
