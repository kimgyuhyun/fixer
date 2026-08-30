# 통합 테스트

DB가 필요한 테스트는 여기 둔다. Testcontainers(테스트할 때 진짜 DB를 컨테이너로 잠깐 띄워주는 도구)로 Postgres 17을 띄운다.

`src/` 아래의 `*.test.ts`는 DB 없이 도는 단위 테스트다. 둘을 섞지 않는다.

## 왜 경량 DB를 안 쓰는가

`spec-fixed.md` §9에서 확정된 사항이다. 포인트 원장은 트랜잭션 격리와 행 잠금 동작이 DB마다 달라서, 운영과 같은 Postgres에서 검증해야 의미가 있다.

H2는 애초에 쓸 수 없다 — JDBC 전용 자바 임베디드 DB라 Prisma에서 연결되지 않는다.

## 쓰는 법

컨테이너 기동이 느리므로 **파일당 한 번만 띄우고** 테스트 사이에는 truncate로 비운다. 매 테스트마다 새로 띄우면 통합 테스트가 사실상 못 쓸 만큼 느려진다.

```ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

let container: Awaited<ReturnType<PostgreSqlContainer['start']>>;
let prisma: PrismaClient;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: container.getConnectionUri() }),
  });
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});
```

Prisma 7은 드라이버 어댑터로만 접속하므로 운영 코드(`PrismaService`)와 같은 방식을 쓴다.

스키마가 생기면 컨테이너 기동 후 `prisma db push`로 테이블을 만든다. (마이그레이션 파일이 쌓이면 `migrate deploy`로 바꾼다.)

## 실행 전제

**Docker Desktop이 켜져 있어야 한다.** 꺼져 있으면 `Could not find a working container runtime strategy`로 실패한다.
