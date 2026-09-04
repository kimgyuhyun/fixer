-- AlterTable
ALTER TABLE "User" ADD COLUMN     "purgedAt" TIMESTAMP(3);

-- 파기 대상 조회는 "비활성화됐고 아직 파기 안 된" 행만 훑는다.
CREATE INDEX "User_deactivatedAt_purgedAt_idx" ON "User"("deactivatedAt", "purgedAt");
