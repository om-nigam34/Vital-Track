"""Dumps the current SQLite schema to ../database/schema.sql.
Handy after changing a model in models.py - run once so the .sql file in
version control stays in sync with what SQLAlchemy actually creates.

Usage (from backend/):  python export_schema.py
"""

import os
import sqlite3

from app import DASHBOARD_DIR  # noqa: F401 (import triggers path setup consistency)
from config import Config

DB_PATH = Config.SQLALCHEMY_DATABASE_URI.replace("sqlite:///", "")
OUT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "database", "schema.sql")


def main():
    if not os.path.exists(DB_PATH):
        raise SystemExit(f"No database found at {DB_PATH} - run app.py or seed.py first to create it.")

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")
    rows = cur.fetchall()
    conn.close()

    with open(OUT_PATH, "w") as f:
        f.write("-- VitalTrack SQLite schema (auto-exported from models.py via SQLAlchemy create_all())\n")
        f.write("-- Regenerate any time with: python export_schema.py\n\n")
        for (sql,) in rows:
            f.write(sql + ";\n\n")

    print(f"Wrote schema for {len(rows)} tables to {OUT_PATH}")


if __name__ == "__main__":
    main()