-- CreateEnum
CREATE TYPE "JobPostStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "JobPost" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "JobPostStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "workAddress" TEXT NOT NULL,
    "workStartAt" TIMESTAMP(3) NOT NULL,
    "workEndAt" TIMESTAMP(3) NOT NULL,
    "headcount" INTEGER NOT NULL,
    "rewardPerPerson" INTEGER NOT NULL,
    "requiredDescription" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "JobPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPostVersion" (
    "id" TEXT NOT NULL,
    "jobPostId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "workAddress" TEXT NOT NULL,
    "workStartAt" TIMESTAMP(3) NOT NULL,
    "workEndAt" TIMESTAMP(3) NOT NULL,
    "headcount" INTEGER NOT NULL,
    "rewardPerPerson" INTEGER NOT NULL,
    "requiredDescription" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobPostVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobPost_status_createdAt_idx" ON "JobPost"("status", "createdAt");
CREATE INDEX "JobPost_employerId_idx" ON "JobPost"("employerId");
CREATE INDEX "JobPost_categoryId_idx" ON "JobPost"("categoryId");
CREATE UNIQUE INDEX "JobPostVersion_jobPostId_version_key" ON "JobPostVersion"("jobPostId", "version");

-- AddForeignKey
ALTER TABLE "JobPost" ADD CONSTRAINT "JobPost_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobPost" ADD CONSTRAINT "JobPost_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobPostVersion" ADD CONSTRAINT "JobPostVersion_jobPostId_fkey" FOREIGN KEY ("jobPostId") REFERENCES "JobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
