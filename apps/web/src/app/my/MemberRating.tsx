'use client';

/**
 * 내 평점 두 개를 나란히 보여준다. (이슈 #26, `spec-fixed.md` §7)
 *
 * 구인자로서와 구직자로서의 신뢰도는 별개라 **한 줄로 합치지 않는다** (§2.1).
 * 표시 규칙은 `formatRating` 하나뿐이다 — 표본 3건 미만이면 "신규"다.
 *
 * 못 불러오면 **아무것도 그리지 않는다.** 평점은 부가 정보라 마이페이지
 * 전체를 실패로 만들 이유가 없다.
 */
export function MemberRating({
  userId: _userId,
}: {
  userId: string;
}): React.JSX.Element | null {
  throw new Error('not implemented');
}
