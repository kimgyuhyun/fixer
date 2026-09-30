# syntax=docker/dockerfile:1
#
# API 운영 이미지. 빌드 컨텍스트는 저장소 루트다.
#
#   docker build -f apps/api/Dockerfile .                  → 운영(runtime)
#   docker build -f apps/api/Dockerfile --target migrate . → 마이그레이션·seed
#
# 두 이미지를 나누는 이유: 마이그레이션·seed에는 prisma CLI, tsx, 소스(prisma/, assets/)가
# 필요하지만 요청을 받는 서버에는 dist와 운영 의존만 있으면 된다.
#
# 알려진 한계: @prisma/client가 prisma CLI를 (선택적) peerDependency로 선언하고 있어
# 잠금 파일에 묶인 채로 운영 이미지의 node_modules/.pnpm에도 따라 들어간다.
# 최상위 node_modules나 PATH에는 없고 서버가 실행하지 않는다
# (security-exceptions.md 1번과 같은 원인).

# 멀티 아키텍처 index digest로 고정한다(서버는 arm64). 태그만 두면 같은 이름이
# 다른 이미지로 조용히 바뀔 수 있다.
# glibc(bookworm)를 쓴다. bcrypt 사전 빌드는 glibc·musl 둘 다 있지만 Prisma 엔진은
# glibc 쪽이 기본 경로라 덜 흔들린다.
FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS node

# Prisma 스키마 엔진(migrate deploy)이 libssl에 링크돼 있다. 없으면 플랫폼을 잘못 잡는다.
FROM node AS node-openssl
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

# ── 빌드: 의존성 설치 → shared → api ──
FROM node-openssl AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# 잠금 파일만으로 패키지를 먼저 받는다. 소스가 바뀌어도 이 레이어는 캐시된다.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
# api와 그 의존(shared)만 설치한다. postinstall이 prisma generate와 shared 빌드를 한다.
RUN pnpm install --offline --frozen-lockfile --filter "@fixer/api..."
RUN pnpm --filter @fixer/api build

# 운영에 필요한 의존만 따로 뽑는다(devDependency 제외). --legacy: 이 저장소는
# inject-workspace-packages를 켜지 않아 새 deploy 방식이 거부한다.
# 스크립트는 막는다 — prod 트리에는 prisma CLI가 없어 postinstall이 실패한다.
# bcrypt는 prebuilds/에 linux-arm64·x64 바이너리를 담고 있어 설치 스크립트 없이 로드된다.
RUN pnpm --filter @fixer/api deploy --prod --legacy --ignore-scripts /out

# ── 마이그레이션·seed ──
# compose의 migrate 서비스가 api보다 먼저 한 번 실행한다.
#   seed:  docker compose -f docker-compose.prod.yml run --rm migrate prisma db seed
#
# build 단계를 그대로 잇지 않는다. 거기엔 pnpm fetch가 받은 워크스페이스 전체 스토어
# (web의 next 등)가 레이어로 남아 있어 이미지가 3GB가 된다. 설치 결과(/app)만 옮긴다.
FROM node-openssl AS migrate
COPY --from=build /app /app
WORKDIR /app/apps/api
# `prisma db seed`가 부르는 tsx를 찾을 수 있게 한다.
ENV PATH=/app/apps/api/node_modules/.bin:$PATH
# seed가 동의서 템플릿을 저장 볼륨에 복사한다. 볼륨이 처음 붙을 때 이 디렉터리의
# 소유자를 물려받으므로, 미리 node 소유로 만들어 둔다(api 이미지와 같게).
RUN mkdir -p /data/agreements && chown node:node /data/agreements
USER node
CMD ["prisma", "migrate", "deploy"]

# ── 운영 ──
FROM node AS runtime
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
# 동의서 PDF 저장 위치(AGREEMENT_STORAGE_PATH). compose가 볼륨을 붙인다.
RUN mkdir -p /data/agreements && chown node:node /data/agreements
# 이미지 파일은 root 소유로 두고 읽기만 한다. 앱이 쓰는 곳은 저장 볼륨뿐이다.
USER node
EXPOSE 3001
CMD ["node", "dist/src/main.js"]
