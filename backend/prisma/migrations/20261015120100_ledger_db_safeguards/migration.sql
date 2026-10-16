-- Database-level safeguards for the ledger.
-- Prisma does not model CHECK constraints or triggers, so they live in this hand-written migration.
-- NOTE: CHECK constraints are enforced from MySQL 8.0.16+ (ignored by MySQL 5.7).
--       The triggers below enforce the same rules on every MySQL version.
-- NOTE: Creating triggers on a server with binary logging enabled requires either the SUPER/
--       privilege or log_bin_trust_function_creators = 1. See README (Database section).

-- Money must be strictly positive; opening balances may not be negative.
ALTER TABLE `LedgerEntry` ADD CONSTRAINT `LedgerEntry_amount_positive_chk` CHECK (`amount` > 0);
ALTER TABLE `Account` ADD CONSTRAINT `Account_openingBalance_nonnegative_chk` CHECK (`openingBalance` >= 0);

-- Posted ledger rows are immutable once approved/rejected. Only PENDING rows may transition to APPROVED or REJECTED.
CREATE TRIGGER `LedgerEntry_prevent_update`
BEFORE UPDATE ON `LedgerEntry`
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.`approvalStatus` = 'PENDING'
    AND NEW.`approvalStatus` IN ('APPROVED', 'REJECTED')
    AND OLD.`accountId` = NEW.`accountId`
    AND OLD.`entryDate` = NEW.`entryDate`
    AND OLD.`type` = NEW.`type`
    AND OLD.`side` = NEW.`side`
    AND OLD.`direction` = NEW.`direction`
    AND OLD.`amount` = NEW.`amount`
    AND (OLD.`reversalOfId` <=> NEW.`reversalOfId`)
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ledger entries are immutable. Create a reversal entry instead.';
  END IF;
END;

CREATE TRIGGER `LedgerEntry_prevent_delete`
BEFORE DELETE ON `LedgerEntry`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ledger entries cannot be deleted. Create a reversal entry instead.';

-- Account configuration rules (MySQL 5.7 does not evaluate CHECK constraints, so triggers enforce them).
-- Opening balances may not be negative, and the opening side must be the normal side for the account type.
CREATE TRIGGER `Account_validate_insert`
BEFORE INSERT ON `Account`
FOR EACH ROW
BEGIN
  IF NEW.`openingBalance` < 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Opening balance cannot be negative.';
  END IF;
  IF NOT ((NEW.`type` = 'CUSTOMER' AND NEW.`openingBalanceSide` = 'RECEIVABLE') OR (NEW.`type` = 'SUPPLIER' AND NEW.`openingBalanceSide` = 'PAYABLE')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Opening balance side must match the account type.';
  END IF;
END;

CREATE TRIGGER `Account_validate_update`
BEFORE UPDATE ON `Account`
FOR EACH ROW
BEGIN
  IF NEW.`openingBalance` < 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Opening balance cannot be negative.';
  END IF;
  IF NOT ((NEW.`type` = 'CUSTOMER' AND NEW.`openingBalanceSide` = 'RECEIVABLE') OR (NEW.`type` = 'SUPPLIER' AND NEW.`openingBalanceSide` = 'PAYABLE')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Opening balance side must match the account type.';
  END IF;
END;

-- Validate every inserted ledger row against the account type and the transaction rules.
CREATE TRIGGER `LedgerEntry_validate_insert`
BEFORE INSERT ON `LedgerEntry`
FOR EACH ROW
BEGIN
  DECLARE v_account_type VARCHAR(20);
  DECLARE v_account_active TINYINT(1);
  DECLARE v_orig_account INTEGER;
  DECLARE v_orig_side VARCHAR(20);
  DECLARE v_orig_direction VARCHAR(20);
  DECLARE v_orig_amount DECIMAL(15, 2);
  DECLARE v_orig_type VARCHAR(40);
  DECLARE v_orig_reversal INTEGER;
  DECLARE v_orig_missing TINYINT(1) DEFAULT 0;
  DECLARE v_account_missing TINYINT(1) DEFAULT 0;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_orig_missing = 1;

  SET v_account_missing = 0;
  SELECT `type`, `isActive` INTO v_account_type, v_account_active
    FROM `Account` WHERE `id` = NEW.`accountId`;

  IF v_account_type IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ledger entry references a missing account.';
  END IF;

  IF NEW.`amount` IS NULL OR NEW.`amount` <= 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ledger entry amount must be greater than zero.';
  END IF;

  IF v_account_active = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ledger entries cannot be posted to an inactive account.';
  END IF;

  -- Receivables belong to customers; payables belong to suppliers.
  IF NOT ((v_account_type = 'CUSTOMER' AND NEW.`side` = 'RECEIVABLE') OR (v_account_type = 'SUPPLIER' AND NEW.`side` = 'PAYABLE')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ledger side does not match the account type.';
  END IF;

  IF NEW.`type` = 'REVERSAL' THEN
    IF NEW.`reversalOfId` IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A REVERSAL entry must reference the original entry.';
    END IF;

    SELECT `accountId`, `side`, `direction`, `amount`, `type`, `reversalOfId`
      INTO v_orig_account, v_orig_side, v_orig_direction, v_orig_amount, v_orig_type, v_orig_reversal
      FROM `LedgerEntry` WHERE `id` = NEW.`reversalOfId`;

    IF v_orig_missing = 1 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The entry being reversed does not exist.';
    END IF;

    IF v_orig_type = 'REVERSAL' OR v_orig_reversal IS NOT NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A reversal entry cannot be reversed.';
    END IF;

    IF v_orig_account <> NEW.`accountId` OR v_orig_side <> NEW.`side`
       OR v_orig_amount <> NEW.`amount` OR v_orig_direction = NEW.`direction` THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A reversal must mirror the original entry on the same account, side and amount.';
    END IF;
  ELSE
    IF NEW.`reversalOfId` IS NOT NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only REVERSAL entries may reference another entry.';
    END IF;

    IF NOT (
         (NEW.`type` = 'CREDIT_SALE'                 AND v_account_type = 'CUSTOMER' AND NEW.`side` = 'RECEIVABLE' AND NEW.`direction` = 'INCREASE')
      OR (NEW.`type` = 'PAYMENT_RECEIVED'            AND v_account_type = 'CUSTOMER' AND NEW.`side` = 'RECEIVABLE' AND NEW.`direction` = 'DECREASE')
      OR (NEW.`type` = 'CUSTOMER_CREDIT_ADJUSTMENT'  AND v_account_type = 'CUSTOMER' AND NEW.`side` = 'RECEIVABLE' AND NEW.`direction` = 'DECREASE')
      OR (NEW.`type` = 'CREDIT_PURCHASE'             AND v_account_type = 'SUPPLIER' AND NEW.`side` = 'PAYABLE'    AND NEW.`direction` = 'INCREASE')
      OR (NEW.`type` = 'PAYMENT_MADE'                AND v_account_type = 'SUPPLIER' AND NEW.`side` = 'PAYABLE'    AND NEW.`direction` = 'DECREASE')
      OR (NEW.`type` = 'SUPPLIER_CREDIT_ADJUSTMENT'  AND v_account_type = 'SUPPLIER' AND NEW.`side` = 'PAYABLE'    AND NEW.`direction` = 'DECREASE')
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transaction type, account type, side and direction do not follow the ledger rules.';
    END IF;
  END IF;
END;

-- Audit records are append-only.
CREATE TRIGGER `AuditLog_prevent_update`
BEFORE UPDATE ON `AuditLog`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit log records are append-only.';

CREATE TRIGGER `AuditLog_prevent_delete`
BEFORE DELETE ON `AuditLog`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit log records are append-only.';
