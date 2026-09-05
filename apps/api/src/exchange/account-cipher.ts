import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** AES-256-GCM. 인증 태그가 붙어 변조를 복호화 단계에서 잡는다 */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * 계좌번호 암복호화 포트. (`ADR-PAY-6`)
 *
 * **포트로 두는 이유**는 이 결정이 다시 열릴 수 있기 때문이다. 지금은
 * 환경변수의 마스터 키를 쓰지만, 서버 침해까지 막아야 할 때가 오면 이
 * 클래스만 KMS 구현체로 갈아끼운다.
 */
export interface AccountCipher {
  encrypt(plain: string): string;
  decrypt(sealed: string): string;
}

/**
 * 마스터 키 하나로 암복호화한다. (`ADR-PAY-6`)
 *
 * 이 안이 막는 것은 **"DB만 새는 경우"**다. 서버에 들어온 사람은 키도 함께
 * 얻으므로 그건 못 막는다 — 그건 KMS로 가야 막힌다.
 */
@Injectable()
export class EnvAccountCipher implements AccountCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret = config.get<string>('ACCOUNT_ENCRYPTION_KEY');
    if (!secret) {
      // **기본값을 주면 안 된다.** 그 값으로 암호화된 계좌가 생기고,
      // 나중에 진짜 키로 바꾸면 그 계좌들을 아무도 못 읽는다.
      throw new Error(
        'ACCOUNT_ENCRYPTION_KEY가 없습니다. 저장소 루트의 .env를 확인하세요 (.env.example 참고).',
      );
    }

    // 사람이 정한 문자열을 그대로 키로 쓰면 길이가 안 맞는다. 늘려서 쓴다.
    this.key = scryptSync(secret, 'fixer.account', KEY_BYTES);
  }

  /**
   * `iv:authTag:ciphertext` 한 문자열로 만든다.
   *
   * 컬럼을 셋으로 쪼개지 않는 이유는, 하나만 지워지거나 하나만 옮겨지는
   * 사고가 나면 나머지가 쓸모없어지기 때문이다.
   */
  encrypt(plain: string): string {
    // IV는 매번 새로 만든다. 같으면 같은 계좌번호가 같은 암호문이 되어
    // 누가 누구와 같은 계좌를 쓰는지가 드러난다.
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);

    const ciphertext = Buffer.concat([
      cipher.update(plain, 'utf8'),
      cipher.final(),
    ]);

    return [
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(sealed: string): string {
    const [ivPart, tagPart, dataPart] = sealed.split(':');
    if (!ivPart || !tagPart || !dataPart) {
      throw new Error('계좌 암호문의 모양이 올바르지 않습니다.');
    }

    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(ivPart, 'base64'),
    );
    // 태그가 안 맞으면 `final()`이 던진다 — 변조를 여기서 잡는다.
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
