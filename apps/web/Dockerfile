# syntax=docker/dockerfile:1
#
# 웹 운영 이미지. 빌드 컨텍스트는 저장소 루트다.
#
#   docker build -f apps/web/Dockerfile .
#
# Next standalone 출력(next.config.ts의 output: 'standalone')만 담는다.
# node_modules 전체 대신 실행에 필요한 파일만 추려진 결과다.

# 멀티 아키텍처 index digest로 고정한다(서버는 arm64). apps/api/Dockerfile과 같은 이미지다.
FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS node

# ── 빌드 ──
FROM node AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# 잠금 파일만으로 패키지를 먼저 받는다. 소스가 바뀌어도 이 레이어는 캐시된다.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
# web과 그 의존(shared)만 설치한다. shared의 postinstall이 dist를 만든다.
RUN pnpm install --offline --frozen-lockfile --filter "@fixer/web..."

# rewrites(/api/* → Nest)의 목적지는 빌드할 때 routes-manifest에 굳는다.
# 런타임 환경변수로는 바뀌지 않으므로 여기서 compose 서비스 이름을 넣는다.
ARG API_INTERNAL_URL=http://api:3001
ENV API_INTERNAL_URL=$API_INTERNAL_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @fixer/web build

# ── 운영 ──
FROM node AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# standalone 서버는 기본으로 localhost에만 붙는다. 컨테이너 밖(Caddy)에서 닿게 한다.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# 이미지 파일은 root 소유로 두고 읽기만 한다. 서버는 파일을 쓰지 않는다.
COPY --from=build /app/apps/web/.next/standalone ./
# standalone은 정적 파일을 담지 않는다. 서버가 찾는 자리에 직접 넣는다.
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
