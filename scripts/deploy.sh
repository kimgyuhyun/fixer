#!/usr/bin/env bash
# 서버에서 실행하는 배포 스크립트. .github/workflows/deploy.yml이 SSH로 부른다.
#
#   echo "$GHCR_TOKEN" | TAG=<commit sha> GHCR_USER=<계정> \
#     API_DIGEST=sha256:… MIGRATE_DIGEST=sha256:… WEB_DIGEST=sha256:… bash scripts/deploy.sh
#
# 서버 배치(~/fixer):  docker-compose.prod.yml, scripts/deploy.sh, .env(서버에서 직접 작성)
#
#   1) 세 이미지(api·migrate·web)를 커밋 SHA 태그로 pull
#   2) 받은 이미지가 CI가 올린 digest(*_DIGEST)와 같은지 대조하고, 그 digest로 고정한다.
#      태그는 push 뒤에 다른 이미지로 바뀔 수 있지만 digest는 내용의 해시라 못 바꾼다
#   3) compose up. 마이그레이션은 compose의 migrate 서비스가 api보다 먼저 돌린다 — 여기서 또 돌리지 않는다
#   4) 헬스체크: api가 healthy이고, web을 거친 /api/health가 DB 연결까지 답하는가
#   5) 실패하면 직전 이미지로 되돌리고 실패로 끝낸다
#
# GHCR 토큰은 표준 입력 첫 줄로 받는다. 환경변수나 인자로 받으면 서버의 프로세스 목록(ps)에
# 보인다. 워크플로의 GITHUB_TOKEN이라 잡이 끝나면 만료되고, 여기서도 끝날 때 로그아웃한다.
set -euo pipefail

: "${TAG:?TAG(커밋 SHA) required}"
# ghcr.io/<소유자>/fixer 뒤에 -api·-migrate·-web이 붙는다. 로컬 검증 때만 바꾼다(로컬 레지스트리).
IMAGE_PREFIX="${IMAGE_PREFIX:-ghcr.io/kimgyuhyun/fixer}"
REGISTRY="${IMAGE_PREFIX%%/*}"

cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f docker-compose.prod.yml)

log() { echo "[deploy $(date +%H:%M:%S)] $*"; }
fail() { echo "[deploy ERROR] $*" >&2; exit 1; }

# ── 1) 로그인 · pull ──
IFS= read -r ghcr_token || true
if [ -n "${ghcr_token:-}" ]; then
  trap 'docker logout "$REGISTRY" >/dev/null 2>&1 || true' EXIT
  printf '%s\n' "$ghcr_token" | docker login "$REGISTRY" -u "${GHCR_USER:?GHCR_USER required}" --password-stdin >/dev/null
  log "docker login $REGISTRY"
fi
unset ghcr_token

pull_digest() {  # <이름> <CI가 올린 digest> → repo@sha256:… (로그는 stderr로)
  local ref="$IMAGE_PREFIX-$1:$TAG" want="$IMAGE_PREFIX-$1@$2" digests
  docker pull -q "$ref" >&2
  # 같은 이미지가 다른 이름으로도 있으면 RepoDigests에 여러 개가 실린다. 그중에 CI 것이 있어야 한다.
  digests=$(docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$ref")
  grep -qxF "$want" <<<"$digests" ||
    fail "$ref 가 CI가 올린 이미지($2)가 아니다 — 태그가 바뀌었을 수 있다. 아무것도 바꾸지 않고 멈춘다"
  echo "$want"
}
new_api=$(pull_digest api "${API_DIGEST:?API_DIGEST required}")
new_migrate=$(pull_digest migrate "${MIGRATE_DIGEST:?MIGRATE_DIGEST required}")
new_web=$(pull_digest web "${WEB_DIGEST:?WEB_DIGEST required}")
log "api     → $new_api"
log "migrate → $new_migrate"
log "web     → $new_web"

# ── 2) 되돌릴 이미지 기록 (첫 배포면 비어 있다) ──
running_image() {  # <서비스> → 지금 컨테이너가 쓰는 이미지 참조(직전 배포의 digest)
  local id
  id=$("${COMPOSE[@]}" ps -a -q "$1" 2>/dev/null | head -1)
  [ -n "$id" ] && docker inspect -f '{{.Config.Image}}' "$id" || true
}
prev_api=$(running_image api)
prev_web=$(running_image web)

# ── 3) 기동 ──
# up은 migrate 완료 → api healthy → web 순서를 기다린다. 마이그레이션이 실패하거나
# api가 unhealthy가 되면 여기서 0이 아닌 값으로 끝난다.
up_with() {  # <api> <migrate> <web> [up 추가 인자…]
  API_IMAGE="$1" MIGRATE_IMAGE="$2" WEB_IMAGE="$3" "${COMPOSE[@]}" up -d --no-build "${@:4}"
}

# ── 4) 헬스체크 ──
# web 컨테이너 안에서 자기 자신을 부른다. web → api 프록시와 api → DB까지 한 번에 본다.
healthy() {
  local i
  for i in $(seq 1 30); do
    if docker exec fixer-web node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(b=>process.exit(b.database==='connected'?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# ── 5) 롤백 ──
# 이미지만 되돌린다. DB 스키마는 되돌리지 않는다 — migrate를 옛 이미지로 다시 돌리지 않도록
# --no-deps로 api·web만 바꾼다. 그래서 마이그레이션은 옛 코드와도 맞는(추가만 하는) 형태여야 한다.
rollback() {
  if [ -z "$prev_api" ] || [ -z "$prev_web" ]; then
    log "직전 이미지가 없다(첫 배포) — 되돌릴 대상이 없다"
    return
  fi
  log "ROLLBACK → $prev_api / $prev_web"
  up_with "$prev_api" "$new_migrate" "$prev_web" --no-deps api web || true
  if healthy; then log "롤백 후 헬스체크 통과"; else log "롤백 후에도 헬스체크 실패 — 직접 확인이 필요하다"; fi
}

log "compose up ($TAG)"
if ! up_with "$new_api" "$new_migrate" "$new_web"; then
  rollback
  fail "compose up 실패 (마이그레이션 실패 또는 api unhealthy)"
fi
if ! healthy; then
  rollback
  fail "헬스체크 실패: web을 거친 /api/health가 DB 연결을 확인하지 못했다"
fi
log "헬스체크 통과"

# ── 6) 정리 ──
# 배포마다 이미지가 수 GB씩 쌓인다. record_site와 디스크를 나눠 쓰므로 지금 뜬 것만 남긴다.
# 다음 배포의 롤백 대상은 지금 것이다. 더 옛 이미지가 필요하면 GHCR에서 SHA 태그로 다시 받는다.
keep=$(docker image inspect -f '{{.Id}}' "$new_api" "$new_migrate" "$new_web")
for name in api migrate web; do
  docker image ls --no-trunc --format '{{.ID}} {{.Repository}}:{{.Tag}}' "$IMAGE_PREFIX-$name" |
    while read -r id ref; do
      grep -qxF "$id" <<<"$keep" || docker rmi "$ref" >/dev/null 2>&1 || true
    done
done

log "deploy OK ($TAG)"
