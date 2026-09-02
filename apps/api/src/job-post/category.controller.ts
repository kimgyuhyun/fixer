import { Controller, Get } from '@nestjs/common';
import type { Category } from '@fixer/shared';
import { CategoryService } from './category.service';

/** 카테고리 목록의 HTTP 경계. (이슈 #11) */
@Controller('categories')
export class CategoryController {
  constructor(private readonly service: CategoryService) {}

  @Get()
  async list(): Promise<Category[]> {
    throw new Error('not implemented');
  }
}
