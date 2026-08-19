/**
 * PostToolUse (Edit|Write|MultiEdit) — 편집된 파일에 Prettier를 적용한다(fixer 역할).
 *
 * 자식 프로세스를 띄우지 않고 Prettier의 Node API를 직접 쓴다.
 * Windows에서 execFileSync/spawnSync는 .cmd/.bat을 실행할 수 없어(EINVAL)
 * prettier.cmd·npx·pnpm을 부르면 훅이 아무것도 안 하고 exit 0으로 지나간다.
 * API 호출은 그 함정을 아예 우회하고 프로세스 시작 비용도 들지 않는다.
 */
import fs from 'node:fs';

const PASS = 0; // 그냥 통과
const NOTIFY = 2; // stderr 내용을 에이전트에게 전달

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
  });
}

async function main() {
  const input = JSON.parse(await readStdin());
  const file = input?.tool_input?.file_path;
  if (!file || !fs.existsSync(file)) return PASS;

  const prettier = await import('prettier');

  // 대상 여부와 파서를 Prettier에게 그대로 물어본다.
  // 여기서 확장자 목록을 따로 관리하면 prettier.config.mjs·.prettierignore와 어긋난다.
  const info = await prettier.getFileInfo(file, {
    ignorePath: ['.prettierignore'],
  });
  if (info.ignored || !info.inferredParser) return PASS;

  const before = fs.readFileSync(file, 'utf8');
  const config = await prettier.resolveConfig(file);
  const after = await prettier.format(before, { ...config, filepath: file });
  if (after === before) return PASS;

  fs.writeFileSync(file, after);

  // 디스크 내용이 바뀐 사실은 반드시 알려야 한다. 에이전트가 모르면 다음 편집이
  // 이미 없는 텍스트를 기준으로 이뤄져 실패한다.
  // 파일이 실제로 바뀐 경우에만 여기 도달한다(위에서 before === after면 통과).
  process.stderr.write(
    `Prettier가 ${file} 을 재포맷했습니다. 이 파일을 다시 편집하기 전에 다시 읽으세요.\n`,
  );
  return NOTIFY;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    // 의도된 동작이다: 인프라 문제(node_modules 미설치, 구문 오류로 파싱 실패,
    // 파일 잠금 등)에서는 조용히 통과시킨다. 여기서 막으면 에이전트가 이유를 알 수
    // 없는 벽에 부딪힌다. 놓친 포맷은 커밋 시점에 lint-staged가 잡는다.
    process.exit(PASS);
  });
