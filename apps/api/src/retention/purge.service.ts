import { Injectable } from '@nestjs/common';
import { PURGED_NAME, purgedEmailFor } from '@fixer/shared';

/** 파기 대상 회원 하나 */
export interface PurgeCandidate {
  id: string;
  /** 지워야 할 동의서 PDF들. 해시는 행에 남는다 */
  agreementFilePaths: string[];
}

/**
 * 파기가 필요한 만큼만 여는 포트.
 *
 * `UserStore`를 넓히지 않는다 — 가입·로그인은 파기를 몰라야 하고,
 * 파기는 저 둘을 몰라야 한다.
 */
export interface PurgeStore {
  /** 비활성화된 지 오래됐고 **아직 파기되지 않은** 회원들 */
  findPurgeable(deactivatedBefore: Date): Promise<PurgeCandidate[]>;
  /**
   * 한 회원의 개인정보를 비식별 처리한다. **행은 지우지 않는다** —
   * 지우면 5년 보관해야 하는 계약·결제 기록의 FK가 함께 깨진다.
   */
  maskMember(input: {
    userId: string;
    email: string;
    name: string;
    purgedAt: Date;
  }): Promise<void>;
}

/** 파일을 지우는 포트. 동의서 저장소(#7)의 것을 그대로 쓴다 */
export interface PurgeFileRemover {
  delete(filePath: string): Promise<void>;
}

/**
 * 잡 하나가 동시에 두 번 돌지 않게 한다. (`spec-fixed.md` §8.2)
 *
 * PostgreSQL advisory lock을 쓴다. Redis 같은 추가 인프라가 필요 없다.
 */
export interface JobLock {
  /** 잡았으면 true. **못 잡는 것은 오류가 아니다** — 다른 인스턴스가 돌고 있다 */
  tryLock(key: number): Promise<boolean>;
  unlock(key: number): Promise<void>;
}

/** 한 번 돌고 난 결과 */
export interface PurgeReport {
  purgedUserIds: string[];
  deletedAgreementFiles: number;
  /** 락을 못 잡아 아무것도 하지 않았다 */
  skippedByLock: boolean;
}

/**
 * 개인정보 파기 배치. (이슈 #39, `spec-fixed.md` §2.7)
 *
 * **행을 지우지 않고 컬럼만 비식별 처리한다.** 이메일은
 * `deleted_{userId}@invalid`가 되는데, 이 한 수로 두 가지가 동시에 풀린다 —
 * 유니크 제약이 유지되고, 그 주소로 다시 가입하면 신규 가입이 된다.
 */
@Injectable()
export class PurgeService {
  constructor(
    private readonly store: PurgeStore,
    private readonly files: PurgeFileRemover,
    private readonly lock: JobLock,
  ) {}

  async purge(
    now: Date,
    retentionMs: number,
    lockKey: number,
  ): Promise<PurgeReport> {
    const empty: PurgeReport = {
      purgedUserIds: [],
      deletedAgreementFiles: 0,
      skippedByLock: false,
    };

    // 못 잡으면 조용히 돌아선다. 여기서 던지면 서버가 두 대일 때 매일
    // 알람이 울린다 — 정상 동작인데도.
    if (!(await this.lock.tryLock(lockKey))) {
      return { ...empty, skippedByLock: true };
    }

    try {
      const deactivatedBefore = new Date(now.getTime() - retentionMs);
      const candidates = await this.store.findPurgeable(deactivatedBefore);

      const purgedUserIds: string[] = [];
      let deletedAgreementFiles = 0;

      for (const candidate of candidates) {
        await this.store.maskMember({
          userId: candidate.id,
          email: purgedEmailFor(candidate.id),
          name: PURGED_NAME,
          purgedAt: now,
        });

        // 파일 삭제는 마스킹 **뒤**다. 되돌릴 수 없으므로, DB가 롤백됐는데
        // 파일만 사라지는 것보다 파일이 남는 편이 낫다 — 다시 돌리면 지워진다.
        for (const filePath of candidate.agreementFilePaths) {
          await this.files.delete(filePath);
          deletedAgreementFiles += 1;
        }

        purgedUserIds.push(candidate.id);
      }

      return { purgedUserIds, deletedAgreementFiles, skippedByLock: false };
    } finally {
      // 던져도 반드시 푼다. 안 그러면 다음 실행이 영원히 막힌다.
      await this.lock.unlock(lockKey);
    }
  }
}
