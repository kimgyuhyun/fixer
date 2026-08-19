/**
 * 스테이지된 파일에 포매터만 돌린다(fixer 역할).
 * 포매터는 자동수정이 항상 옳아서 사람이 판단할 게 없으므로 커밋 시점 자동 교정에 맞는다.
 *
 * eslint는 여기 넣지 않았다. 실측에서 apps/api는 파일 1개만 넘겨도 3.2초가 걸린다
 * (projectService: true + recommendedTypeChecked 조합이라 대상 파일 수와 무관하게
 * TS 프로그램을 통째로 세운다). 두 앱을 태우면 6초를 넘겨 pre-commit 예산 2초를
 * 크게 벗어나고, 그러면 사람이 --no-verify를 습관적으로 쓰게 되어 훅 전체가 무력화된다.
 * eslint는 .husky/pre-push에서 워크스페이스 단위로 실행한다.
 *
 * 확장자를 명시적으로 나열한 이유: 목록에 없는 파일은 prettier가 파서를 못 찾아 실패한다.
 * 생성물·락파일은 .prettierignore가 걸러주므로 여기서 다시 제외하지 않는다.
 */
export default {
  '*.{ts,tsx,mjs,cjs,js,jsx,json,md,yml,yaml,css}': 'prettier --write',
};
