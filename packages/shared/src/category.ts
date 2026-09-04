import { z } from 'zod';

/**
 * 공고 카테고리. (`spec-fixed.md` §3.1, 이슈 #11)
 *
 * 관리자 CRUD 화면 없이 Prisma seed로만 관리한다. 문구를 고칠 때
 * 재배포가 필요 없도록 `placeholderText`를 값으로 들고 있다.
 */
export const categorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, { error: '카테고리 이름이 필요합니다.' }),
  slug: z.string().min(1),
  sortOrder: z.number().int(),
  /**
   * 상세 내용 입력란에 뜨는 안내 문구.
   *
   * 비어 있으면 안 된다 — 이 이슈의 존재 이유가 "뭘 써야 할지 몰라 부실한
   * 공고를 올리는 것"을 막는 것이라, 문구가 없는 카테고리는 그 목적을 못 채운다.
   */
  placeholderText: z
    .string()
    .min(1, { error: '카테고리 안내 문구가 필요합니다.' }),
});
export type Category = z.infer<typeof categorySchema>;

/** 목록 응답. 활성만, 정렬순으로 온다 */
export const categoryListSchema = z.array(categorySchema);
