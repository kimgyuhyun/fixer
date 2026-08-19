/**
 * 워크스페이스 단일 포매터 설정. 하위 패키지에 개별 설정을 두지 않는다.
 *
 * singleQuote / trailingComma는 apps/api가 쓰던 값을 그대로 루트로 승격했다.
 * 기존 코드 실측에서 api 소스의 import 17건이 이미 싱글쿼트였고, 반대쪽(web·shared)은 6건뿐이라
 * 이쪽으로 맞추는 편이 재포맷 범위가 작다.
 *
 * 나머지 옵션은 Prettier 기본값이 현재 코드 실측치(들여쓰기 2칸)와 일치해서 명시하지 않는다.
 */
export default {
  singleQuote: true,
  trailingComma: 'all',
  // .gitattributes가 작업 트리를 LF로 고정하므로 여기서도 lf로 못 박는다.
  // "auto"로 두면 파일마다 기준이 달라져 --check가 무엇을 보장하는지 알 수 없게 된다.
  endOfLine: 'lf',
};
