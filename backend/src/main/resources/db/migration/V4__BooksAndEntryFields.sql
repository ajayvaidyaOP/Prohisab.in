-- Books (websites / ledgers)
CREATE TABLE books (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    name        VARCHAR(150) NOT NULL,
    status      VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT books_status_chk CHECK (status IN ('ACTIVE','ARCHIVED'))
);
CREATE INDEX books_status_idx ON books (status);

-- Staff <-> Book access
CREATE TABLE user_books (
    user_id BIGINT NOT NULL,
    book_id BIGINT NOT NULL,
    PRIMARY KEY (user_id, book_id),
    CONSTRAINT fk_ub_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_ub_book FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

-- Back-date entry permission on users
ALTER TABLE users ADD COLUMN back_date_entry BOOLEAN NOT NULL DEFAULT FALSE;

-- Transaction entry fields for CRM style
ALTER TABLE transactions ADD COLUMN book_id BIGINT NULL;
ALTER TABLE transactions ADD COLUMN customer_id VARCHAR(60) NULL;
ALTER TABLE transactions ADD COLUMN bank_details VARCHAR(255) NULL;
ALTER TABLE transactions ADD CONSTRAINT fk_lt_book FOREIGN KEY (book_id) REFERENCES books (id);
CREATE INDEX transactions_book_idx ON transactions (book_id);
