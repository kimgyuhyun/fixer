-- 수락과 정원 제어 (이슈 #18, ADR-APP-1)

-- AlterTable
ALTER TABLE "JobPost" ADD COLUMN     "acceptedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "acceptedAt" TIMESTAMP(3);
