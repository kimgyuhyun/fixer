-- CreateEnum
CREATE TYPE "PenaltyReason" AS ENUM ('NO_SHOW', 'LATE_CANCEL', 'SAME_DAY_CANCEL', 'POSTER_CANCEL');

-- CreateTable
CREATE TABLE "Penalty" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" "PenaltyReason" NOT NULL,
    "jobPostId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Penalty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Penalty_userId_occurredAt_idx" ON "Penalty"("userId", "occurredAt");

-- AddForeignKey
ALTER TABLE "Penalty" ADD CONSTRAINT "Penalty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
