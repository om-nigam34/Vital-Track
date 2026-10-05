import os
import socket

from flask import Flask, jsonify, request
from sqlalchemy import text
from werkzeug.exceptions import HTTPException

from config import DATABASE_DIR, Config, env_bool, load_secret_key
from extensions import db
from utils.http import error
from utils.rate_limit import FailureLimiter

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
DASHBOARD_DIR = os.path.join(PROJECT_ROOT, "dashboard")

FRIENDLY_ERRORS = {
    400: "Bad request",
    401: "Please log in",
    403: "Not allowed",
    404: "Not found",
    405: "Method not allowed",
    413: "Request too large",
    415: "Unsupported content type",
}


def create_app(overrides=None):
    app = Flask(__name__, static_folder=DASHBOARD_DIR, static_url_path="")
    app.config.from_object(Config)
    app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024
    if overrides:
        app.config.update(overrides)
    if not app.config.get("SECRET_KEY"):
        app.config["SECRET_KEY"] = load_secret_key()

    os.makedirs(DATABASE_DIR, exist_ok=True)
    db.init_app(app)

    app.extensions["login_limiter"] = FailureLimiter(
        app.config["LOGIN_MAX_FAILURES"], app.config["LOGIN_WINDOW_SECONDS"]
    )

    from routes.alerts import alerts_bp
    from routes.auth import auth_bp
    from routes.devices import devices_bp
    from routes.patients import patients_bp
    from routes.vitals import vitals_bp

    for blueprint in (auth_bp, patients_bp, vitals_bp, alerts_bp, devices_bp):
        app.register_blueprint(blueprint)

    with app.app_context():
        db.create_all()

    @app.get("/api/health")
    def health():
        try:
            db.session.execute(text("SELECT 1"))
            return jsonify({"status": "ok", "service": "VitalTrack API"})
        except Exception:  # pragma: no cover - only if the database file is unusable
            return error("Database unavailable", 503)

    @app.get("/")
    def index():
        return app.send_static_file("index.html")

    @app.errorhandler(HTTPException)
    def handle_http_error(exc):
        # API callers always get JSON, never an HTML error page
        if request.path.startswith("/api/"):
            message = FRIENDLY_ERRORS.get(exc.code, exc.name)
            return error(message, exc.code)
        return exc

    @app.errorhandler(500)
    def handle_server_error(exc):
        app.logger.exception("Unhandled error: %s", exc)
        if request.path.startswith("/api/"):
            return error("Something went wrong on the server", 500)
        return "Something went wrong on the server", 500

    @app.after_request
    def add_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        else:
            response.headers["Cache-Control"] = "no-cache"
        return response

    return app


def _lan_ip():
    # Best guess of this computer's address on the local network (what the ESP32 must use).
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no packet is actually sent
            return s.getsockname()[0]
    except OSError:
        return None


def main():
    host = os.environ.get("VITALTRACK_HOST", "0.0.0.0")
    port = int(os.environ.get("VITALTRACK_PORT", "5000"))
    debug = env_bool("VITALTRACK_DEBUG", False)

    app = create_app()

    # With debug on, Flask starts this file twice (reloader); print the banner only once
    if not debug or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        print()
        print("  VitalTrack is running")
        print(f"    Dashboard (this computer):  http://localhost:{port}")
        lan = _lan_ip()
        if lan and host == "0.0.0.0":
            print(f"    ESP32 server address:       http://{lan}:{port}")
        print("    Stop the server with Ctrl+C")
        print()

    app.run(host=host, port=port, debug=debug)


if __name__ == "__main__":
    main()