import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// 환경변수는 저장소 루트의 .env 하나로만 관리한다.
// Prisma CLI는 apps/api를 작업 디렉터리로 실행되므로 두 단계 위를 가리킨다.
loadEnv({ path: '../../.env' });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // 이걸 등록하지 않으면 `prisma db seed`가 seed.ts를 찾지 못하고
    // "No seed command configured"로 조용히 끝난다.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
