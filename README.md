# fixer

TypeScript 모노레포. 프론트(Next.js)와 백엔드(Nest.js)가 한 저장소를 쓰고, 요청·응답 규격은 `packages/shared`의 Zod 스키마 하나에서 나온다.

## 구조

```
apps/web        Next.js 16 (App Router) — 포트 3000
apps/api        Nest.js 11 + Prisma 7  — 포트 3001
packages/shared 프론트/백 공용 Zod 스키마
docker-compose.yml  PostgreSQL 17 (로컬 개발용, DB만 컨테이너)
```

## 새 환경에서 처음 세팅

### 1. 먼저 깔려 있어야 하는 것

| 도구         | 필요 버전                                        | 확인                  | 왜 이 버전인가                                                                                                                             |
| ------------ | ------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Node.js**  | **22 이상**                                      | `node -v`             | 루트 `package.json`의 `engines`. 22.17.0에서 검증했다                                                                                      |
| **pnpm**     | **10 이상** (전역 설치)                          | `pnpm -v`             | 10+는 `packageManager` 핀(`pnpm@11.22.0`)을 보고 스스로 그 버전으로 전환한다. 11.22.0에서 검증했다                                         |
| **gitleaks** | `git` 서브커맨드 지원 버전 (8.19+로 알려져 있다) | `gitleaks git --help` | 훅이 `gitleaks git --staged`를 쓴다. 구버전에는 이 서브커맨드가 없어 pre-commit이 `unknown command`로 커밋을 차단한다. 8.30.1에서 검증했다 |
| **Docker**   | (DB 컨테이너용)                                  | `docker -v`           | `pnpm db:up`이 PostgreSQL 17을 띄운다                                                                                                      |

```bash
npm i -g pnpm
```

```bash
winget install gitleaks
```

macOS는 `brew install gitleaks`. **설치 후 새 셸을 열어야** PATH에 잡힌다.

gitleaks 버전이 맞는지는 `gitleaks git --help`가 exit 0으로 끝나는지로 확인한다. 서브커맨드가 없는 구버전이면 exit 1이 나오고, 그 상태로는 커밋이 전부 막힌다.

pnpm은 `corepack enable pnpm`으로도 되지만 Node 설치 디렉터리에 써야 해서 Windows에서는 관리자 권한이 필요하다. `npm i -g pnpm`은 권한이 필요 없다.

**pnpm은 전역에 있어야 한다.** 루트 스크립트(`pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm db:*`)가 내부에서 다시 `pnpm`을 호출하기 때문에, `corepack pnpm ...`으로만 우회하면 `pnpm is not recognized`로 실패한다. 다만 **훅 자체는 pnpm이 없어도 동작한다** — pre-push는 pnpm이 없으면 corepack으로 넘어가고, Claude Stop 훅은 pnpm을 거치지 않고 각 패키지의 tsc를 node로 직접 실행한다.

### 2. 세팅

```bash
pnpm install && cp .env.example .env
```

이게 전부다. `pnpm install`이 나머지를 자동으로 한다(아래 "전달 경로" 참고).

### 3. 잘 됐는지 확인

```bash
pnpm typecheck
```

통과하면 생성물 3종이 제대로 만들어진 것이다. 실패하면 아래 전달 경로 표에서 빠진 단계를 찾는다.

훅까지 확인하려면 더미 커밋을 한 번 만들어 본다.

```bash
printf 'export const probe = {a:1,   b:"x"}\n' > packages/shared/src/probe.ts && git add . && git commit -m "test: hook probe"
```

- 커밋 후 `probe.ts`가 `export const probe = { a: 1, b: 'x' };`로 바뀌어 있으면 **pre-commit 정상**
- `git commit -m "잘못된 메시지"`가 차단되면 **commit-msg 정상**
- 확인이 끝나면 `git reset --hard HEAD~1`로 되돌린다

### 전달 경로 — 훅 두 종류가 오는 방식이 다르다

|                   | Claude Code 훅                                         | git 훅                                          |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------- |
| 파일              | `.claude/settings.json`, `.claude/hooks/*.mjs`         | `.husky/pre-commit`, `commit-msg`, `pre-push`   |
| `git pull`로 오나 | 온다 (커밋된 파일)                                     | 온다 (커밋된 파일)                              |
| 추가 활성화 필요? | **불필요** — 파일만 있으면 동작한다                    | **필요** — `core.hooksPath`를 `.husky/_`로 지정 |
| 누가 활성화하나   | —                                                      | **husky** (`pnpm install`의 `prepare` 스크립트) |
| 안 도는 조건      | 세션을 저장소 루트가 아닌 곳에서 열면 설정을 안 읽는다 | `pnpm install`을 안 하면 훅이 아예 없다         |

git 훅은 원래 `.git/hooks/`에 두는데 **`.git`은 git이 추적하지 않아서 팀원에게 따라오지 않는다.** husky가 하는 일은 훅 스크립트를 추적되는 `.husky/`에 두고 `pnpm install` 때 `core.hooksPath`를 그쪽으로 바꿔주는 것뿐이다. 검사 자체는 husky가 하지 않는다.

`pnpm install`이 자동으로 해주는 것:

| 하는 것                | 어디에 설정돼 있나                | 없으면                              |
| ---------------------- | --------------------------------- | ----------------------------------- |
| husky 훅 활성화        | 루트 `package.json`의 `prepare`   | git 훅이 전부 안 돈다               |
| `packages/shared` 빌드 | `packages/shared`의 `postinstall` | `@fixer/shared`를 못 찾는 타입 오류 |
| `prisma generate`      | `apps/api`의 `postinstall`        | Prisma 클라이언트 타입 오류         |
| `next typegen`         | `apps/web`의 `postinstall`        | `LayoutProps`를 못 찾는 타입 오류   |

뒤의 세 개는 편의가 아니라 전제 조건이다. 하나라도 없으면 `pnpm typecheck`가 코드와 무관한 오류로 실패하고, 훅이 첫 턴부터 빨간불이 되어 아무도 훅을 믿지 않게 된다.

> 이 저장소의 훅은 **Windows에서만 실측했다.** OS 종속 명령을 쓰지 않고, 훅 파일은 `.gitattributes`로 LF 고정, 의존 바이너리는 모두 직접 의존성이라 macOS·Linux에서도 동작할 구조지만 실제 실행은 확인되지 않았다. 다른 OS에서 처음 클론했다면 위 3번 검증을 한 번 돌려보고, 안 되면 알려주면 된다.

## 개발 중

```bash
pnpm db:up
```

```bash
pnpm dev
```

`pnpm dev`는 web, api, shared(watch)를 동시에 띄운다. 브라우저에서 http://localhost:3000 을 열면 API와 DB 연결 상태가 보인다.

| 명령                          | 하는 일                           |
| ----------------------------- | --------------------------------- |
| `pnpm dev`                    | web + api + shared 워치 동시 실행 |
| `pnpm db:up` / `pnpm db:down` | PostgreSQL 컨테이너 기동 / 정지   |
| `pnpm db:reset`               | 볼륨까지 지우고 DB 재생성         |
| `pnpm db:migrate`             | Prisma 마이그레이션 생성·적용     |
| `pnpm db:studio`              | Prisma Studio                     |
| `pnpm typecheck`              | 전체 타입 검사                    |
| `pnpm format`                 | 전체 포맷 적용                    |
| `pnpm format:check`           | 포맷 검사만 (고치지 않음)         |
| `pnpm lint`                   | 전체 린트 (자동수정 없음)         |

## 로컬에서 도는 검사

### git 훅 (husky)

| 시점         | 하는 일                                                            |
| ------------ | ------------------------------------------------------------------ |
| `pre-commit` | 스테이지된 파일 `prettier --write` + gitleaks 시크릿 스캔          |
| `commit-msg` | commitlint — Conventional Commits, 제목 72자 이하, 마침표 X        |
| `pre-push`   | shared 빌드 → `pnpm -r typecheck` → `pnpm -r lint` (자동수정 없음) |

실측: pre-commit + commit-msg 합쳐 약 3.4초, pre-push 약 13초(앞 단계에서 실패하면 더 짧다).

pre-push는 CI가 없는 동안의 임시 방지턱이다. **사람이 직접 편집해서 커밋한 경로는 여기 말고 타입 검사를 하는 곳이 없다** — Claude Stop 훅은 에이전트로 작업할 때만 돌고, 세션을 루트에서 열지 않으면 아예 돌지 않는다. CI가 생기면 이 훅의 내용을 그대로 CI로 옮기고 여기서는 지운다.

### Claude Code 훅 (`.claude/settings.json`)

| 이벤트                               | 하는 일                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `PostToolUse` (Edit/Write/MultiEdit) | 편집된 파일에 Prettier 적용. 파일이 실제로 바뀌면 에이전트에게 다시 읽으라고 알린다 |
| `Stop`                               | 워크스페이스 전체 타입 검사. 소스가 그대로면 건너뛴다                               |

실측: PostToolUse 약 0.27초, Stop 약 2.8초(변경 없으면 0.15초).

Stop 훅이 이 저장소에서 특히 중요하다. `packages/shared`를 고치면 web·api 양쪽 타입이 깨지는데 파일 단위 검사로는 잡히지 않는다. web·api가 `@fixer/shared`를 `dist`의 `.d.ts`로 해석하므로, 훅은 shared를 먼저 빌드한 뒤 나머지를 검사한다. 같은 이유로 `pnpm typecheck`도 shared 빌드를 선행한다.

### 훅을 늘리거나 옮길 때의 기준

넷 중 하나라도 "아니오"면 훅이 아니라 CI로 보내거나 아예 넣지 않는다.

1. **빠른가** — pre-commit 4초, Stop 30초가 상한. 넘으면 사람이 `--no-verify`를 습관적으로 쓰게 되고 훅 전체가 무력화된다
2. **로컬에서 완결되나** — "내 컴퓨터에서 돈다"가 아니라 "클론 직후에도 도나". 외부 서비스·컨테이너·DB가 필요하면 CI로
3. **결과가 명확한가** — 차단하려면 오탐이 0이어야 한다
4. **실제로 뭔가 잡나** — 기대 적발률이 0이면 넣지 않는다

그리고 세 가지 규칙:

- **포매터는 훅, 린터는 CI(현재는 pre-push).** 포매터는 자동수정이 항상 옳아 판단할 게 없다. 린터는 "판단이 필요한 지적"을 만들기 때문에 즉시 차단에 맞지 않는다
- **`eslint --fix`를 PostToolUse에 넣지 않는다.** 자동수정이 코드 의미를 바꾸는 규칙(`react-hooks/exhaustive-deps` 등)이 섞여 있어, 아무도 안 본 수정을 에이전트 뒤에서 적용하게 된다. 사람이 커밋하는 시점(lint-staged)이라면 괜찮지만, 지금은 속도 때문에 거기서도 빼두었다
- **조용히 통과할 곳과 차단할 곳을 매번 의식적으로 정한다.** Claude 훅은 인프라 문제(node_modules 없음, 타임아웃)에서 조용히 통과한다 — 커밋 시점에 git 훅이 다시 잡기 때문이다. 반대로 gitleaks가 없으면 "통과"가 아니라 "검사를 못 한 것"이므로 pre-commit은 차단한다. 조용히 실패하는 검사는 없는 검사보다 나쁘다

**pre-commit 상한이 2초가 아니라 4초인 이유.** Windows에서 node 프로세스를 세 번 띄우는 것만으로 1.2초가 든다(실측: lint-staged 1.29초 + gitleaks 0.50초 + commitlint 0.68초 + git 자체 약 0.9초). 설정으로 줄일 여지가 거의 없어서 상한을 실측에 맞췄다. 여기서 더 늘어나면 검사를 빼는 대신 CI로 옮긴다.

## CI로 미룬 것

CI는 아직 없다. 만들 때 아래를 넣는다. 로컬 훅에 없거나, 있어도 로컬만으로는 믿을 수 없는 것들이다.

- **`pnpm format:check`** — 훅은 스테이지된 파일만 포맷한다. 저장소 전체가 포맷돼 있다는 보장은 CI에서만 나온다
- **`pnpm lint` (자동수정 없이)** — 지금은 pre-push에 있지만 `--no-verify`로 우회할 수 있다
- **`packages/shared`의 eslint 설정** — 현재 이 패키지에는 eslint 설정이 없어 `pnpm -r lint`가 건너뛴다
- **gitleaks 전 히스토리 스캔** (`gitleaks git .`) — pre-commit은 스테이지된 변경만 본다. 실측 0.7초
- **`pnpm typecheck`** — pre-push와 Claude Stop 훅에 있지만 둘 다 우회 가능하다(`--no-verify`, 세션을 루트가 아닌 곳에서 열기)
- **`pnpm build`** — 빌드는 로컬 훅에 전혀 없다
- **테스트** — 아직 없다. 생기면 CI와 Stop 훅 양쪽에 넣는다
- **Prisma 마이그레이션 검증** (`prisma migrate status` / `migrate diff`) — DB 컨테이너가 필요해 위 기준 2번(클론 직후 로컬 완결)을 못 넘긴다. 명확히 CI 몫이다

## 알아둘 것

- **환경변수는 루트 `.env` 하나만 쓴다.** `apps/api`와 `apps/web`이 각자 `dotenv`로 이 파일을 읽는다. 새 변수를 추가하면 `.env.example`에도 함께 적는다.
- **브라우저의 `/api/*` 요청은 Next의 `rewrites`가 Nest로 넘긴다.** 같은 출처가 되므로 CORS 설정이 없고, 쿠키도 그대로 실린다. 로컬에 nginx를 띄우지 않는 이유다.
- **DB 스키마는 반드시 마이그레이션으로 바꾼다.** 컨테이너에 직접 DDL을 실행하지 않는다. `apps/api/prisma/schema.prisma`를 고치고 `pnpm db:migrate`를 돌린 뒤, 생성된 `prisma/migrations/` 파일을 스키마 변경과 함께 커밋한다.
- **Prisma 7은 드라이버 어댑터로만 접속한다.** 클라이언트 생성물은 `apps/api/src/generated/prisma`에 만들어지며 커밋하지 않는다. `pnpm install`의 `postinstall`이 자동으로 생성한다.
- **포맷은 루트 설정 하나로 통일돼 있다.** `prettier.config.mjs` 하나만 쓰고 하위 패키지에는 개별 설정을 두지 않는다. `.gitattributes`가 작업 트리 줄바꿈을 LF로 고정하므로 `core.autocrlf` 설정과 무관하게 동작한다.
- **일괄 포매팅 커밋은 blame에서 제외한다.** `.git-blame-ignore-revs`에 등록돼 있고, 로컬에서 켜려면 한 번 설정하면 된다: `git config blame.ignoreRevsFile .git-blame-ignore-revs`
