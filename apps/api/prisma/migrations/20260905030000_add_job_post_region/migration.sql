-- 지역 필터를 위해 근무 주소를 분해해서 담는다 (#13).
-- 문자열을 파싱하면 파싱이 틀린 공고가 조용히 목록에서 사라진다.
ALTER TABLE "JobPost" ADD COLUMN "workSido" TEXT NOT NULL DEFAULT '';
ALTER TABLE "JobPost" ADD COLUMN "workSigungu" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "JobPost_workSido_workSigungu_status_idx" ON "JobPost"("workSido", "workSigungu", "status");
