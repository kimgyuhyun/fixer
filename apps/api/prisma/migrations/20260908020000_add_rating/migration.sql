-- CreateEnum
CREATE TYPE "RatingRole" AS ENUM ('POSTER', 'WORKER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "ratingAsPoster" DOUBLE PRECISION,
ADD COLUMN     "ratingAsPosterCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ratingAsWorker" DOUBLE PRECISION,
ADD COLUMN     "ratingAsWorkerCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "raterId" TEXT NOT NULL,
    "rateeId" TEXT NOT NULL,
    "rateeRole" "RatingRole" NOT NULL,
    "score" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rating_rateeId_rateeRole_idx" ON "Rating"("rateeId", "rateeRole");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_applicationId_raterId_key" ON "Rating"("applicationId", "raterId");

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_raterId_fkey" FOREIGN KEY ("raterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_rateeId_fkey" FOREIGN KEY ("rateeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
