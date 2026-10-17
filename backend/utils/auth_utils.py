import datetime
from functools import wraps

import jwt
from flask import current_app, g, request

from extensions import db
from models import User
from utils.http import error, json_body


def generate_token(user):
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        # The JWT standard says "sub" must be a string. Newer PyJWT versions reject a
        # number here, which is what caused "login works, then every page logs you out".
        "sub": str(user.id),
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
        options={"require": ["exp", "sub"]},
    )


def get_bearer_token():
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header.split(" ", 1)[1].strip()
    return None


def login_required(fn):
    # Protects dashboard API routes - needs a valid token from /api/auth/login.

    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = get_bearer_token()
        if not token:
            return error("Missing authorization token", 401)
        try:
            payload = decode_token(token)
            user_id = int(payload["sub"])
        except jwt.ExpiredSignatureError:
            return error("Session expired, please log in again", 401)
        except (jwt.InvalidTokenError, ValueError, KeyError):
            return error("Invalid authorization token", 401)

        user = db.session.get(User, user_id)
        if not user:
            return error("User no longer exists", 401)

        g.current_user = user
        return fn(*args, **kwargs)

    return wrapper


def device_key_required(fn):
    # Protects the ESP32 ingestion endpoint with a per-device API key instead of a login
    # token (a microcontroller cannot hold a short-lived user session).

    @wraps(fn)
    def wrapper(*args, **kwargs):
        api_key = request.headers.get("X-Device-Key") or json_body().get("api_key")
        if not api_key or not isinstance(api_key, str):
            return error("Missing device API key", 401)
        g.device_api_key = api_key
        return fn(*args, **kwargs)

    return wrapper