import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // 아직 테스트가 없는 패키지도 통과시킨다. TDD로 이슈를 하나씩 구현하면서
    // 테스트가 채워지는 중이라, 지금 실패시키면 pnpm test가 항상 빨간불이 된다.
    passWithNoTests: true,
    // React Testing Library가 DOM을 필요로 하므로 jsdom(브라우저 흉내를 내는 가짜 DOM)을 쓴다.
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
});
