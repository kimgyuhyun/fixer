-- CreateTable
CREATE TABLE "AgreementTemplate" (
    "version" INTEGER NOT NULL,
    "fileKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "signatureBox" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementTemplate_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "Agreement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "agreedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,

    CONSTRAINT "Agreement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgreementTemplate_isActive_idx" ON "AgreementTemplate"("isActive");

-- CreateIndex
CREATE INDEX "Agreement_userId_agreedAt_idx" ON "Agreement"("userId", "agreedAt");

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

