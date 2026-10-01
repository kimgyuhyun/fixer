import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  // 웹훅 서명은 **본문 문자열 그대로**를 대상으로 계산된다. 파싱한 뒤 다시
  // 직렬화하면 키 순서나 공백이 달라져 맞지 않는다. 그래서 원본을 함께 남긴다.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // 웹은 Next의 rewrites를 통해 /api/*로 호출한다. 프록시가 경로를 그대로 넘기므로
  // Nest도 같은 접두사를 쓴다. 같은 출처가 되니 CORS 설정은 두지 않는다.
  app.setGlobalPrefix('api');

  // req.ip(동의서 서명 IP)를 실제 사용자 IP로 만든다. 운영 경로는
  // Caddy → web(Next rewrites) → api 이고, 실측 결과(이슈 #77):
  //   - Caddy는 클라이언트가 보낸 X-Forwarded-For를 버리고 실제 IP 하나로 덮어쓴다
  //   - Next 프록시는 X-Forwarded-For에 자기 것을 덧붙이지 않고 그대로 넘긴다
  // 그래서 api가 받는 헤더의 마지막 값이 곧 사용자 IP이고, 믿을 것은 바로 앞의
  // 프록시(web) 한 단계뿐이다. 더 넓게 믿으면 사용자가 헤더에 적은 값이 IP가 된다.
  app.set('trust proxy', 1);

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  console.log(`[api] http://localhost:${port}/api`);
}

void bootstrap();
