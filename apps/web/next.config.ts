import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';

// 환경변수는 저장소 루트의 .env 하나로만 관리한다.
// Next는 자기 디렉터리의 .env만 읽으므로 루트 파일을 직접 지정해서 불러온다.
loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  // 운영 이미지(apps/web/Dockerfile)는 node_modules 전체 대신 실행에 필요한 파일만 담는다.
  // 모노레포라 추적 기준을 저장소 루트로 잡아야 @fixer/shared까지 따라 들어간다.
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  // rewrites는 **빌드할 때** 목적지가 굳는다. 운영 이미지는 빌드 인자로
  // API_INTERNAL_URL을 받아 compose 서비스 이름(api)을 가리킨다.
  // 브라우저에서 보면 /api/*가 웹과 같은 출처가 된다.
  // 덕분에 CORS 설정도, 쿠키 도메인 고민도 필요 없다.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiInternalUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
