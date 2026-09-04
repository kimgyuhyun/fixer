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
  } finally {
    await prisma.$disconnect();
  }
}

void main();
