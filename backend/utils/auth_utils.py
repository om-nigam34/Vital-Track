import datetime
from functools import wraps

import jwt
from flask import request, jsonify, current_app

from models import User


def generate_token(user):
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "sub": user.id,
        "username": user.username,
        "role": user.role,
        "iat": now,
        "exp": now + current_app.config["JWT_EXPIRES"],
    }
    return jwt.encode(payload, current_app.config["SECRET_KEY"], algorithm=current_app.config["JWT_ALGORITHM"])


def decode_token(token):
    return jwt.decode(
        token,
        current_app.config["SECRET_KEY"],
        algorithms=[current_app.config["JWT_ALGORITHM"]],
    )


def get_bearer_token():
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header.split(" ", 1)[1].strip()
    return None


def login_required(fn):
    """Protects dashboard API routes - requires a valid JWT from /api/auth/login."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = get_bearer_token()
        if not token:
            return jsonify({"error": "Missing authorization token"}), 401
        try:
            payload = decode_token(token)
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Session expired, please log in again"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid authorization token"}), 401

        user = User.query.get(payload.get("sub"))
        if not user:
            return jsonify({"error": "User no longer exists"}), 401

        request.current_user = user
        return fn(*args, **kwargs)

    return wrapper


def device_key_required(fn):
    """Protects the ESP32 ingestion endpoint using a per-device API key instead of a JWT,
    since a microcontroller cannot easily hold a short-lived user session."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        api_key = request.headers.get("X-Device-Key") or (request.json or {}).get("api_key")
        if not api_key:
            return jsonify({"error": "Missing device API key"}), 401
        request.device_api_key = api_key
        return fn(*args, **kwargs)

    return wrapper