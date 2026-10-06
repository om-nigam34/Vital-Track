import os
import secrets
from datetime import timedelta

VERSION = "1.1.0"

BASE_DIR = os.path.abspath(os.path.dirname(os.path.dirname(__file__)))
DATABASE_DIR = os.path.join(BASE_DIR, "database")
DATABASE_PATH = os.path.join(DATABASE_DIR, "vitaltrack.db")


def env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def load_secret_key():
    # Key used to sign login tokens.
    # Uses VITALTRACK_SECRET_KEY if set. Otherwise a random key is generated once and
    # saved to database/.secret_key (git-ignored), so logins survive a server restart
    # and nobody can forge a token using a key that is public on GitHub.

    from_env = os.environ.get("VITALTRACK_SECRET_KEY")
    if from_env:
        return from_env

    key_file = os.path.join(DATABASE_DIR, ".secret_key")
    try:
        with open(key_file, "r", encoding="utf-8") as f:
            key = f.read().strip()
            if len(key) >= 32:
                return key
    except FileNotFoundError:
        pass

    os.makedirs(DATABASE_DIR, exist_ok=True)
    key = secrets.token_hex(32)
    with open(key_file, "w", encoding="utf-8") as f:
        f.write(key)
    return key


class Config:
    # SECRET_KEY is filled in by create_app() via load_secret_key()
    SQLALCHEMY_DATABASE_URI = "sqlite:///" + DATABASE_PATH.replace("\\", "/")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {"connect_args": {"timeout": 15}}

    # Static files (dashboard) are re-checked on every request so edits show up immediately
    SEND_FILE_MAX_AGE_DEFAULT = 0

    # login
    JWT_ALGORITHM = "HS256"
    JWT_EXPIRES = timedelta(hours=12)
    ALLOW_REGISTRATION = env_bool("VITALTRACK_ALLOW_REGISTRATION", True)
    LOGIN_MAX_FAILURES = 5          # wrong passwords allowed...
    LOGIN_WINDOW_SECONDS = 300      # ...within this many seconds before a temporary lock

    # devices
    # A device that has not sent data for this long is shown as "Disconnected"
    DEVICE_OFFLINE_AFTER_SECONDS = 30

    # alerts
    # Normal ranges. A reading outside these creates an alert.
    THRESHOLDS = {
        "heart_rate": {"low": 60, "high": 100, "unit": "BPM"},
        "spo2": {"low": 95, "high": 100, "unit": "%"},
        "temperature": {"low": 36.1, "high": 37.2, "unit": "\u00b0C"},
    }
    # Do not raise the same alert again for the same patient within this many seconds
    ALERT_COOLDOWN_SECONDS = 60

    # Readings outside these limits are rejected as sensor errors (e.g. a DS18B20
    # that is unplugged reports -127 degrees)
    VITAL_LIMITS = {
        "heart_rate": (20, 250),
        "spo2": (50, 100),
        "temperature": (25, 45),
    }

    # API
    HISTORY_MAX_MINUTES = 7 * 24 * 60
    HISTORY_DEFAULT_POINTS = 500
    HISTORY_MAX_POINTS = 2000