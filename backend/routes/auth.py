import re

from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy import func

from config import VERSION
from extensions import db
from models import User
from utils.auth_utils import generate_token, login_required
from utils.http import error, json_body

auth_bp = Blueprint("auth", __name__, url_prefix="/api")

USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,64}$")
MIN_PASSWORD_LENGTH = 8


def _find_user(username):
    return User.query.filter(func.lower(User.username) == username.lower()).first()


@auth_bp.get("/meta")
def meta():
    # Public info the pages need before anyone is logged in.
    config = current_app.config
    return jsonify({
        "name": "VitalTrack",
        "version": VERSION,
        "registration_enabled": bool(config["ALLOW_REGISTRATION"]),
        "thresholds": config["THRESHOLDS"],
        "device_offline_after_seconds": config["DEVICE_OFFLINE_AFTER_SECONDS"],
    })


@auth_bp.post("/auth/login")
def login():
    data = json_body()
    username = str(data.get("username") or "").strip()
    password = str(data.get("password") or "")

    if not username or not password:
        return error("Username and password are required", 400)

    limiter = current_app.extensions["login_limiter"]
    key = f"{request.remote_addr}|{username.lower()}"
    wait = limiter.retry_after(key)
    if wait:
        return error(f"Too many failed attempts. Try again in {wait} seconds.", 429)

    user = _find_user(username)
    if not user or not user.check_password(password):
        limiter.record_failure(key)
        return error("Invalid username or password", 401)

    limiter.reset(key)
    return jsonify({"token": generate_token(user), "user": user.to_dict()})


@auth_bp.post("/auth/register")
def register():
    if not current_app.config["ALLOW_REGISTRATION"]:
        return error("Creating new accounts is disabled", 403)

    data = json_body()
    username = str(data.get("username") or "").strip()
    password = str(data.get("password") or "")
    full_name = str(data.get("full_name") or "").strip() or username

    if not USERNAME_RE.match(username):
        return error("Username must be 3-64 characters: letters, numbers, dot, dash or underscore", 400)
    if len(password) < MIN_PASSWORD_LENGTH:
        return error(f"Password must be at least {MIN_PASSWORD_LENGTH} characters", 400)
    if len(password) > 128:
        return error("Password is too long", 400)
    if len(full_name) > 128:
        return error("Name is too long (max 128 characters)", 400)
    if _find_user(username):
        return error("That username is already taken", 409)

    user = User(username=username, full_name=full_name, role="admin")
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    return jsonify({"token": generate_token(user), "user": user.to_dict()}), 201


@auth_bp.get("/auth/me")
@login_required
def me():
    return jsonify({"user": g.current_user.to_dict()})