import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * **동의서 조회 요청에 회원 id가 실려 다니지 않는다.** (이슈 #72 AC2·AC6)
 *
 * 계약에는 보내는 쪽과 읽는 쪽이 있다. 화면에서 쿼리만 지우고 컨트롤러가
 * 계속 읽고 있으면 계약은 그대로고, 주소창에 손으로 붙여 넣으면 다시 통한다.
 * 그래서 둘을 함께 본다.
 *
 * 1. `apps/web`에서 동의서를 읽는 코드가 회원 id를 쿼리에 담지 않는다
 * 2. 컨트롤러가 회원 id를 쿼리에서 읽지 않는다
 * 3. 그 회원 id를 **토큰에서** 가져온다 — 이게 없으면 1·2는 "조회가 아예
 *    동작하지 않는다"로도 충족돼 버린다
 *
 * **서명(`POST`)은 대상이 아니다.** 가입 5단계는 세션이 없어 몸체의 회원 id를
 * 그대로 쓴다(`spec-fixed.md` §2.2). 그래서 파일 전체에서 단어를 금지하지
 * 않고 **쿼리로 받는 자리**만 본다.
 *
 * 한 패키지의 테스트가 다른 패키지를 읽는다. 계약이 두 패키지에 걸쳐 있어서
 * 한쪽에서만 보면 반쪽만 지켜진다 (#71이 같은 이유로 같은 모양을 썼다).
 */

/** 이 테스트는 패키지 디렉터리(`apps/api`)에서 실행된다 */
const REPO_ROOT = resolve(process.cwd(), '../..');
const WEB_SRC = join(REPO_ROOT, 'apps', 'web', 'src');
const AGREEMENT_CONTROLLER = join(
  REPO_ROOT,
  'apps',
  'api',
  'src',
  'agreement',
  'agreement.controller.ts',
);

/** 동의서를 읽는 요청 주소 */
const AGREEMENT_READ_CALL = /\/api\/agreements\/(mine|\$\{)/;
/** 그 주소에 회원 id를 쿼리로 붙이는 코드 */
const MEMBER_ID_QUERY = /[?&](userId|memberId)=/;
/** 컨트롤러가 회원 id를 쿼리에서 읽는 자리 */
const READS_MEMBER_ID_FROM_QUERY = /@Query\(\s*'(userId|memberId)'/;

function sourceFilesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFilesUnder(path));
      continue;
    }
    if (/\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

/** 어긴 파일과 어긴 이유. 빈 목록이어야 한다 */
function offenders(): string[] {
  const found: string[] = [];

  for (const file of sourceFilesUnder(WEB_SRC)) {
    const source = readFileSync(file, 'utf8');
    if (AGREEMENT_READ_CALL.test(source) && MEMBER_ID_QUERY.test(source)) {
      found.push(
        `${relative(REPO_ROOT, file)} — 동의서 조회 요청에 회원 id를 싣는다`,
      );
    }
  }

  const controller = readFileSync(AGREEMENT_CONTROLLER, 'utf8');
  if (READS_MEMBER_ID_FROM_QUERY.test(controller)) {
    found.push(
      'apps/api/src/agreement/agreement.controller.ts — 회원 id를 쿼리에서 읽는다',
    );
  }
  if (!controller.includes('@CurrentMember()')) {
    found.push(
      'apps/api/src/agreement/agreement.controller.ts — 회원 id를 토큰에서 읽지 않는다',
    );
  }

  return found;
}

describe('동의서 조회 요청', () => {
  it('should leave no code that puts a member id into the agreement read request', () => {
    expect(offenders()).toEqual([]);
  });
});
