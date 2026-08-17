import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// 환경변수는 저장소 루트의 .env 하나로만 관리한다.
// Next는 자기 디렉터리의 .env만 읽으므로 루트 파일을 직접 지정해서 불러온다.
loadEnv({ path: path.resolve(process.cwd(), "../../.env") });

const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  // 브라우저에서 보면 /api/*가 웹과 같은 출처가 된다.
  // 덕분에 CORS 설정도, 쿠키 도메인 고민도 필요 없다.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiInternalUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
