-- lot 잔여는 원장에서 계산한다 (ADR-PAY-7). 컬럼으로 두면 숫자가 두 벌이 된다.
ALTER TABLE "Payment" DROP COLUMN "refundedAmount";

-- 카드 취소 기한. 값은 실결제 전환 때 채운다.
ALTER TABLE "Payment" ADD COLUMN "refundableUntil" TIMESTAMP(3);
