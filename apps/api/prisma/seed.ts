import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

// 환경변수는 저장소 루트의 .env 하나로만 관리한다.
// prisma.config.ts와 같은 이유로 두 단계 위를 가리킨다.
loadEnv({ path: '../../.env' });

/**
 * 동의서 템플릿 v1. (`ADR-AGR-4` — 파일은 git으로, 메타데이터는 DB로)
 *
 * `signatureBox`는 **서명이 들어갈 자리**다. 클라이언트가 좌표를 보내지 않으므로
 * (ADR-AGR-1) 이 값이 서명 위치를 통제하는 유일한 지점이다. 템플릿을 바꾸면
 * 이 사각형도 함께 맞춰야 하고, 안 맞추면 서명이 엉뚱한 곳에 박힌다.
 */
const TEMPLATE = {
  version: 1,
  /** `AGREEMENT_STORAGE_PATH` 기준 상대 키 (ADR-AGR-3) */
  fileKey: 'agreement-templates/v1.pdf',
  /** git에 있는 원본. seed가 저장소로 복사한다 */
  assetPath: 'assets/agreement-templates/v1.pdf',
  signatureBox: { page: 0, x: 140, y: 180, width: 180, height: 60 },
};

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
  const storageRoot = process.env.AGREEMENT_STORAGE_PATH;
  if (!storageRoot) {
    throw new Error(
      'AGREEMENT_STORAGE_PATH가 없습니다. 저장소 루트의 .env를 확인하세요 (.env.example 참고).',
    );
  }

  const bytes = await readFile(TEMPLATE.assetPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  // 템플릿 파일을 저장소로 옮긴다. LocalFileStore가 fileKey로 읽을 수 있어야
  // 하는데, git의 assets 폴더와 저장 루트는 다른 곳이다.
  const target = join(storageRoot, TEMPLATE.fileKey);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    // 활성 템플릿은 하나여야 한다. 둘이면 어느 것으로 서명되는지 불확실해진다.
    await prisma.agreementTemplate.updateMany({
      where: { version: { not: TEMPLATE.version } },
      data: { isActive: false },
    });

    const data = {
      fileKey: TEMPLATE.fileKey,
      sha256,
      signatureBox: TEMPLATE.signatureBox,
      isActive: true,
    };
    await prisma.agreementTemplate.upsert({
      where: { version: TEMPLATE.version },
      update: data,
      create: { version: TEMPLATE.version, ...data },
    });

    console.log(
      `동의서 템플릿 v${TEMPLATE.version}을 seed했습니다. (${target})`,
    );

    // slug가 유니크라 upsert로 여러 번 돌려도 결과가 같다.
    // 문구를 고친 뒤 다시 돌리면 그 문구만 갱신된다. (#11)
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
