-- Additive upgrade only: the Spring/Flyway users and transactions tables stay untouched.
-- New PINs are stored as bcrypt hashes with a keyed lookup digest. Legacy plaintext
-- PINs remain readable until the user signs in or the admin resets them.
ALTER TABLE `users` ADD COLUMN `pin_digest` VARCHAR(64) NULL;
ALTER TABLE `users` ADD COLUMN `pin_hash` VARCHAR(255) NULL;
CREATE UNIQUE INDEX `users_pin_digest_uq` ON `users` (`pin_digest`);

CREATE TABLE `idempotency_keys` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `scope` VARCHAR(160) NOT NULL,
  `key_hash` VARCHAR(64) NOT NULL,
  `request_hash` VARCHAR(64) NOT NULL,
  `response_status` INT NULL,
  `response_body` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idempotency_keys_scope_key_uq` (`scope`, `key_hash`),
  KEY `idempotency_keys_expires_idx` (`expires_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
