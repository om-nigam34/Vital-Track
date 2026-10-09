# """Writes the current table definitions to ../database/schema.sql.

import os
import sqlite3

from config import DATABASE_PATH
from app import PROJECT_ROOT

OUT_PATH = os.path.join(PROJECT_ROOT, "database", "schema.sql")


def main():
    if not os.path.exists(DATABASE_PATH):
        raise SystemExit(f"No database at {DATABASE_PATH} - run `python app.py` or `python seed.py` first.")

    conn = sqlite3.connect(DATABASE_PATH)
    rows = conn.execute(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' "
        "ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name"
    ).fetchall()
    conn.close()

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write("-- VitalTrack SQLite schema (exported from the live database)\n")
        f.write("-- Regenerate with: python backend/export_schema.py\n\n")
        for (sql,) in rows:
            f.write(sql.strip() + ";\n\n")

    print(f"Wrote {len(rows)} definitions to {OUT_PATH}")


if __name__ == "__main__":
    main()