declare module "sql.js" {
  export type SqlValue = string | number | null | Uint8Array;
  export interface Statement {
    bind(values?: SqlValue[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }
  export interface Database {
    prepare(sql: string): Statement;
    run(sql: string, params?: SqlValue[]): void;
    exec(sql: string): Array<{ columns: string[]; values: SqlValue[][] }>;
    export(): Uint8Array;
    getRowsModified(): number;
    close(): void;
  }
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }
  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string;
  }): Promise<SqlJsStatic>;
}
