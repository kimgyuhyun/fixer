import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 아직 테스트가 없는 패키지도 통과시킨다. TDD로 이슈를 하나씩 구현하면서
    // 테스트가 채워지는 중이라, 지금 실패시키면 pnpm test가 항상 빨간불이 된다.
    passWithNoTests: true,
    // 여기는 순수 함수와 zod 스키마뿐이라 DB도 브라우저도 필요 없다.
    // 세 패키지 중 가장 빨라야 하는 곳이므로 환경을 얹지 않는다.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
