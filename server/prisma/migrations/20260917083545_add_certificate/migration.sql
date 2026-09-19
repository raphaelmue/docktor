-- AlterTable
ALTER TABLE "ProxyConfig" ADD COLUMN     "certSource" TEXT NOT NULL DEFAULT 'acme',
ADD COLUMN     "certificateId" TEXT;

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "domainPattern" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "certificate" TEXT NOT NULL,
    "caBundle" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_domainPattern_key" ON "Certificate"("domainPattern");

-- AddForeignKey
ALTER TABLE "ProxyConfig" ADD CONSTRAINT "ProxyConfig_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "Certificate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

