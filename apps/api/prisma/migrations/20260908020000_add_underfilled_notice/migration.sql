-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'JOB_POST_UNDERFILLED';

-- AlterTable
ALTER TABLE "JobPost" ADD COLUMN "underfilledNotifiedAt" TIMESTAMP(3);
