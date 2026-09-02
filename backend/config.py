import os
from datetime import timedelta

BASE_DIR = os.path.abspath(os.path.dirname(os.path.dirname(__file__)))


class Config:
    # Secret used to sign JWT access tokens. Override in production via env var.
    SECRET_KEY = os.environ.get("VITALTRACK_SECRET_KEY", "dev-secret-change-me")

    # SQLite database lives in /database so it matches the README's project layout
    SQLALCHEMY_DATABASE_URI = "sqlite:///" + os.path.join(BASE_DIR, "database", "vitaltrack.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    JWT_ALGORITHM = "HS256"
    JWT_EXPIRES = timedelta(hours=12)

    # Every reading older than this many minutes marks a device as "disconnected"
    DEVICE_OFFLINE_AFTER_SECONDS = 30

    # Vital sign thresholds used by utils/thresholds.py to raise alerts
    THRESHOLDS = {
        "heart_rate": {"low": 60, "high": 100, "unit": "BPM"},
        "spo2": {"low": 95, "high": 100, "unit": "%"},
        "temperature": {"low": 36.1, "high": 37.2, "unit": "°C"},
    }