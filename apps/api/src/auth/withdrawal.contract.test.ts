import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * **탈퇴 요청에 회원 id가 실려 다니지 않는다.** (이슈 #71 AC4)
 *
 * 탈퇴 화면은 아직 없다 — 그래서 지울 코드도 없다. 하지만 계약에는 보내는
 * 쪽과 읽는 쪽이 있고, 읽는 쪽이 살아 있으면 화면이 생기는 순간 다시 싣게
 * 된다. 그래서 둘을 함께 본다.
 *
 * 1. `apps/web`에서 탈퇴를 부르는 코드가 회원 id를 담지 않는다 (보내는 쪽)
 * 2. 컨트롤러가 회원 id를 몸체·쿼리에서 읽지 않는다 (읽는 쪽)
 * 3. 그 회원 id를 **토큰에서** 가져온다 — 이게 없으면 1·2는 "탈퇴가 아예
 *    동작하지 않는다"로도 충족돼 버린다
 *
 * 한 패키지의 테스트가 다른 패키지를 읽는다. 계약이 두 패키지에 걸쳐 있어서
 * 한쪽에서만 보면 반쪽만 지켜진다.
 */

/** 이 테스트는 패키지 디렉터리(`apps/api`)에서 실행된다 */
const REPO_ROOT = resolve(process.cwd(), '../..');
const WEB_SRC = join(REPO_ROOT, 'apps', 'web', 'src');
const WITHDRAWAL_CONTROLLER = join(
  REPO_ROOT,
  'apps',
  'api',
  'src',
  'auth',
  'withdrawal.controller.ts',
);

/** 회원을 가리키는 칸 이름들 */
const MEMBER_ID = /\b(userId|memberId)\b|회원 id/;
/** 탈퇴를 부르는 코드 */
const WITHDRAW_CALL = /auth\/withdraw/;
/** HTTP 요청의 몸체·쿼리를 읽는 코드 */
const READS_REQUEST = /@Body\(|@Query\(|\bbody\b|\bquery\b/;

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
    if (WITHDRAW_CALL.test(source) && MEMBER_ID.test(source)) {
      found.push(`${relative(REPO_ROOT, file)} — 탈퇴 요청에 회원 id를 싣는다`);
    }
  }

  const controller = readFileSync(WITHDRAWAL_CONTROLLER, 'utf8');
  if (MEMBER_ID.test(controller) && READS_REQUEST.test(controller)) {
    found.push(
      'apps/api/src/auth/withdrawal.controller.ts — 회원 id를 요청에서 읽는다',
    );
  }
  if (!controller.includes('@CurrentMember()')) {
    found.push(
      'apps/api/src/auth/withdrawal.controller.ts — 회원 id를 토큰에서 읽지 않는다',
    );
  }

  return found;
}

describe('탈퇴 요청', () => {
  it('should leave no code that puts a member id into the withdraw request', () => {
    expect(offenders()).toEqual([]);
  });
});
