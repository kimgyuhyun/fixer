# fixer

TypeScript 모노레포. 프론트(Next.js)와 백엔드(Nest.js)가 한 저장소를 쓰고, 요청·응답 규격은 `packages/shared`의 Zod 스키마 하나에서 나온다.

## 구조

```
apps/web        Next.js 16 (App Router) — 포트 3000
apps/api        Nest.js 11 + Prisma 7  — 포트 3001
packages/shared 프론트/백 공용 Zod 스키마
docker-compose.yml  PostgreSQL 17 (로컬 개발용, DB만 컨테이너)
```

## 처음 한 번

```bash
pnpm install && cp .env.example .env
```

`pnpm install`이 자동으로 해주는 것 — 따로 명령을 칠 필요가 없다.

- husky git 훅 활성화 (`prepare` 스크립트)
- `packages/shared` 빌드, `prisma generate`, `next typegen` (각 패키지 `postinstall`)

마지막 세 개는 편의가 아니라 전제 조건이다. 하나라도 없으면 `pnpm typecheck`가 코드와 무관한 오류로 실패해서, 훅이 첫 턴부터 빨간불이 된다.

### `git pull`로 따라오지 않는 것

기기마다 한 번씩 직접 해야 한다.

| 해야 할 것                                         | 왜                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **pnpm 전역 설치** (`npm i -g pnpm`)               | 루트 스크립트가 내부에서 `pnpm`을 다시 호출한다                                         |
| `pnpm install`                                     | node_modules, husky 훅 활성화, 위의 생성물 3종                                          |
| **gitleaks 바이너리 설치**                         | npm 패키지가 아니다. 없으면 pre-commit이 커밋을 **차단**한다                            |
| **Claude Code 세션은 반드시 저장소 루트에서 열기** | 하위·상위 디렉터리에서 열면 `.claude/settings.json`을 읽지 않아 훅이 전부 조용히 죽는다 |

gitleaks 설치:

```bash
winget install gitleaks
```

macOS는 `brew install gitleaks`. 설치 후에는 새 셸을 열어야 PATH에 잡힌다.

**`pnpm`은 명령으로 잡혀 있어야 한다.** 루트 스크립트(`pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm db:*`)가 내부에서 다시 `pnpm`을 호출하기 때문에, corepack으로만 우회하면 `pnpm is not recognized`로 실패한다.

```bash
npm i -g pnpm
```

관리자 권한이 필요 없다. pnpm 10+는 `packageManager` 핀(`pnpm@11.22.0`)을 보고 스스로 그 버전으로 전환한다. `corepack enable pnpm`은 Node 설치 디렉터리에 써야 해서 Windows에서는 관리자 권한이 필요하다.

훅 자체는 pnpm이 전역에 없어도 동작한다. pre-push는 pnpm이 없으면 corepack으로 넘어가고, Claude Stop 훅은 pnpm을 거치지 않고 각 패키지의 tsc를 node로 직접 실행한다.

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

| 시점         | 하는 일                                                     |
| ------------ | ----------------------------------------------------------- |
| `pre-commit` | 스테이지된 파일 `prettier --write` + gitleaks 시크릿 스캔   |
| `commit-msg` | commitlint — Conventional Commits, 제목 72자 이하, 마침표 X |
| `pre-push`   | `pnpm -r lint` (자동수정 없음)                              |

실측: pre-commit + commit-msg 합쳐 약 3.4초, pre-push 약 8.5초(실패 시 4.5초).

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
- **`pnpm typecheck`** — Stop 훅은 소스 지문이 같으면 건너뛰고, 세션을 루트에서 열지 않으면 아예 돌지 않는다
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
