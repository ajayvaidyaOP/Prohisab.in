import path from 'node:path';
import { Lite4MariaDB } from 'lite4mariadb';
import { LiteMariaDbAdapterFactory } from './lite-adapter.ts';
import { BASELINE, NODE_SUPPORT, migrationSql } from '../scripts/migrate.ts';

/** Same MySQL tables/SQL as production, hosted in MariaDB WASM for local previews. */
export async function createDemo() {
  const dir = process.env.NODE_ENV === 'test' || process.env.DEMO_IN_MEMORY === 'true'
    ? undefined : path.resolve(process.cwd(), process.env.DEMO_DATA_DIR || '.erp-local-db');
  const database = await Lite4MariaDB.create(dir ? { dataDir: dir } : undefined);
  try {
    if (!database.query("SHOW TABLES LIKE 'users'").length) {
      database.execMulti(migrationSql(BASELINE));
      database.execMulti(migrationSql(NODE_SUPPORT));
    } else {
      // Support demos made by an earlier iteration without destroying their rows.
      if (!database.query("SHOW COLUMNS FROM users LIKE 'pin_digest'").length) {
        database.exec('ALTER TABLE users ADD COLUMN pin_digest VARCHAR(64) NULL');
        database.exec('CREATE UNIQUE INDEX users_pin_digest_uq ON users (pin_digest)');
      }
      if (!database.query("SHOW COLUMNS FROM users LIKE 'pin_hash'").length) {
        database.exec('ALTER TABLE users ADD COLUMN pin_hash VARCHAR(255) NULL');
      }
      if (!database.query("SHOW TABLES LIKE 'idempotency_keys'").length) {
        const support = migrationSql(NODE_SUPPORT);
        database.execMulti(support.slice(support.indexOf('CREATE TABLE')));
      }
    }
    return { adapter: new LiteMariaDbAdapterFactory(database), database };
  } catch (error) {
    await database.close();
    throw error;
  }
}
