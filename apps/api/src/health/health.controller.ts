import { Controller, Get } from '@nestjs/common';
import { healthResponseSchema, type HealthResponse } from '@fixer/shared';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthResponse> {
    let database: HealthResponse['database'] = 'disconnected';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'connected';
    } catch {
      // DB가 죽어도 응답 자체는 200으로 내려서 "무엇이 끊겼는지"를 보여준다.
    }

    // 공유 스키마로 파싱해 응답 규격이 웹과 어긋나지 않게 만든다.
    return healthResponseSchema.parse({
      status: 'ok',
      database,
      checkedAt: new Date().toISOString(),
    });
  }
}
