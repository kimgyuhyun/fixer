import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // 웹훅 서명은 **본문 문자열 그대로**를 대상으로 계산된다. 파싱한 뒤 다시
  // 직렬화하면 키 순서나 공백이 달라져 맞지 않는다. 그래서 원본을 함께 남긴다.
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  // 웹은 Next의 rewrites를 통해 /api/*로 호출한다. 프록시가 경로를 그대로 넘기므로
  // Nest도 같은 접두사를 쓴다. 같은 출처가 되니 CORS 설정은 두지 않는다.
  app.setGlobalPrefix('api');

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  console.log(`[api] http://localhost:${port}/api`);
}

void bootstrap();
