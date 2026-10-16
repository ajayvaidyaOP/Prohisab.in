// Development/tests only: a tiny Prisma SQL adapter for lite4mariadb's in-process
// MariaDB WASM. Production always uses PrismaMariaDb against an external MySQL 8 DB.
// This keeps the demo on the SAME SQL schema, not a separate JSON mock/H2 model.
import { ColumnTypeEnum as C, DriverAdapterError,
  type SqlDriverAdapterFactory, type SqlDriverAdapter, type SqlQuery,
  type SqlResultSet, type Transaction, type ColumnType } from '@prisma/driver-adapter-utils';
import type { Lite4MariaDB, ExecResult, SqlParam } from 'lite4mariadb';

const columnType = (type: number): ColumnType => {
  switch (type) {
    case 1: case 2: case 3: case 9: case 13: return C.Int32;
    case 8: return C.Int64;
    case 4: return C.Float;
    case 5: return C.Double;
    case 0: case 246: return C.Numeric;
    case 10: case 14: return C.Date;
    case 7: case 12: return C.DateTime;
    case 11: return C.Time;
    case 245: return C.Json;
    case 247: return C.Enum;
    case 16: return C.Bytes;
    default: return C.Text;
  }
};

function formatDate(date: Date, dateOnly: boolean) {
  const iso = date.toISOString();
  return dateOnly ? iso.slice(0, 10) : iso.slice(0, 23).replace('T', ' ');
}
function argsFor(query: SqlQuery): SqlParam[] {
  return query.args.map((arg, index) => {
    const type = query.argTypes[index];
    if (arg == null) return null;
    if (typeof arg === 'string' && type.scalarType === 'bigint') return BigInt(arg);
    if (typeof arg === 'string' && type.scalarType === 'datetime') {
      return formatDate(new Date(arg), type.dbType === 'DATE');
    }
    if (arg instanceof Date) return formatDate(arg, type.dbType === 'DATE');
    if (typeof arg === 'string' && type.scalarType === 'bytes') return Uint8Array.from(Buffer.from(arg, 'base64'));
    if (arg instanceof Uint8Array) return arg;
    return arg as SqlParam;
  });
}
function asResult(db: Lite4MariaDB, result: ExecResult, sql: string): SqlResultSet {
  const fields = result.fields ?? [];
  const types = (result.types ?? []).map(([type]) => columnType(type));
  const rows = result.rows.map((row) => fields.map((field, i) => {
    const value = row[field];
    if (value === null || value === undefined) return null;
    if (types[i] === C.Int64) return String(value);
    if (types[i] === C.DateTime && typeof value === 'string') {
      return value.replace(' ', 'T').replace(/(\.\d+)?$/, '$1+00:00');
    }
    return value;
  }));
  const lastInsertId = /^\s*(INSERT|REPLACE)\b/i.test(sql)
    ? db.query<{ id: number | string }>('SELECT LAST_INSERT_ID() AS id')[0]?.id : undefined;
  return { columnNames: fields, columnTypes: types, rows,
    ...(lastInsertId !== undefined ? { lastInsertId: String(lastInsertId) } : {}) };
}
function mapError(err: unknown): never {
  const e = err as Error & { errno?: number; sqlstate?: string };
  const message = e?.message ?? String(err);
  if (e.errno === 1062) {
    const index = message.match(/for key '([^']+)'/)?.[1] ?? 'unique';
    throw new DriverAdapterError({ kind: 'UniqueConstraintViolation', constraint: { index }, originalCode: '1062', originalMessage: message });
  }
  if (e.errno === 1451 || e.errno === 1452) {
    throw new DriverAdapterError({ kind: 'ForeignKeyConstraintViolation', originalCode: String(e.errno), originalMessage: message });
  }
  throw new DriverAdapterError({ kind: 'mysql', code: e.errno ?? 1105, message,
    state: e.sqlstate ?? 'HY000', originalCode: String(e.errno ?? 1105), originalMessage: message });
}

export class LiteMariaDbAdapterFactory implements SqlDriverAdapterFactory {
  readonly provider = 'mysql' as const;
  readonly adapterName = 'lite4mariadb (development)';
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly db: Lite4MariaDB) {}

  private async acquire(): Promise<() => void> {
    let release!: () => void;
    const lock = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.tail;
    this.tail = previous.then(() => lock);
    await previous;
    return release;
  }
  private exec(query: SqlQuery) {
    try { return this.db.exec(query.sql, argsFor(query)); } catch (error) { mapError(error); }
  }
  private async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    const release = await this.acquire();
    try { return asResult(this.db, this.exec(query), query.sql); } finally { release(); }
  }
  private async executeRaw(query: SqlQuery): Promise<number> {
    const release = await this.acquire();
    try { return this.exec(query).affected ?? 0; } finally { release(); }
  }
  async connect(): Promise<SqlDriverAdapter> {
    return {
      provider: this.provider, adapterName: this.adapterName,
      queryRaw: (query) => this.queryRaw(query),
      executeRaw: (query) => this.executeRaw(query),
      executeScript: async (script) => {
        const release = await this.acquire();
        try { this.db.execMulti(script); } catch (error) { mapError(error); } finally { release(); }
      },
      getConnectionInfo: () => ({ schemaName: 'test', supportsRelationJoins: false }),
      startTransaction: async (isolationLevel): Promise<Transaction> => {
        const release = await this.acquire();
        try {
          if (isolationLevel) this.db.exec(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
          this.db.exec('START TRANSACTION');
        } catch (error) { release(); mapError(error); }
        const transaction: Transaction = {
          provider: this.provider, adapterName: this.adapterName, options: { usePhantomQuery: true },
          queryRaw: async (query) => asResult(this.db, this.exec(query), query.sql),
          executeRaw: async (query) => this.exec(query).affected ?? 0,
          commit: async () => { try { this.db.exec('COMMIT'); } finally { release(); } },
          rollback: async () => { try { this.db.exec('ROLLBACK'); } finally { release(); } },
        };
        return transaction;
      },
      dispose: async () => { /* db.close() is called by the demo/test owner. */ },
    };
  }
}
