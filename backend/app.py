import os

from flask import Flask

from config import Config
from extensions import db

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
DASHBOARD_DIR = os.path.join(PROJECT_ROOT, "dashboard")


def create_app():
    app = Flask(__name__, static_folder=DASHBOARD_DIR, static_url_path="")
    app.config.from_object(Config)

    db.init_app(app)

    from routes.auth import auth_bp
    from routes.patients import patients_bp
    from routes.vitals import vitals_bp
    from routes.alerts import alerts_bp
    from routes.devices import devices_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(patients_bp)
    app.register_blueprint(vitals_bp)
    app.register_blueprint(alerts_bp)
    app.register_blueprint(devices_bp)

    with app.app_context():
        db.create_all()

    @app.get("/api/health")
    def health():
        return {"status": "ok", "service": "VitalTrack API"}

    @app.get("/")
    def index():
        return app.send_static_file("index.html")

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)