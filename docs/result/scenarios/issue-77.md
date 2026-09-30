# 이슈 #77 — main에 머지하면 서버에 배포되고 fixer.kozow.com으로 접속된다

## 진행 방식 (예외)

#76과 같다. 도메인 로직이 없는 인프라 작업이라 **시그니처·시나리오·Red·Green 단계를 건너뛰었다.** 사용자가 명시적으로 승인한 예외다. AC마다 실제로 돌려 확인하고 명령과 결과를 아래에 남긴다. `@ac-verifier` → `/security-review` → `/create-pr` 게이트는 그대로 거친다.

이 이슈의 AC 대부분은 **main에 머지된 뒤 실제 서버에서만** 확인된다(워크플로가 main에서만 배포한다). 그래서 머지 전에는 같은 스크립트를 로컬에서 서버와 같은 배치로 돌려 확인했고, 서버에서만 볼 수 있는 부분은 "미검증"으로 남겼다.

## 만든 것

| 파일                           | 내용                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `.github/workflows/deploy.yml` | main의 CI 성공 → arm 러너에서 이미지 3개를 커밋 SHA 태그로 GHCR에 올림 → SSH로 서버 배포 → 외부 확인 |
| `scripts/deploy.sh`            | (서버에서 실행) pull → CI digest와 대조·고정 → `compose up` → 헬스체크 → 실패 시 직전 이미지로 롤백  |
| `docker-compose.prod.yml`      | 로그 크기 제한(json-file 10MB×3), node 컨테이너 하드닝(`no-new-privileges`, `cap_drop: ALL`)         |
| `apps/api/src/main.ts`         | `trust proxy` 1단계 — 서명 IP를 실제 사용자 IP로                                                     |

### 이 이슈에서 정한 것

- **마이그레이션은 compose의 `migrate` 서비스가 맡는다.** `deploy.sh`는 따로 돌리지 않는다. `up`이 postgres healthy → migrate 완료 → api healthy → web 순서를 기다리고, 마이그레이션이 실패하면 `up`이 실패한다
- **서버에는 저장소를 두지 않는다.** 워크플로가 그 커밋의 `docker-compose.prod.yml`과 `scripts/deploy.sh`만 `~/fixer`로 올린다. 서버에 저장소 읽기 권한이 필요 없고, 이미지와 compose가 늘 같은 커밋이다
- **GHCR 인증은 워크플로의 `GITHUB_TOKEN`(잡이 끝나면 만료)만 쓴다.** 서버에 장기 토큰을 두지 않는다. 토큰은 SSH의 **표준 입력**으로 넘긴다 — 명령줄에 두면 서버의 프로세스 목록(ps)에 보인다. 끝나면 `docker logout`
- **digest(이미지 내용의 해시. 태그와 달리 다른 이미지로 바꿔 달 수 없다)로 고정하고, CI가 올린 digest와 대조한다.** 빌드 잡이 `build-push-action`의 `outputs.digest`를 배포 잡에 넘기고(`API_DIGEST`·`MIGRATE_DIGEST`·`WEB_DIGEST`), 서버는 SHA 태그로 받은 이미지의 `RepoDigests`에 그 값이 있어야만 진행한다. 없으면 **아무것도 바꾸지 않고** 멈춘다 — push와 pull 사이에 태그가 바뀐 경우다. 통과하면 그 digest를 `API_IMAGE`·`MIGRATE_IMAGE`·`WEB_IMAGE`에 넣는다
  - 처음에는 대조 없이 `RepoDigests[0]`을 썼다. 로컬에서 이 값이 레지스트리가 아닌 로컬 빌드 이름(`fixer-api@sha256:…`)을 잡는 것을 보고 "받은 레지스트리 경로와 일치하는 것"으로 고쳤고, `ac-verifier`가 "서버가 pull 순간의 digest를 쓸 뿐 CI 결과와 맞춰 보지 않는다"고 짚어 대조를 넣었다
- **롤백은 이미지만 되돌린다. DB 스키마는 되돌리지 않는다.** 직전 이미지로 `up --no-deps api web` — 옛 migrate를 다시 돌리지 않는다. 그래서 마이그레이션은 옛 코드와도 맞는(추가만 하는) 형태여야 한다
- **정리:** 성공하면 지금 뜬 fixer 이미지만 남기고 지운다(배포마다 수 GB가 쌓이고, record_site와 디스크를 나눠 쓴다). 지우는 대상은 `ghcr.io/kimgyuhyun/fixer-*`뿐이다
- **`trust proxy`는 1단계**다. 근거는 아래 AC4

## AC 검증

### 로컬 검증 환경

Windows 11 + Docker Desktop 28.4(amd64). GHCR 대신 **로컬 레지스트리**(`registry:2`, `localhost:5055`)에 이미지를 올리고 `IMAGE_PREFIX=localhost:5055/fixer`로 `deploy.sh`를 돌렸다. 스크래치 디렉터리에 서버와 같은 배치(`docker-compose.prod.yml`, `scripts/deploy.sh`, 난수로 만든 `.env`)를 만들어 그 안에서 실행했다. `edge` 망은 `docker network create --internal --subnet 10.250.0.0/24 edge`로 만들었다. Caddy는 server-infra가 고정한 것과 같은 이미지(`caddy:2.11.4`, digest `6aeddd44c307…`)에 `http://fixer.kozow.com { reverse_proxy fixer-web:3000 }` 블록을 넣어 앞에 세웠다(로컬이라 TLS만 뺐다). 끝난 뒤 컨테이너·볼륨·망·테스트 이미지를 모두 지웠다.

### AC1 — main 머지 → CI 끝 → arm64 이미지가 커밋 SHA 태그로 GHCR에 → 서버가 그 digest로 배포 ⏳ 워크플로 미검증

**로컬 ✅ (deploy.sh의 digest 고정)**

```
TAG=v2 IMAGE_PREFIX=localhost:5055/fixer bash scripts/deploy.sh
  api     → localhost:5055/fixer-api@sha256:6bf30fd9…
  migrate → localhost:5055/fixer-migrate@sha256:dd744fec…
  web     → localhost:5055/fixer-web@sha256:bb5be9cf…
  deploy OK (v2)

docker inspect .Config.Image
  fixer-prod-api-1      localhost:5055/fixer-api@sha256:6bf30fd9…      ← 태그가 아니라 digest로 떴다
  fixer-prod-migrate-1  localhost:5055/fixer-migrate@sha256:dd744fec…
  fixer-web             localhost:5055/fixer-web@sha256:bb5be9cf…
남은 fixer 이미지      fixer-api:v2 fixer-migrate:v2 fixer-web:v2       ← 직전 v1은 정리됨
```

- 첫 배포(직전 이미지 없음)도 성공: 29초, `deploy OK (v1)`
- 워크플로 YAML은 파싱만 확인했다(잡 `build`→`deploy`, 트리거 `workflow_run[CI]`·`workflow_dispatch`)

**CI digest 대조 (ac-verifier 지적 반영 후 다시 확인)** — "CI push"를 흉내 내 v1을 올리고 그때의 digest를 `*_DIGEST`로 넘겼다.

```
1) 정상                       → 세 digest 일치, compose up, 헬스체크 통과, deploy OK, exit 0
                                 fixer-prod-api-1  localhost:5055/fixer-api@sha256:9da7d78f…  (넘긴 값 그대로)
2) push 뒤 v1 태그를 다른      → [deploy ERROR] localhost:5055/fixer-api:v1 가 CI가 올린 이미지(sha256:9da7d78f…)가
   이미지로 바꿔 달고 재배포       아니다 — 태그가 바뀌었을 수 있다. 아무것도 바꾸지 않고 멈춘다      exit 1
                                 api·web·migrate 컨테이너 ID 전후 동일 (재생성 없음)
3) *_DIGEST 없이 실행          → API_DIGEST: API_DIGEST required                                  exit 1
```

**미검증:** 워크플로 실제 실행(arm 러너 빌드, GHCR push, SSH 배포). 워크플로는 main에서만 배포하므로 **머지 뒤 첫 실행에서** 확인한다.

### AC2 — https://fixer.kozow.com 첫 화면, 인증서 정상, http → https ⏳ 미검증

로컬에서는 Caddy → fixer-web 경로만 확인했다: `GET /` → 200, `GET /api/health` → `{"status":"ok","database":"connected"}`.

**미검증:** 인증서·http 리다이렉트. server-infra에 블록을 넣고 서버에서 반영한 뒤 확인한다. `deploy.yml`의 "외부 확인" 단계가 배포마다 `https://fixer.kozow.com/`과 `/api/health`를 본다.

### AC3 — 서버(arm64) 첫 배포 직후 seed → 관리자 로그인·관리자 화면 (bcrypt 실제 하드웨어) ⏳ 서버 미검증

**로컬 ✅ (amd64, 하드닝 적용한 migrate로)**

```
docker compose -f docker-compose.prod.yml run --rm --no-deps migrate prisma db seed
  → 관리자 계정을 seed했습니다.   (cap_drop ALL · no-new-privileges 상태에서도 동작)

(Caddy 경유)
POST /api/auth/login (ADMIN_EMAIL·ADMIN_PASSWORD)  → 200
GET  /api/admin/members (관리자 쿠키)              → 200
GET  /admin/members     (관리자 쿠키)              → 200
GET  /admin/members     (쿠키 없음)                → 307 → /login
```

로그인 쿠키가 `Secure`라 http로 확인할 때는 curl이 쿠키를 보내지 않는다. 응답의 `Set-Cookie`를 `Cookie` 헤더로 직접 실어 확인했다.

**서버에서 seed할 때 주의:** 서버에는 빌드용 이미지 이름(`fixer-migrate:local`)이 없다. 이슈 본문의 명령을 그대로 치면 compose가 이미지를 찾지 못한다. 지금 떠 있는 migrate의 digest를 넘긴다.

```bash
cd ~/fixer
MIGRATE_IMAGE=$(docker inspect -f '{{.Config.Image}}' fixer-prod-migrate-1) \
  docker compose -f docker-compose.prod.yml run --rm migrate prisma db seed
```

**미검증:** 실제 A1 하드웨어에서의 bcrypt·seed·관리자 로그인.

### AC4 — 동의서 서명 시 저장되는 IP가 실제 사용자 IP ✅ (로컬, 실제 Caddy 이미지) · ⏳ 서버 미검증

**먼저 경로를 실측했다.** api 자리에 받은 헤더를 그대로 돌려주는 서버를 두고, Caddy → fixer-web(운영 이미지) → api로 위조 헤더를 보냈다.

```
curl -H 'X-Forwarded-For: 6.6.6.6, 7.7.7.7' -H 'X-Real-IP: 8.8.8.8' (Caddy 경유)
api가 받은 것:  socket = web의 app 망 IP(172.28.0.3)
               X-Forwarded-For = "172.27.0.1"     ← Caddy가 본 클라이언트 IP 하나. 위조값은 버려짐
               X-Real-IP = "8.8.8.8"              ← Caddy가 손대지 않음 (Express는 이 헤더를 안 본다)
```

- Caddy는 클라이언트가 보낸 X-Forwarded-For를 **버리고 덮어쓴다**(server-infra README와 일치)
- Next rewrites 프록시(Next 16.3.5의 `proxy-request.js`, httpxy를 `xfwd` 없이 씀)는 X-Forwarded-For에 **자기 것을 덧붙이지 않고 그대로** 넘긴다

그래서 api가 받는 X-Forwarded-For의 마지막 값이 곧 사용자 IP이고, 믿을 것은 **바로 앞 프록시(web) 1단계**뿐이다. `app.set('trust proxy', 1)`로 정했다.

- 대역(`10.250.0.0/24` 등)으로 믿지 않은 이유: Next가 덧붙이지 않으므로 체인에 Caddy 주소가 나타나지 않는다. api가 직접 보는 것은 web의 `app` 망 주소인데, 그 대역은 도커가 자동 배정한다
- 실패 방향이 안전하다: Next가 나중에 덧붙이기 시작하면 req.ip가 Caddy 주소가 된다(틀린 값이지 위조된 값은 아니다)

**가입 → 서명 → DB에 저장된 IP (Caddy 경유, 위조 헤더 포함)**

```
요청 헤더: X-Forwarded-For: 6.6.6.6 / X-Real-IP: 8.8.8.8
email-verification 200 → verify 200 → signup → POST /api/agreements 201

Agreement.ip
  이번 변경 api        172.31.0.1           ← Caddy가 본 클라이언트 IP(xff-public 게이트웨이)
  대조: #76 api 이미지  ::ffff:172.29.0.3    ← web 컨테이너 IP (trust proxy 없음)
위조값 6.6.6.6 · 8.8.8.8, Caddy(10.250.0.3), web(172.29.0.3) 어느 것도 저장되지 않았다
```

**남는 경로:** `edge` 망에 붙은 다른 컨테이너(Caddy, record_site의 lol-nginx)는 Caddy를 거치지 않고 fixer-web에 직접 X-Forwarded-For를 실어 보낼 수 있다. 그 컨테이너가 뚫린 경우에만 해당한다.

**미검증:** 서버에서 실제 공인 IP로 서명해 저장값 확인.

### AC5 — 배포 후 api 헬스체크 실패 → 이전 이미지로 되돌리고 배포 실패 ✅ (로컬)

v2가 떠 있는 상태에서 일부러 망가뜨린 이미지로 배포했다. 세 경우 모두 직전(v2) digest로 돌아왔고 스크립트가 **exit 1**로 끝났다(워크플로 잡이 실패한다).

| 경우                   | 만든 방법                      | 결과                                                                                                     |
| ---------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| api unhealthy (v3)     | api CMD를 서버 없이 대기하도록 | `dependency failed to start: container fixer-prod-api-1 is unhealthy` → ROLLBACK → 롤백 후 헬스체크 통과 |
| 마이그레이션 실패 (v4) | migrate CMD를 `exit 1`로       | `service "migrate" didn't complete successfully: exit 1` → ROLLBACK → 통과, exit 1 (33초)                |
| web 경유 실패 (v5)     | web CMD를 서버 없이 대기하도록 | 헬스체크 60초 실패 → ROLLBACK → 통과, exit 1 (140초)                                                     |

롤백 뒤 컨테이너 이미지는 `fixer-api@sha256:6bf30fd9…`·`fixer-web@sha256:bb5be9cf…`(v2)였다.

**확인한 것:** 마이그레이션이 실패하면 api·web 컨테이너는 **이미 새 이미지로 재생성(시작 전)된 상태**다. compose가 전부 만든 뒤 순서대로 시작하기 때문이다. 그래서 "up이 실패하면 옛 컨테이너가 그대로 돌고 있다"고 가정할 수 없고, 이 경우에도 롤백이 필요하다.

**헬스체크 기준:** `up`이 api healthy(compose의 healthcheck — `/api/health`의 `database: connected`)를 기다리고, 그 뒤 `deploy.sh`가 **web 컨테이너 안에서** `/api/health`를 불러 web → api → DB를 한 번에 본다.

### AC6 — fixer 배포 중에도 kdagg.kozow.com(record_site)은 영향 없음 ⏳ 미검증

설계로 막은 것:

- 호스트 포트 없음. 80/443은 server-infra의 Caddy만 연다
- compose 프로젝트 `fixer-prod`, 자기 망(`app`·`data`·`egress`)만 만들고 `edge`는 external로 붙기만 한다
- 모든 컨테이너에 `mem_limit`·`cpus`. 서버에서 빌드하지 않는다
- 이미지 정리는 `ghcr.io/kimgyuhyun/fixer-*`만 대상으로 한다(`docker image prune` 같은 전역 정리를 하지 않는다)

**미검증:** 서버에서 배포 전후로 kdagg.kozow.com 응답·record_site 컨테이너 상태 확인.

### AC7 — 배포 후 fixer 컨테이너들의 실제 메모리 사용량 기록 ⏳ 서버 미검증

로컬(amd64, 가입·서명·관리자 로그인 직후) 참고값:

| 컨테이너 | mem_limit | 로컬 실측 |
| -------- | --------- | --------- |
| web      | 384m      | 51MiB     |
| api      | 512m      | 177MiB    |
| postgres | 512m      | 56MiB     |

**미검증:** 서버(arm64) 실측. `docker stats --no-stream`으로 기록한다.

## 추가로 넣은 것 (#76 보안 점검에서 넘어온 것)

**로그 크기 제한과 node 컨테이너 하드닝**을 compose에 넣었다. 실행 중인 컨테이너에서 확인:

```
postgres  log=json-file{max-file:3 max-size:10m}  secopt=[]                        capdrop=[]
migrate   log=json-file{max-file:3 max-size:10m}  secopt=[no-new-privileges:true]  capdrop=[ALL]  user=node
api       log=json-file{max-file:3 max-size:10m}  secopt=[no-new-privileges:true]  capdrop=[ALL]  user=node
web       log=json-file{max-file:3 max-size:10m}  secopt=[no-new-privileges:true]  capdrop=[ALL]  user=node
api·web /proc/1/status   CapEff: 0000000000000000   NoNewPrivs: 1
```

Postgres는 공식 이미지가 root로 시작해 권한을 내리므로 하드닝을 걸지 않았다. `read_only`는 넣지 않았다(Next가 캐시를 쓰는 경로 확인이 먼저다).

## 저장소 검증

```
pnpm build      → 통과
pnpm typecheck  → 통과
pnpm lint       → 오류 0 (경고 1건은 기존 apps/web 코드)
pnpm test       → shared 70 · web 142 · api 1,015 = 1,227건 통과
bash -n scripts/deploy.sh → 통과
```

## AC 독립 검증 (`@ac-verifier 77`, 2026-09-30)

코드상 결함 없음. 충족 1(AC5) / 구현됨·서버 확인 대기 5(AC1·2·3·4·6) / 미충족 1(AC7 — 서버 실행 뒤에만 채울 수 있음).

| 지적                                                                  | 처리                                          |
| --------------------------------------------------------------------- | --------------------------------------------- |
| 서버가 pull 순간의 digest를 쓸 뿐 CI가 올린 digest와 대조하지 않는다  | **고침.** 빌드 잡 digest를 넘겨 대조 (위 AC1) |
| 서버 준비에 DNS 항목이 없다                                           | 추가. 이미 서버 IP로 잡혀 있음을 확인         |
| 로컬에서 저장된 IP는 도커 게이트웨이라 공인 IP 보존은 서버에서만 확인 | 머지 후 확인 목록에 넣음 (IPv4·IPv6 각각)     |
| 두 저장소 배포가 같은 도커 로그인 정보를 공유                         | 알려진 한계에 기록                            |
| 실패한 배포의 이미지가 남고, SSH 끊김·타임아웃 시 롤백이 없다         | 알려진 한계에 기록                            |
| 수동 실행은 CI 통과를 보지 않는다                                     | 의도된 동작. 알려진 한계에 기록               |
| 실제 워크플로 이미지(attestation 포함 index)와 GHCR 토큰 pull 권한    | 첫 실제 배포에서 확인                         |

## 머지 후 확인 (서버)

- [ ] [AC1] Deploy 워크플로의 build·deploy 성공, 서버 `docker inspect -f '{{.Config.Image}}' fixer-prod-api-1 fixer-web`이 `@sha256:` 형태이고 워크플로 로그의 digest와 같다
- [ ] [AC2] 브라우저로 https://fixer.kozow.com 첫 화면, 인증서 정상. `curl -I http://fixer.kozow.com` → https로 리다이렉트
- [ ] [AC3] 서버에서 seed(위 AC3 명령) → 관리자 로그인 → 관리자 화면
- [ ] [AC4] 서명 후 `Agreement.ip`가 접속한 기기의 공인 IP와 같다 (IPv4·IPv6 각각)
- [ ] [AC6] 배포 전·중·후 `https://kdagg.kozow.com` 응답과 `lol-*` 컨테이너 상태가 그대로
- [ ] [AC7] `docker stats --no-stream` 서버 값을 이 문서에 기록

## 서버 준비 (첫 배포 전, 사람이 할 것)

| #   | 할 일                                                                                                                                                                       | 어디서              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 0   | DNS: `fixer.kozow.com`이 서버 IP를 가리키는지 확인. **확인됨** — 2026-09-30 `nslookup` 결과 `144.24.95.109`(kdagg.kozow.com과 같은 주소). 없으면 Caddy가 인증서를 못 받는다 | 로컬                |
| 1   | 배포 전용 SSH 키 쌍을 만들고 공개키를 서버 `ubuntu` 계정의 `~/.ssh/authorized_keys`에 넣는다                                                                                | 로컬 · 서버         |
| 2   | 리포 시크릿 `DEPLOY_SSH_KEY`(개인키), `DEPLOY_HOST`(서버 주소), `DEPLOY_KNOWN_HOSTS`(`ssh-keyscan` 결과 — 서버에서 본 지문과 대조)                                          | GitHub 설정         |
| 3   | `~/fixer/.env`를 `.env.production.example` 형식으로 만든다. 비밀값은 서버에서 `openssl rand -hex 32`로 만들고 `chmod 600`                                                   | 서버                |
| 4   | server-infra `caddy/Caddyfile`에 `fixer.kozow.com { reverse_proxy fixer-web:3000 }` → main push → 서버에서 `bash deploy.sh`                                                 | server-infra · 서버 |
| 5   | PR 머지 → Deploy 워크플로 실행 확인                                                                                                                                         | GitHub              |
| 6   | 첫 배포 직후 seed 한 번(위 AC3의 명령)                                                                                                                                      | 서버                |

GHCR 패키지는 처음 push될 때 비공개로 만들어지고 이 저장소에 연결된다. 서버는 워크플로 토큰으로 받으므로 공개로 바꿀 필요가 없다.

## 알려진 한계

- **롤백은 이미지만 되돌린다.** 마이그레이션이 이미 적용된 뒤 헬스체크가 실패하면 DB는 새 스키마, 코드는 옛 버전이다. 마이그레이션을 추가만 하는 형태로 유지해야 한다
- **실패한 배포는 다운타임이 있다.** 롤백이 끝날 때까지(로컬 33~140초) 서비스가 멈춘다. 정상 배포도 컨테이너를 교체하는 동안 잠깐 끊긴다(무중단 배포 아님)
- **서버에서 compose를 직접 칠 때는 이미지 변수를 넘겨야 한다.** 안 넘기면 빌드용 이름을 찾다 실패한다(위 seed 명령 참고)
- **실패한 배포의 새 이미지는 남는다.** 정리는 성공 경로 끝에서만 돈다. 다음 성공 배포가 지운다
- **SSH가 끊기거나 잡이 시간 초과되면 롤백이 돌지 않는다.** 스크립트가 중간에 죽기 때문이다. 이때는 서버에서 상태를 직접 보고, 필요하면 워크플로를 다시 실행한다
- **fixer와 record_site 배포가 같은 서버 계정의 도커 로그인 정보(`~/.docker/config.json`)를 쓴다.** 두 배포가 동시에 돌면 한쪽의 `docker logout ghcr.io`가 다른 쪽의 pull 인증을 끊을 수 있다. 두 저장소의 배포 시각이 겹칠 때만 생기고, 끊긴 쪽은 pull 단계에서 실패해 아무것도 바꾸지 않는다
- 수동 실행(`workflow_dispatch`)은 CI 통과 여부를 보지 않고 main 최신을 배포한다. 시크릿을 넣은 뒤 첫 배포와 재배포용이다
- `edge` 망의 다른 컨테이너가 뚫리면 Caddy를 거치지 않고 X-Forwarded-For를 위조할 수 있다(AC4)
- 인증 코드·재설정 토큰은 여전히 api 로그로만 나온다. 로그는 이제 서비스당 최대 30MB로 잘린다
