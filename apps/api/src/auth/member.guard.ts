import {
  Injectable,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { LoginService } from './login.service';

/** 가드를 통과한 요청에 심어 두는 주체 */
export interface MemberPrincipal {
  userId: string;
}

/** 가드가 주체를 얹은 요청 */
export interface RequestWithMember extends Request {
  member?: MemberPrincipal;
}

/**
 * 로그인한 회원만 통과시킨다. (이슈 #69)
 *
 * `AdminGuard`에서 `role === ADMIN` 검사만 뺀 것과 같다. 누구인지 판정하는
 * 경로를 `/api/auth/me`·#36·`AdminGuard`와 하나로 둔다.
 */
@Injectable()
export class MemberGuard implements CanActivate {
  constructor(private readonly logins: LoginService) {}

  canActivate(_context: ExecutionContext): Promise<boolean> {
    throw new Error('not implemented');
  }
}

/** 가드가 심어 둔 주체를 꺼낸다. `CurrentMember`의 본체 */
export function memberOf(_data: unknown, _context: ExecutionContext): string {
  throw new Error('not implemented');
}

/** 컨트롤러가 회원 id를 꺼내는 파라미터 데코레이터 */
export const CurrentMember = createParamDecorator(memberOf);
