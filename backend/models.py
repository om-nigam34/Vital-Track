from datetime import datetime, timezone

from flask import current_app
from werkzeug.security import generate_password_hash, check_password_hash

from extensions import db


def utcnow():
    return datetime.now(timezone.utc)


def iso_utc(dt):
    # Format a datetime as an ISO string that always ends in 'Z' (UTC).
    # SQLite gives datetimes back without timezone info. Without the 'Z', the browser
    # would treat the value as local time and show it hours off (5.5 hours in India).
    
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class User(db.Model):
    # A person who can log in to the dashboard (doctor / nurse / admin).

    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False, index=True)
    full_name = db.Column(db.String(128), nullable=False, default="")
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(32), nullable=False, default="admin")
    created_at = db.Column(db.DateTime, default=utcnow)

    def set_password(self, raw_password):
        self.password_hash = generate_password_hash(raw_password)

    def check_password(self, raw_password):
        return check_password_hash(self.password_hash, raw_password)

    def to_dict(self):
        return {
            "id": self.id,
            "username": self.username,
            "full_name": self.full_name,
            "role": self.role,
        }


class Patient(db.Model):
    __tablename__ = "patients"

    id = db.Column(db.Integer, primary_key=True)
    patient_code = db.Column(db.String(20), unique=True, nullable=False)  # e.g. VT-1001
    name = db.Column(db.String(128), nullable=False)
    age = db.Column(db.Integer)
    gender = db.Column(db.String(16))
    ward = db.Column(db.String(64))
    status = db.Column(db.String(16), default="active")  # active | discharged
    created_at = db.Column(db.DateTime, default=utcnow)

    devices = db.relationship("Device", backref="patient", lazy=True)
    readings = db.relationship(
        "VitalReading", backref="patient", lazy=True, cascade="all, delete-orphan", passive_deletes=True
    )
    alerts = db.relationship(
        "Alert", backref="patient", lazy=True, cascade="all, delete-orphan", passive_deletes=True
    )

    def to_dict(self, include_latest=False):
        data = {
            "id": self.id,
            "patient_code": self.patient_code,
            "name": self.name,
            "age": self.age,
            "gender": self.gender,
            "ward": self.ward,
            "status": self.status,
            "created_at": iso_utc(self.created_at),
        }
        if include_latest:
            latest = (
                VitalReading.query.filter_by(patient_id=self.id)
                .order_by(VitalReading.recorded_at.desc(), VitalReading.id.desc())
                .first()
            )
            data["latest_reading"] = latest.to_dict() if latest else None
            device = Device.query.filter_by(patient_id=self.id).first()
            data["device"] = device.to_dict() if device else None
        return data


class Device(db.Model):
    # An ESP32 unit. It can be assigned to one patient at a time.

    __tablename__ = "devices"

    id = db.Column(db.Integer, primary_key=True)
    device_uid = db.Column(db.String(64), unique=True, nullable=False)  # e.g. ESP32-WARD3-02
    patient_id = db.Column(db.Integer, db.ForeignKey("patients.id"), nullable=True)
    api_key = db.Column(db.String(64), unique=True, nullable=False)
    firmware_version = db.Column(db.String(16), default="v1.0.0")
    wifi_signal = db.Column(db.Integer, default=0)  # 0-100 %
    battery_level = db.Column(db.Integer, default=100)  # 0-100 %
    last_seen = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow)

    def is_connected(self, offline_after_seconds=None):
        if not self.last_seen:
            return False
        if offline_after_seconds is None:
            offline_after_seconds = current_app.config["DEVICE_OFFLINE_AFTER_SECONDS"]
        last_seen = self.last_seen
        if last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)
        return (utcnow() - last_seen).total_seconds() <= offline_after_seconds

    def to_dict(self):
        # api_key is deliberately never included: it is shown once, when the device is registered
        return {
            "id": self.id,
            "device_uid": self.device_uid,
            "patient_id": self.patient_id,
            "firmware_version": self.firmware_version,
            "wifi_signal": self.wifi_signal,
            "battery_level": self.battery_level,
            "last_seen": iso_utc(self.last_seen),
            "connected": self.is_connected(),
        }


class VitalReading(db.Model):
    __tablename__ = "vital_readings"
    __table_args__ = (db.Index("ix_vital_readings_patient_time", "patient_id", "recorded_at"),)

    id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.Integer, db.ForeignKey("patients.id"), nullable=False, index=True)
    device_id = db.Column(db.Integer, db.ForeignKey("devices.id"), nullable=True)

    heart_rate = db.Column(db.Float)      # BPM, from MAX30100
    spo2 = db.Column(db.Float)            # %, from MAX30100
    temperature = db.Column(db.Float)     # degrees C, from DS18B20
    ecg_status = db.Column(db.String(32), default="Normal")  # derived label, see utils/thresholds.py

    recorded_at = db.Column(db.DateTime, default=utcnow, index=True)

    def to_dict(self):
        return {
            "id": self.id,
            "patient_id": self.patient_id,
            "device_id": self.device_id,
            "heart_rate": self.heart_rate,
            "spo2": self.spo2,
            "temperature": self.temperature,
            "ecg_status": self.ecg_status,
            "recorded_at": iso_utc(self.recorded_at),
        }


class Alert(db.Model):
    __tablename__ = "alerts"
    __table_args__ = (db.Index("ix_alerts_patient_type_time", "patient_id", "vital_type", "created_at"),)

    id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.Integer, db.ForeignKey("patients.id"), nullable=False, index=True)
    reading_id = db.Column(db.Integer, db.ForeignKey("vital_readings.id"), nullable=True)

    vital_type = db.Column(db.String(32))     # heart_rate | spo2 | temperature
    severity = db.Column(db.String(16))       # critical | warning
    title = db.Column(db.String(128))         # e.g. "High Heart Rate"
    message = db.Column(db.String(255))
    is_read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=utcnow, index=True)

    def to_dict(self):
        return {
            "id": self.id,
            "patient_id": self.patient_id,
            "vital_type": self.vital_type,
            "severity": self.severity,
            "title": self.title,
            "message": self.message,
            "is_read": bool(self.is_read),
            "created_at": iso_utc(self.created_at),
        }