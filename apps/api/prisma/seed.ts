import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

// 환경변수는 저장소 루트의 .env 하나로만 관리한다.
// prisma.config.ts와 같은 이유로 두 단계 위를 가리킨다.
loadEnv({ path: '../../.env' });

/**
 * 카테고리 초기값. (`spec-fixed.md` §3.1 — 관리자 CRUD 화면 없이 seed로만 관리)
 *
 * `placeholderText`가 이 이슈(#11)의 핵심이다. 구인자가 "뭘 써야 할지 몰라
 * 부실한 공고를 올리는 것"을 막는 안내 문구이고, 문구만 고쳐 다시 seed하면
 * 재배포 없이 바뀐다.
 */
const CATEGORIES = [
  {
    slug: 'cleaning',
    name: '청소',
    sortOrder: 1,
    placeholderText:
      '평수와 방 개수, 화장실 개수를 적어 주세요. 청소 도구와 세제를 구인자가 준비하는지, 일하는 분이 가져와야 하는지도 알려 주세요.',
  },
  {
    slug: 'moving',
    name: '이사·짐옮기기',
    sortOrder: 2,
    placeholderText:
      '옮길 짐의 양과 가장 무거운 물건, 엘리베이터 유무와 층수를 적어 주세요. 사다리차가 필요한지도 알려 주세요.',
  },
  {
    slug: 'delivery',
    name: '배달·심부름',
    sortOrder: 3,
    placeholderText:
      '출발지와 도착지, 물건의 크기와 무게를 적어 주세요. 차량이나 오토바이가 필요한지도 알려 주세요.',
  },
  {
    slug: 'serving',
    name: '서빙·주방보조',
    sortOrder: 4,
    placeholderText:
      '가게 규모와 예상 손님 수, 맡을 일(홀 서빙·설거지·재료 손질)을 적어 주세요. 복장 규정이 있으면 함께 알려 주세요.',
  },
  {
    slug: 'construction',
    name: '건설·현장보조',
    sortOrder: 5,
    placeholderText:
      '현장 위치와 하는 일, 필요한 안전장비를 적어 주세요. 자격증이나 경력이 필요하면 반드시 밝혀 주세요.',
  },
  {
    slug: 'etc',
    name: '기타',
    sortOrder: 99,
    placeholderText:
      '어떤 일인지, 얼마나 걸리는지, 필요한 준비물이 있는지 구체적으로 적어 주세요.',
  },
];

async function main() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    // slug가 유니크라 upsert로 여러 번 돌려도 결과가 같다.
    // 문구를 고친 뒤 다시 돌리면 그 문구만 갱신된다.
    for (const category of CATEGORIES) {
      await prisma.category.upsert({
        where: { slug: category.slug },
        update: category,
        create: category,
      });
    }
    console.log(`카테고리 ${CATEGORIES.length}건을 seed했습니다.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
