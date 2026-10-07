import sqlite3

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import event
from sqlalchemy.engine import Engine

db = SQLAlchemy()


@event.listens_for(Engine, "connect")
def _configure_sqlite(dbapi_connection, _connection_record):
    """Per-connection SQLite settings.

    - foreign_keys: make SQLite actually enforce the foreign keys in models.py
    - WAL: the ESP32 can write a reading while the dashboard is reading, without locking
    - busy_timeout: wait a moment instead of failing if the database is briefly busy
    """
    if isinstance(dbapi_connection, sqlite3.Connection):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=15000")
        cursor.close()