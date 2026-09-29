"""Apply db/migrations/*.sql in order, once each, recording them in schema_migrations.

Each file runs in its own transaction. A Postgres advisory lock stops two starting containers from
migrating at the same time.
"""
import os
from pathlib import Path

import psycopg

MIGRATIONS = Path(os.environ.get("MIGRATIONS_DIR", "/app/db/migrations"))


def main():
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as conn:
        conn.execute("SELECT pg_advisory_lock(7211)")
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
        done = {r[0] for r in conn.execute("SELECT name FROM schema_migrations")}
        for f in sorted(MIGRATIONS.glob("*.sql")):
            if f.name in done:
                continue
            with conn.transaction():
                conn.execute(f.read_text())
                conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", [f.name])
            print(f"[migrate] applied {f.name}", flush=True)
        conn.execute("SELECT pg_advisory_unlock(7211)")
        print("[migrate] schema up to date", flush=True)


if __name__ == "__main__":
    main()
