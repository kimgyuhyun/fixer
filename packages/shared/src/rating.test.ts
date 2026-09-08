import { describe, expect, it } from 'vitest';
import { rateeOf } from './rating.js';

const EMPLOYER = 'usr_employer';
const APPLICANT = 'usr_applicant';

describe('rateeOf', () => {
  it('should point at the applicant as WORKER when the employer is the rater', () => {
    expect(
      rateeOf({
        raterId: EMPLOYER,
        employerId: EMPLOYER,
        applicantId: APPLICANT,
      }),
    ).toEqual({ rateeId: APPLICANT, rateeRole: 'WORKER' });
  });

  it('should point at the employer as POSTER when the applicant is the rater', () => {
    expect(
      rateeOf({
        raterId: APPLICANT,
        employerId: EMPLOYER,
        applicantId: APPLICANT,
      }),
    ).toEqual({ rateeId: EMPLOYER, rateeRole: 'POSTER' });
  });

  // 당사자가 아니면 평가할 자격 자체가 없다 (§7 "거래에 한해").
  it('should return null when the rater is neither party of the transaction', () => {
    expect(
      rateeOf({
        raterId: 'usr_stranger',
        employerId: EMPLOYER,
        applicantId: APPLICANT,
      }),
    ).toBeNull();
  });
});
