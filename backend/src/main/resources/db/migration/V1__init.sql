-- =====================================================================
-- deposit.in ERP - initial schema (MySQL 8, H2-MySQL-mode compatible)
-- Money is DECIMAL(15,2); timestamps are UTC; entry_date is a business date.
-- =====================================================================

-- ---------------------------------------------------------------------
-- users: login accounts (ADMIN manages, USER has a personal ledger)
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id                BIGINT       NOT NULL AUTO_INCREMENT,
    name              VARCHAR(150) NOT NULL,
    name_normalized   VARCHAR(150) NOT NULL,
    password_hash     VARCHAR(255) NOT NULL,
    role              VARCHAR(10) NOT NULL DEFAULT 'USER',
    CONSTRAINT users_role_chk CHECK (role IN ('ADMIN','USER')),
    account_code      VARCHAR(20)  NOT NULL,
    phone             VARCHAR(30)  NULL,
    email             VARCHAR(190) NULL,
    address           VARCHAR(500) NULL,
    notes             VARCHAR(500) NULL,
    is_active         BOOLEAN  NOT NULL DEFAULT TRUE,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT users_name_normalized_uq UNIQUE (name_normalized),
    CONSTRAINT users_account_code_uq UNIQUE (account_code)
);
CREATE INDEX users_role_active_idx ON users (role, is_active);
CREATE INDEX users_name_idx ON users (name);

-- ---------------------------------------------------------------------
-- sessions: hashed session tokens for HttpOnly cookie auth
-- ---------------------------------------------------------------------
CREATE TABLE sessions (
    id             VARCHAR(64)  NOT NULL,
    user_id        BIGINT       NOT NULL,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at     DATETIME     NOT NULL,
    user_agent     VARCHAR(255) NULL,
    PRIMARY KEY (id),
    CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- ---------------------------------------------------------------------
-- entry_options: admin-controlled dropdown options for deposit/withdrawal
-- ---------------------------------------------------------------------
CREATE TABLE entry_options (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    name            VARCHAR(120) NOT NULL,
    name_normalized VARCHAR(120) NOT NULL,
    sort_order      INT          NOT NULL DEFAULT 0,
    is_active       BOOLEAN  NOT NULL DEFAULT TRUE,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT entry_options_name_uq UNIQUE (name_normalized)
);
CREATE INDEX entry_options_active_sort_idx ON entry_options (is_active, sort_order, id);

-- ---------------------------------------------------------------------
-- transactions: ledger entries (DEPOSIT +, WITHDRAWAL -)
-- Balance model (owed_by_user / receivable) is preserved:
--   balance = SUM(approved deposits) - SUM(approved withdrawals)
-- ---------------------------------------------------------------------
CREATE TABLE transactions (
    id               BIGINT        NOT NULL AUTO_INCREMENT,
    user_id          BIGINT        NOT NULL,
    entry_date       DATE          NOT NULL,
    kind             VARCHAR(12) NOT NULL,
    CONSTRAINT transactions_kind_chk CHECK (kind IN ('DEPOSIT','WITHDRAWAL')),
    amount           DECIMAL(15,2) NOT NULL,
    option_name      VARCHAR(120)  NOT NULL,
    detail           VARCHAR(500)  NULL,
    reference_number VARCHAR(100)  NULL,
    payment_method   VARCHAR(20)   NULL,
    reversal_of_id   BIGINT        NULL,
    reversed_by_id   BIGINT        NULL,
    approval_status  VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    CONSTRAINT transactions_status_chk CHECK (approval_status IN ('PENDING','APPROVED','REJECTED')),
    reviewed_by_id   BIGINT        NULL,
    reviewed_at      DATETIME      NULL,
    rejection_reason VARCHAR(300)  NULL,
    created_by_id    BIGINT        NULL,
    created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT transactions_amount_positive_chk CHECK (amount > 0),
    CONSTRAINT transactions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT uq_transactions_reversal_of UNIQUE (reversal_of_id),
    CONSTRAINT transactions_reviewed_by_fk FOREIGN KEY (reviewed_by_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT transactions_created_by_fk FOREIGN KEY (created_by_id) REFERENCES users (id) ON DELETE RESTRICT
);
CREATE INDEX transactions_user_date_idx ON transactions (user_id, entry_date, id);
CREATE INDEX transactions_status_created_idx ON transactions (approval_status, created_at);
CREATE INDEX transactions_kind_date_idx ON transactions (kind, entry_date);
CREATE INDEX transactions_date_idx ON transactions (entry_date);
CREATE INDEX transactions_created_by_idx ON transactions (created_by_id);

-- ---------------------------------------------------------------------
-- audit_logs: who did what, never passwords/tokens/cookies
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    action      VARCHAR(80)  NOT NULL,
    entity_type VARCHAR(60)  NOT NULL,
    entity_id   VARCHAR(60)  NOT NULL,
    actor_id    BIGINT       NULL,
    details     VARCHAR(2000) NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT audit_logs_actor_fk FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id);

-- ---------------------------------------------------------------------
-- app_settings: single-row application settings
-- ---------------------------------------------------------------------
CREATE TABLE app_settings (
    id              BIGINT       NOT NULL,
    business_name   VARCHAR(150) NOT NULL DEFAULT 'My Business',
    business_address VARCHAR(500) NULL,
    business_phone  VARCHAR(30)  NULL,
    business_email  VARCHAR(190) NULL,
    currency_symbol VARCHAR(8)   NOT NULL DEFAULT '₹',
    timezone        VARCHAR(64)  NOT NULL DEFAULT 'Asia/Kolkata',
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);
