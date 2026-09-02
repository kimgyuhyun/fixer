import { Injectable } from '@nestjs/common';

/** DB에서 읽은 카테고리 한 줄. `isActive`는 여기까지만 온다 */
export interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  placeholderText: string;
  isActive: boolean;
}

export interface CategoryStore {
  /** 활성만, 정렬순으로. 거르고 정렬하는 것은 저장소의 일이다 */
  listActive(): Promise<CategoryRecord[]>;
}

/** 공고 작성 화면이 읽는 카테고리 목록. (이슈 #11) */
@Injectable()
export class CategoryService {
  constructor(private readonly store: CategoryStore) {}

  async listActive(): Promise<CategoryRecord[]> {
    throw new Error('not implemented');
  }
}
