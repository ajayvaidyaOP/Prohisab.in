-- Initial schema for the Simple Ledger ERP (MySQL 8.0+ recommended; MySQL 5.7 also tested).
-- Hand-written to match the Prisma schema in prisma/schema.prisma.
-- All money columns are DECIMAL(15,2).

-- CreateTable
CREATE TABLE `AdminUser` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(64) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `role` ENUM('ADMIN', 'USER') NOT NULL DEFAULT 'ADMIN',
    `accountId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AdminUser_username_key`(`username`),
    UNIQUE INDEX `AdminUser_accountId_key`(`accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(64) NOT NULL,
    `adminUserId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `userAgent` VARCHAR(255) NULL,

    INDEX `Session_adminUserId_idx`(`adminUserId`),
    INDEX `Session_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Account` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `accountCode` VARCHAR(20) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `type` ENUM('CUSTOMER', 'SUPPLIER') NOT NULL,
    `phone` VARCHAR(30) NULL,
    `email` VARCHAR(190) NULL,
    `address` TEXT NULL,
    `openingBalance` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `openingBalanceSide` ENUM('RECEIVABLE', 'PAYABLE') NOT NULL,
    `notes` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Account_accountCode_key`(`accountCode`),
    INDEX `Account_type_isActive_idx`(`type`, `isActive`),
    INDEX `Account_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `accountId` INTEGER NOT NULL,
    `entryDate` DATE NOT NULL,
    `type` ENUM('CREDIT_SALE', 'PAYMENT_RECEIVED', 'CUSTOMER_CREDIT_ADJUSTMENT', 'CREDIT_PURCHASE', 'PAYMENT_MADE', 'SUPPLIER_CREDIT_ADJUSTMENT', 'REVERSAL') NOT NULL,
    `side` ENUM('RECEIVABLE', 'PAYABLE') NOT NULL,
    `direction` ENUM('INCREASE', 'DECREASE') NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `paymentMethod` ENUM('CASH', 'UPI', 'BANK_TRANSFER', 'OTHER') NULL,
    `referenceNumber` VARCHAR(100) NULL,
    `notes` VARCHAR(500) NULL,
    `reversalOfId` INTEGER NULL,
    `approvalStatus` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'APPROVED',
    `reviewedById` INTEGER NULL,
    `reviewedAt` DATETIME(3) NULL,
    `rejectionReason` VARCHAR(300) NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LedgerEntry_reversalOfId_key`(`reversalOfId`),
    INDEX `LedgerEntry_accountId_entryDate_id_idx`(`accountId`, `entryDate`, `id`),
    INDEX `LedgerEntry_approvalStatus_createdAt_idx`(`approvalStatus`, `createdAt`),
    INDEX `LedgerEntry_entryDate_type_idx`(`entryDate`, `type`),
    INDEX `LedgerEntry_side_direction_entryDate_idx`(`side`, `direction`, `entryDate`),
    INDEX `LedgerEntry_type_entryDate_idx`(`type`, `entryDate`),
    INDEX `LedgerEntry_referenceNumber_idx`(`referenceNumber`),
    INDEX `LedgerEntry_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `action` VARCHAR(80) NOT NULL,
    `entityType` VARCHAR(60) NOT NULL,
    `entityId` VARCHAR(60) NOT NULL,
    `actorId` INTEGER NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    INDEX `AuditLog_actorId_idx`(`actorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IdempotencyKey` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `scope` VARCHAR(120) NOT NULL,
    `keyHash` VARCHAR(64) NOT NULL,
    `requestHash` VARCHAR(64) NOT NULL,
    `status` ENUM('PROCESSING', 'COMPLETED') NOT NULL,
    `responseStatus` INTEGER NULL,
    `responseBody` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `IdempotencyKey_scope_keyHash_key`(`scope`, `keyHash`),
    INDEX `IdempotencyKey_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppSetting` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `businessName` VARCHAR(150) NOT NULL DEFAULT 'My Business',
    `businessAddress` TEXT NULL,
    `businessPhone` VARCHAR(30) NULL,
    `businessEmail` VARCHAR(190) NULL,
    `currencySymbol` VARCHAR(8) NOT NULL DEFAULT '₹',
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    `userEntryOptions` JSON NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AdminUser` ADD CONSTRAINT `AdminUser_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_adminUserId_fkey` FOREIGN KEY (`adminUserId`) REFERENCES `AdminUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerEntry` ADD CONSTRAINT `LedgerEntry_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerEntry` ADD CONSTRAINT `LedgerEntry_reversalOfId_fkey` FOREIGN KEY (`reversalOfId`) REFERENCES `LedgerEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerEntry` ADD CONSTRAINT `LedgerEntry_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `AdminUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerEntry` ADD CONSTRAINT `LedgerEntry_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
