# 이슈 #76 — 운영 이미지로 web·api·Postgres를 한 번에 띄운다

## 진행 방식 (예외)

도메인 로직이 없는 인프라 작업이라 AC가 "띄웠더니 된다" 형태다. 그래서 **시그니처·시나리오·Red·Green 단계를 건너뛰었다.** 사용자가 명시적으로 승인한 예외다. 대신 AC마다 실제로 컨테이너를 띄워 확인하고 명령과 결과를 아래에 남긴다. `@ac-verifier` → `/security-review` → `/create-pr` 게이트는 그대로 거친다.

## 만든 것

| 파일                      | 내용                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `apps/api/Dockerfile`     | 타깃 두 개. `runtime`(기본, dist + 운영 의존만)과 `migrate`(prisma CLI·tsx·소스 포함, `migrate deploy`와 seed) |
| `apps/web/Dockerfile`     | Next standalone(실행에 필요한 파일만 추려낸 빌드 결과) 출력만 담는다                                           |
| `apps/web/next.config.ts` | `output: 'standalone'`, `outputFileTracingRoot`를 저장소 루트로                                                |
| `docker-compose.prod.yml` | postgres → migrate(한 번 실행 후 종료) → api → web 순서. 호스트 포트 없음                                      |
| `.env.production.example` | 비밀값은 전부 빈칸                                                                                             |
| `.dockerignore`           | `.env*`, `.storage`, `node_modules`, 빌드 산출물 제외                                                          |
| `.gitignore`              | `.env.production.example`을 추적 대상으로(기존 `.env.*` 규칙에 걸려 커밋이 안 됐다)                            |

### 망 구성

| 망       | internal | 붙는 것                | 이유                            |
| -------- | -------- | ---------------------- | ------------------------------- |
| `edge`   | 예       | web                    | Caddy가 들어오는 곳 (external)  |
| `app`    | 예       | web, api               | Next rewrites 프록시 → api      |
| `data`   | 예       | api, migrate, postgres | DB 접속. web은 DB에 닿지 않는다 |
| `egress` | 아니오   | api                    | 카카오 로컬 등 외부 호출        |

### 이 이슈에서 정한 것

- **rewrites 목적지는 빌드 때 굳는다.** web 이미지는 빌드 인자 `API_INTERNAL_URL`(기본 `http://api:3001`)을 받는다. 런타임 환경변수로는 바뀌지 않는다. 빌드된 `server.js`에 `api:3001`이 박혀 있는 것을 확인했다
- **api에 `NODE_ENV=production`을 넣지 않는다.** `ConsoleMailProvider`가 기동을 막는다(#77의 "공개 전 필수 후속")
- **`DATABASE_URL`은 compose가 `POSTGRES_*`로 조립한다.** 같은 값을 두 번 적지 않게 하려는 것이라, `POSTGRES_PASSWORD`는 URL에 그대로 쓸 수 있는 문자(hex 난수)여야 한다
- 프로젝트 이름을 `fixer-prod`로 고정했다. 개발용 `docker-compose.yml`(프로젝트 `fixer`)과 볼륨 이름이 겹치면 한쪽의 `down -v`가 다른 쪽 DB를 지운다
- 이미지 이름은 `API_IMAGE`·`MIGRATE_IMAGE`·`WEB_IMAGE`로 바꿀 수 있다. #77이 GHCR digest를 넣는 자리다

## AC 검증

검증 환경: Windows 11 + Docker Desktop 28.4(amd64). arm64는 QEMU 에뮬레이션(다른 CPU용 프로그램을 소프트웨어로 흉내 내 실행하는 방식)으로 돌렸다. 로컬에 `edge` 망을 `docker network create --internal --subnet 10.250.0.0/24 edge`로 만들어 쓰고 끝난 뒤 지웠다. `.env`는 스크래치 경로에 난수로 만들어 `--env-file`로 넘겼고 값은 출력하지 않았다.

외부에서 들어오는 요청은 **`edge` 망에 붙인 임시 node 컨테이너**에서 `http://fixer-web:3000`으로만 보냈다. Caddy가 보는 경로와 같다.

### AC1 — 운영 compose로 기동하면 web·api·Postgres가 뜨고 첫 화면이 열린다 ✅

```
docker compose -f docker-compose.prod.yml --env-file <prod.env> up -d --build
→ postgres Healthy → migrate Exited(0) → api Healthy → fixer-web Started

(edge 망에서) GET /                → 200 text/html
(edge 망에서) GET /api/health      → 200 {"status":"ok","database":"connected"}   ← web → api 프록시 경유
```

### AC2 — 마이그레이션이 api보다 먼저 적용되고, 실패하면 api가 뜨지 않는다 ✅

성공 경로 — 컨테이너 시각:

```
migrate  finished = 09:06:57.024   exit 0   "All migrations have been successfully applied."
api      started  = 09:06:57.316
```

실패 경로 — 별도 프로젝트(`-p fixer-migfail`)의 빈 DB에 첫 마이그레이션과 같은 이름의 테이블(`EmailVerification`)을 먼저 만들어 두고 기동:

```
migrate  → Error: P3005, exit 1
compose  → service "migrate" didn't complete successfully: exit 1   (compose exit 1)
api      → status=created, StartedAt=0001-01-01 (한 번도 시작되지 않음)
```

### AC3 — seed를 한 번 실행하면 관리자로 로그인된다 ✅

```
docker compose -f docker-compose.prod.yml run --rm migrate prisma db seed
→ 동의서 템플릿 v1 / 카테고리 6건 / 관리자 계정을 seed했습니다.

POST /api/auth/login (ADMIN_EMAIL·ADMIN_PASSWORD) → 200
GET  /api/admin/members (관리자 쿠키)              → 200
GET  /api/admin/members (일반 회원 쿠키)           → 403
```

seed 전에는 `GET /api/agreements/template`이 503(`AGREEMENT_TEMPLATE_MISSING`)이다. **배포 직후 seed를 한 번 돌려야 가입 5단계(서명)가 된다.**

### AC4 — 서명 후 컨테이너를 지우고 다시 띄워도 서명 PDF가 남는다 ✅

가입(인증 코드는 api 로그에서 읽음) → 서명 → `down`(볼륨 유지) → `up -d` → 같은 회원으로 로그인해 조회:

```
before  c74f5af4…  /data/agreements/agreements/3d956379-….pdf
down    → 컨테이너 0개, 볼륨 fixer-prod_agreements·fixer-prod_postgres-data 남음
after   c74f5af4…  (같은 해시)
GET /api/agreements/{id}   → 200 application/pdf 1659B
GET /api/agreements/mine   → 200 (같은 id)
```

### AC5 — api·Postgres는 호스트 포트가 없고 edge에서도 닿지 않는다. fixer-web만 edge에 붙는다 ✅

```
docker inspect PortBindings   fixer-web {}   api {}   postgres {}
네트워크                       fixer-web = edge, app
                               api       = app, data, egress
                               postgres  = data

(edge 망에서 TCP 연결)
  fixer-web:3000              → 닿음
  api:3001, postgres:5432     → 못 닿음 (이름 해석 안 됨)
  api·postgres 컨테이너 IP 4개 → 못 닿음 (ENETUNREACH)
(web 컨테이너 안에서)  api:3001 → 닿음,  postgres:5432 → 못 닿음
(외부 통신)            api → dapi.kakao.com:443 닿음,  web·postgres → 못 닿음
```

호스트의 5432·3001이 열려 있던 것은 각각 개발용 `fixer-postgres`와 다른 프로젝트의 `ott-grafana`였다(fixer-prod 컨테이너의 바인딩은 비어 있다).

### AC6 — `linux/arm64`로 빌드되고 그 위에서 로그인이 된다 (bcrypt) ✅ (에뮬레이션)

```
docker buildx build --platform linux/arm64 -f apps/api/Dockerfile [--target migrate] ... --load .
docker buildx build --platform linux/arm64 -f apps/web/Dockerfile ... --load .

Postgres까지 arm64로 빈 DB에서 기동 (-p fixer-arm64, DOCKER_DEFAULT_PLATFORM=linux/arm64)
  web·api uname -m → aarch64,  image Architecture → arm64
  api 안에서 bcrypt.hashSync/compareSync → "arm64 hash ok true"
  seed → 관리자 로그인 200, /api/admin/members 200
  가입 → 서명 201 → 로그인 200 → 서명 PDF 200
```

위 검증 뒤 migrate 이미지 구조를 바꿨다(아래 "이미지 크기"). 바뀐 migrate로 다시 확인한 것:

- amd64, 빈 DB: `up -d` → migrate `All migrations have been successfully applied.` → api Healthy → `run --rm migrate prisma db seed`(템플릿·카테고리·관리자 seed 로그) → 가입 201 → 서명 201 → 서명 PDF 200. **관리자 로그인은 이 재실행에서 다시 하지 않았다**(구조 변경 전 AC3 증거만 있다)
- arm64, 빈 Postgres: `prisma migrate deploy` → `All migrations have been successfully applied.` seed는 다시 돌리지 않았다

api·web 런타임 이미지의 구성은 바뀌지 않았다.

bcrypt는 패키지에 들어 있는 `prebuilds/linux-arm64/bcrypt.glibc.node`를 쓴다(설치 스크립트 없이). **실제 arm64 하드웨어(오라클 A1)에서는 미검증** — #77 배포에서 확인된다.

### AC7 — 컨테이너마다 `mem_limit`·`cpus`, 앱 컨테이너는 root가 아니다 ✅

| 컨테이너 | mem_limit | cpus | 실행 사용자                   | 실측 메모리(amd64, 가입·서명 직후) |
| -------- | --------- | ---- | ----------------------------- | ---------------------------------- |
| web      | 384m      | 0.5  | node (uid 1000)               | 약 37MiB                           |
| api      | 512m      | 1.0  | node (uid 1000)               | 약 127~186MiB                      |
| migrate  | 512m      | 0.5  | node (uid 1000)               | (한 번 돌고 종료)                  |
| postgres | 512m      | 1.0  | postgres (공식 이미지가 강등) | 약 28~48MiB                        |

에뮬레이션에서는 api가 약 400MiB로 나왔는데 QEMU 자체의 메모리가 섞인 값이라 기준으로 쓰지 않는다. 서버 실측은 #77 AC.

### AC8 — 비밀값이 이미지 레이어에 없고 `.env`로만 들어간다. 운영 예시 파일에 개발용 값이 없다 ✅

세 이미지(web·api·migrate)에 대해 `.env`의 실제 비밀값 5개(`AUTH_JWT_SECRET`, `PORTONE_WEBHOOK_SECRET`, `ACCOUNT_ENCRYPTION_KEY`, `ADMIN_PASSWORD`, `POSTGRES_PASSWORD`)를 값 그대로 찾았다(값은 출력하지 않음):

```
이미지 Env + docker history   → 값 0건, 비밀 변수 이름 0건
docker export 파일시스템 전체  → 값 0건,  .env 파일 없음
```

- 비밀값은 compose의 `${VAR:?}`로만 들어간다. 비어 있으면 기동 전에 멈춘다: `required variable AUTH_JWT_SECRET is missing a value` (exit 1)
- `.env.production.example`의 비밀값 칸은 전부 비어 있다
- `.dockerignore`가 `**/.env*`(예시 파일 제외)와 `**/.storage`를 **모든 깊이에서** 빌드 컨텍스트에서 뺀다. 처음엔 루트에만 걸려 있었는데 `ac-verifier`가 짚어 고쳤다. `apps/api/.env`, `apps/web/.env.local`, `apps/api/.storage/`를 임시로 만들고 migrate 이미지와 web 빌드 단계를 빌드해 셋 다 들어가지 않는 것을 확인했다
- `ADMIN_*`은 migrate 서비스에만, JWT·웹훅·암호화 키는 api에만 넘긴다. web은 비밀값을 받지 않는다

## 이미지 크기

| 이미지  | amd64  | arm64  |
| ------- | ------ | ------ |
| web     | 385MB  | 405MB  |
| api     | 826MB  | 846MB  |
| migrate | 1.61GB | 1.61GB |

migrate는 처음 3GB였다. build 단계를 그대로 이어서 `pnpm fetch`가 받은 워크스페이스 전체 스토어가 남았기 때문이다. 설치 결과(`/app`)만 옮기도록 바꿔 1.61GB가 됐다. 남은 대부분은 api의 devDependency(테스트·린트 도구 포함)다.

## 알려진 한계 · 후속

- **prisma CLI가 운영 api 이미지의 `node_modules/.pnpm`에 들어 있다.** `@prisma/client`가 prisma를 (선택적) peerDependency로 선언해 잠금 파일에 묶여 있기 때문이다. 최상위 `node_modules`와 PATH에는 없고 서버가 실행하지 않는다. `security-exceptions.md` 1번과 같은 원인이다
- 로컬 Windows에서 `next build`는 standalone 출력과 함께 그대로 통과한다(확인함)
- 로그 로테이션(docker `json-file` 크기 제한), `cap_drop`·`read_only` 같은 런타임 하드닝은 넣지 않았다. AC 범위 밖이라 필요하면 따로 다룬다
- 인증 코드는 api 로그로만 나온다(메일 연동 전). #77의 "공개 전 필수 후속" 참고
