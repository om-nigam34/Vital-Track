from datetime import datetime, timedelta, timezone

from flask import Blueprint, request, jsonify

from extensions import db
from models import Patient, Device, VitalReading
from utils.auth_utils import login_required, device_key_required
from utils.thresholds import check_reading

vitals_bp = Blueprint("vitals", __name__, url_prefix="/api/vitals")


@vitals_bp.post("/ingest")
@device_key_required
def ingest():
    # Endpoint the ESP32 firmware (or firmware/esp32_simulator.py) calls every
    # couple of seconds with a fresh sensor reading.
    device = Device.query.filter_by(api_key=request.device_api_key).first()
    if not device:
        return jsonify({"error": "Unknown or revoked device API key"}), 403
    if not device.patient_id:
        return jsonify({"error": "Device is not assigned to a patient yet"}), 409

    data = request.get_json(silent=True) or {}
    try:
        heart_rate = float(data["heart_rate"])
        spo2 = float(data["spo2"])
        temperature = float(data["temperature"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "heart_rate, spo2 and temperature (numbers) are required"}), 400

    reading = VitalReading(
        patient_id=device.patient_id,
        device_id=device.id,
        heart_rate=heart_rate,
        spo2=spo2,
        temperature=temperature,
    )
    db.session.add(reading)
    db.session.flush()  # assigns reading.id before we reference it in alerts

    new_alerts = check_reading(reading)

    device.last_seen = datetime.now(timezone.utc)
    if "wifi_signal" in data:
        device.wifi_signal = data["wifi_signal"]
    if "battery_level" in data:
        device.battery_level = data["battery_level"]

    db.session.commit()

    return jsonify({
        "reading": reading.to_dict(),
        "alerts_created": [a.to_dict() for a in new_alerts],
    }), 201


@vitals_bp.get("/latest")
@login_required
def latest():
    patient_id = request.args.get("patient_id", type=int)
    query = VitalReading.query
    if patient_id:
        query = query.filter_by(patient_id=patient_id)
    reading = query.order_by(VitalReading.recorded_at.desc()).first()
    if not reading:
        return jsonify({"reading": None})
    return jsonify({"reading": reading.to_dict()})


@vitals_bp.get("/history")
@login_required
def history():
    patient_id = request.args.get("patient_id", type=int)
    minutes = request.args.get("minutes", default=60, type=int)
    if not patient_id:
        return jsonify({"error": "patient_id is required"}), 400

    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    readings = (
        VitalReading.query.filter(
            VitalReading.patient_id == patient_id,
            VitalReading.recorded_at >= since,
        )
        .order_by(VitalReading.recorded_at.asc())
        .all()
    )
    return jsonify({"readings": [r.to_dict() for r in readings]})