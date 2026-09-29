import postgres from "postgres";
import { config } from "./config";

/** One pool for the process. Queries are parameterised tagged templates, so values are never spliced into SQL. */
export const sql = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 30,
  // numeric columns come back as strings by default; the domain works in numbers.
  types: { numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) } },
  onnotice: () => {},
});

export type Sql = typeof sql;
export type Tx = postgres.TransactionSql;
