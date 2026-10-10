# Creates demo data:
#   - login        username: admin   password: admin123
#   - patient      VT-1001 / John Doe
#   - ESP32 device ESP32-DEMO-01, assigned to that patient

# Run from the backend/ folder:   python seed.py
# The device API key is saved to firmware/device_key.txt for esp32_simulator.py.

import os
import secrets

from app import PROJECT_ROOT, create_app
from extensions import db
from models import Device, Patient, User

KEY_FILE = os.path.join(PROJECT_ROOT, "firmware", "device_key.txt")


def write_key_file(api_key):
    os.makedirs(os.path.dirname(KEY_FILE), exist_ok=True)
    with open(KEY_FILE, "w", encoding="utf-8") as f:
        f.write(api_key)


def main():
    app = create_app()
    with app.app_context():
        if not User.query.filter_by(username="admin").first():
            admin = User(username="admin", full_name="Admin", role="admin")
            admin.set_password("admin123")
            db.session.add(admin)
            print("Created login    -> username: admin | password: admin123")
        else:
            print("Login 'admin' already exists, skipping.")

        patient = Patient.query.filter_by(patient_code="VT-1001").first()
        if not patient:
            patient = Patient(
                patient_code="VT-1001", name="John Doe", age=28,
                gender="Male", ward="General Ward", status="active",
            )
            db.session.add(patient)
            db.session.flush()
            print("Created patient  -> VT-1001 / John Doe")
        else:
            print("Patient VT-1001 already exists, skipping.")

        device = Device.query.filter_by(device_uid="ESP32-DEMO-01").first()
        if not device:
            device = Device(
                device_uid="ESP32-DEMO-01", patient_id=patient.id,
                api_key=secrets.token_hex(16), firmware_version="v1.2.3",
            )
            db.session.add(device)
            print("Created device   -> ESP32-DEMO-01")
        else:
            print("Device ESP32-DEMO-01 already exists, skipping.")

        db.session.commit()
        write_key_file(device.api_key)
        print(f"Device API key   -> {device.api_key}")
        print(f"                    (saved to {os.path.relpath(KEY_FILE, PROJECT_ROOT)})")
        print("\nSeed complete. Next: start the server (python app.py), then run the simulator.")


if __name__ == "__main__":
    main()