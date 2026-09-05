import { Controller, Get } from '@nestjs/common';
import { categoryListSchema, type Category } from '@fixer/shared';
import { CategoryService } from './category.service';

/** 카테고리 목록의 HTTP 경계. (이슈 #11) */
@Controller('categories')
export class CategoryController {
  constructor(private readonly service: CategoryService) {}

  @Get()
  async list(): Promise<Category[]> {
    const rows = await this.service.listActive();

    // 공유 스키마로 파싱해 내보낸다. 스키마에 isActive 자리가 없으므로
    // 실수로 얹어 보내도 여기서 떨어져 나간다.
    return categoryListSchema.parse(rows);
  }
}
