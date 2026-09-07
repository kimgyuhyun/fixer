-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'APPLICATION_REACCEPT_REQUIRED';

-- AlterTable
ALTER TABLE "Application" ADD COLUMN "previousStatus" "ApplicationStatus";
