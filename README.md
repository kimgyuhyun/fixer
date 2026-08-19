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
pnpm install && cp .env.example .env && pnpm --filter @fixer/shared build && pnpm --filter @fixer/api prisma:generate
```

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

## 알아둘 것

- **환경변수는 루트 `.env` 하나만 쓴다.** `apps/api`와 `apps/web`이 각자 `dotenv`로 이 파일을 읽는다. 새 변수를 추가하면 `.env.example`에도 함께 적는다.
- **브라우저의 `/api/*` 요청은 Next의 `rewrites`가 Nest로 넘긴다.** 같은 출처가 되므로 CORS 설정이 없고, 쿠키도 그대로 실린다. 로컬에 nginx를 띄우지 않는 이유다.
- **DB 스키마는 반드시 마이그레이션으로 바꾼다.** 컨테이너에 직접 DDL을 실행하지 않는다. `apps/api/prisma/schema.prisma`를 고치고 `pnpm db:migrate`를 돌린 뒤, 생성된 `prisma/migrations/` 파일을 스키마 변경과 함께 커밋한다.
- **Prisma 7은 드라이버 어댑터로만 접속한다.** 클라이언트 생성물은 `apps/api/src/generated/prisma`에 만들어지며 커밋하지 않는다. `pnpm install` 후에는 `prisma:generate`를 한 번 돌려야 한다.
