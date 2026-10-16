-- Add 4-digit staff PIN login support and logo URL setting.
ALTER TABLE users ADD COLUMN pin VARCHAR(10) NULL;
CREATE UNIQUE INDEX users_pin_uq ON users (pin);

ALTER TABLE app_settings ADD COLUMN logo_url VARCHAR(500) NULL;
