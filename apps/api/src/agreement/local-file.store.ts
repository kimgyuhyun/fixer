import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FileStore } from './agreement.service';

/**
 * 로컬 볼륨 구현. (ADR-AGR-3)
 *
 * 저장 위치는 **배포 디렉토리 밖**이다(`spec-fixed.md` §2.3). 안에 두면
 * 재배포 때 업로드 파일이 통째로 사라진다. S3로 옮길 때는 이 클래스만 새로 쓴다 —
 * 도메인은 논리 키만 알고 실제 위치를 모른다.
 */
@Injectable()
export class LocalFileStore implements FileStore {
  private readonly root: string;

  constructor(config: ConfigService) {
    const root = config.get<string>('AGREEMENT_STORAGE_PATH');
    if (!root) {
      throw new Error(
        'AGREEMENT_STORAGE_PATH가 없습니다. 저장소 루트의 .env를 확인하세요 (.env.example 참고).',
      );
    }
    this.root = root;
  }

  async put(
    key: string,
    bytes: Buffer,
  ): Promise<{ sha256: string; bytes: number }> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);

    return {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch (error) {
      // 없는 파일을 지워도 성공이다. 파기 배치가 멱등해야 한다 (§9).
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
    }
  }

  /**
   * 논리 키를 실제 경로로 옮긴다.
   *
   * **키가 저장 루트를 벗어나지 못하게 막는다.** `../`가 섞이면 저장소 밖의
   * 파일을 읽거나 덮어쓸 수 있다.
   */
  private resolve(key: string): string {
    if (isAbsolute(key)) {
      throw new Error(`파일 키는 상대경로여야 합니다: ${key}`);
    }

    const path = normalize(join(this.root, key));
    if (!path.startsWith(normalize(this.root) + sep)) {
      throw new Error(`파일 키가 저장 위치를 벗어납니다: ${key}`);
    }
    return path;
  }
}
