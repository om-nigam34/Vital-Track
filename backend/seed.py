import secrets

from app import create_app
from extensions import db
from models import User, Patient, Device

app = create_app()

with app.app_context():
    if not User.query.filter_by(username="admin").first():
        admin = User(username="admin", full_name="Admin", role="admin")
        admin.set_password("admin123")
        db.session.add(admin)
        print("Created login  -> username: admin | password: admin123")
    else:
        print("User 'admin' already exists, skipping.")

    patient = Patient.query.filter_by(patient_code="VT-1001").first()
    if not patient:
        patient = Patient(
            patient_code="VT-1001",
            name="John Doe",
            age=28,
            gender="Male",
            ward="General Ward",
            status="active",
        )
        db.session.add(patient)
        db.session.flush()
        print("Created demo patient -> VT-1001 / John Doe")
    else:
        print("Patient VT-1001 already exists, skipping.")

    device = Device.query.filter_by(device_uid="ESP32-DEMO-01").first()
    if not device:
        device_api_key = secrets.token_hex(16)
        device = Device(
            device_uid="ESP32-DEMO-01",
            patient_id=patient.id,
            api_key=device_api_key,
            firmware_version="v1.2.3",
        )
        db.session.add(device)
        print(f"Created demo device -> ESP32-DEMO-01, api_key: {device_api_key}")
        print("   (this key is also written to firmware/device_key.txt for the simulator)")
        with open("../firmware/device_key.txt", "w") as f:
            f.write(device_api_key)
    else:
        print(f"Device ESP32-DEMO-01 already exists, api_key: {device.api_key}")
        with open("../firmware/device_key.txt", "w") as f:
            f.write(device.api_key)

    db.session.commit()
    print("\nSeed complete.")