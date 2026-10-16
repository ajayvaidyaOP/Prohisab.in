-- Staff-facing access controls used by the admin staff manager.
-- Keep the legacy boolean column for safe upgrades; new permissions are date-specific.
ALTER TABLE users ADD COLUMN back_date_allowed_date DATE NULL;
