/**
 * Stop — 워크스페이스 전체 타입체크 (mirror 역할: 늦게 알아도 복구되는 검사).
 *
 * 이 저장소에서 특히 필요하다. packages/shared를 고치면 web·api 양쪽 타입이
 * 깨지는데, 파일 단위 검사로는 절대 잡히지 않는다.
 *
 * pnpm을 부르지 않고 각 패키지의 tsc를 node로 직접 실행한다.
 * Windows에서 spawnSync는 pnpm.cmd를 실행할 수 없고(EINVAL) 그러면 훅이 조용히
 * 죽는다. process.execPath로 부르면 그 경로가 아예 없다.
 * 세 패키지 모두 typescript 5.9.3으로 해석되므로 pnpm -r typecheck와 결과가 같다.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PASS = 0; // 그냥 통과
const NOTIFY = 2; // stderr 내용을 에이전트에게 전달

const PROJECTS = ['packages/shared', 'apps/api', 'apps/web'];

// postinstall이 만드는 것들. 하나라도 없으면 타입 오류가 쏟아지지만 그건 코드 문제가
// 아니라 설치가 덜 된 상태다. 이 경우 조용히 통과시킨다 — 의도된 동작이다.
// 코드와 무관한 에러로 매 턴 빨간불이 뜨면 훅 자체를 안 믿게 된다.
const PREREQS = [
  'packages/shared/dist/index.d.ts',
  'apps/api/src/generated/prisma/client.ts',
  'apps/web/.next/types',
];

// .git/ 안에 두면 .gitignore를 손댈 필요가 없다.
const STATE = path.join('.git', 'claude-typecheck.json');

const PRISMA_SCHEMA = 'apps/api/prisma/schema.prisma';
const PRISMA_GENERATED_MODELS = 'apps/api/src/generated/prisma/models';

/**
 * 설치가 package.json·schema.prisma보다 뒤처진 상태를 찾는다.
 *
 * PREREQS는 "생성물이 있는가"만 본다. 한 번 설치한 뒤 pull만 받으면 생성물은 남아 있으니
 * 통과하고, 새로 추가된 의존성·모델이 전부 "타입 오류"로 수백 줄 쏟아진다(2026-09-25 실측:
 * 8/16 설치 그대로 두고 #40 이후 머지분을 받은 체크아웃).
 * 선언된 패키지 폴더와 모델별 생성 파일이 있는지만 본다. mtime 비교는 git checkout만으로도
 * 뒤집혀서 쓰지 않는다.
 */
function findStaleInstall() {
  const missingPackages = [];
  for (const proj of PROJECTS) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(proj, 'package.json'), 'utf8'),
    );
    const declared = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    };
    for (const name of Object.keys(declared)) {
      if (!fs.existsSync(path.join(proj, 'node_modules', name))) {
        missingPackages.push(name);
      }
    }
  }
  const schema = fs.readFileSync(PRISMA_SCHEMA, 'utf8');
  const missingModels = [...schema.matchAll(/^model\s+(\w+)/gm)]
    .map((match) => match[1])
    .filter(
      (model) =>
        !fs.existsSync(path.join(PRISMA_GENERATED_MODELS, `${model}.ts`)),
    );
  return { missingPackages: [...new Set(missingPackages)], missingModels };
}

function describeStaleInstall({ missingPackages, missingModels }) {
  const preview = (names) =>
    names.length > 8
      ? `${names.slice(0, 8).join(', ')} 외 ${names.length - 8}개`
      : names.join(', ');
  const lines = [
    '설치가 package.json·schema.prisma보다 오래돼 타입체크를 건너뜁니다 (코드 문제 아님).',
  ];
  if (missingPackages.length > 0) {
    lines.push(
      `- 설치 안 된 패키지 ${missingPackages.length}개: ${preview(missingPackages)}`,
    );
  }
  if (missingModels.length > 0) {
    lines.push(
      `- Prisma 클라이언트에 없는 모델 ${missingModels.length}개: ${preview(missingModels)}`,
    );
  }
  lines.push(
    '`corepack pnpm install` 을 실행하면 해결됩니다. 같은 상태로는 다시 알리지 않습니다.',
  );
  return `${lines.join('\n')}\n`;
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    // 상태 파일이 없거나 깨졌으면 없는 것으로 본다.
    return null;
  }
}

function writeState(state) {
  try {
    fs.writeFileSync(STATE, JSON.stringify(state));
  } catch {
    // 상태를 못 써도 검사 결과는 유효하다. 다음 턴에 한 번 더 돌 뿐이다.
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
  });
}

/** 타입체크 결과에 영향을 주는 파일들의 경로·크기·mtime 지문. */
function fingerprint() {
  const parts = [];
  const stat = (p) => {
    const s = fs.statSync(p);
    parts.push(`${p}|${s.size}|${s.mtimeMs}`);
  };
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else stat(p);
    }
  };
  for (const proj of PROJECTS) {
    walk(path.join(proj, 'src'));
    for (const f of fs.readdirSync(proj)) {
      // tsconfig*.json만 본다. tsconfig.tsbuildinfo는 매 실행마다 바뀌어서
      // 지문에 넣으면 "변경 없음" 판정이 절대 나오지 않는다(실측으로 걸렸다).
      if (
        f === 'package.json' ||
        (f.startsWith('tsconfig') && f.endsWith('.json')) ||
        f.endsWith('.d.ts')
      ) {
        stat(path.join(proj, f));
      }
    }
  }
  stat('tsconfig.base.json');
  parts.sort();
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

async function main() {
  const input = JSON.parse(await readStdin());

  // 무한루프 방지. 이 훅이 막은 뒤 에이전트가 다시 멈추면 이 값이 true로 들어온다.
  if (input?.stop_hook_active) return PASS;

  for (const p of PREREQS) if (!fs.existsSync(p)) return PASS;

  const prev = readState();

  // 오래된 설치는 코드 문제가 아니라 tsc를 돌려도 소음뿐이다. 한 줄로 한 번만 알린다.
  // 매 턴 알리면 사람이 훅을 끄고, 아예 안 알리면 타입체크가 꺼진 걸 아무도 모른다.
  const stale = findStaleInstall();
  if (stale.missingPackages.length > 0 || stale.missingModels.length > 0) {
    const staleKey = [
      ...stale.missingPackages,
      '|',
      ...stale.missingModels,
    ].join(',');
    if (prev?.staleKey === staleKey) return PASS;
    writeState({ staleKey, at: new Date().toISOString() });
    process.stderr.write(describeStaleInstall(stale));
    return NOTIFY;
  }

  const fp = fingerprint();
  // 소스가 그대로고 지난번에 통과했으면 건너뛴다(매 턴 2.7초 절약).
  // 지난번에 실패했으면 오류가 아직 남아 있으므로 다시 돌려서 보고한다.
  if (prev && prev.fingerprint === fp && prev.ok) return PASS;

  const failures = [];
  for (const proj of PROJECTS) {
    const tsc = path.join(proj, 'node_modules', 'typescript', 'bin', 'tsc');
    if (!fs.existsSync(tsc)) return PASS; // node_modules 미설치 → 조용히 통과
    // packages/shared는 --noEmit 없이 돌려 dist를 갱신한다.
    // web·api는 @fixer/shared를 dist의 .d.ts로 해석하므로, shared의 src만 고친
    // 상태에서는 stale한 dist를 보고 아무 오류도 못 잡는다(실측 확인).
    // 이 훅이 존재하는 주된 이유가 그 크로스 패키지 파손 감지라서 여기서 빌드한다.
    const emits = proj === 'packages/shared';
    const r = spawnSync(
      process.execPath,
      [
        tsc,
        ...(emits ? [] : ['--noEmit']),
        '-p',
        path.join(proj, 'tsconfig.json'),
      ],
      { encoding: 'utf8', timeout: 60_000 },
    );
    // 타임아웃·spawn 실패도 인프라 문제다 → 조용히 통과. 상태는 기록하지 않는다.
    if (r.error || r.status === null) return PASS;
    if (r.status !== 0) {
      failures.push(
        `[${proj}]\n${`${r.stdout ?? ''}${r.stderr ?? ''}`.trim()}`,
      );
    }
  }

  const ok = failures.length === 0;
  writeState({ fingerprint: fp, ok, at: new Date().toISOString() });

  if (ok) return PASS;
  process.stderr.write(
    `타입 오류가 남아 있습니다 (pnpm -r typecheck 와 동일).\n\n${failures.join('\n\n')}\n`,
  );
  return NOTIFY;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    // 의도된 동작이다: 훅 자체의 문제로 턴을 막지 않는다.
    process.exit(PASS);
  });
