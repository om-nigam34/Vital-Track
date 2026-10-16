import math
from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, g, jsonify, request

from extensions import db
from models import Device, VitalReading
from utils.auth_utils import device_key_required, login_required
from utils.http import error, json_body
from utils.thresholds import check_reading

vitals_bp = Blueprint("vitals", __name__, url_prefix="/api/vitals")

VITAL_NAMES = ("heart_rate", "spo2", "temperature")


def _read_vital(data, name):
    # Return (value, problem) for one sensor value from the ESP32.
    if name not in data:
        return None, f"{name} is required"
    try:
        value = float(data[name])
    except (TypeError, ValueError):
        return None, f"{name} must be a number"
    if not math.isfinite(value):
        return None, f"{name} must be a real number"
    low, high = current_app.config["VITAL_LIMITS"][name]
    if not low <= value <= high:
        return None, f"{name} value {value:g} looks like a sensor error (expected {low}-{high})"
    return value, None


def _percent_or_none(value):
    # wifi_signal / battery_level: accept 0-100, ignore anything else.
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return number if 0 <= number <= 100 else None


@vitals_bp.post("/ingest")
@device_key_required
def ingest():
    # Called by the ESP32 firmware (or firmware/esp32_simulator.py) every few seconds.
    device = Device.query.filter_by(api_key=g.device_api_key).first()
    if not device:
        return error("Unknown or revoked device API key", 403)
    if not device.patient_id:
        return error("Device is not assigned to a patient yet", 409)

    data = json_body()
    values = {}
    for name in VITAL_NAMES:
        value, problem = _read_vital(data, name)
        if problem:
            return error(problem, 400)
        values[name] = value

    reading = VitalReading(patient_id=device.patient_id, device_id=device.id, **values)
    db.session.add(reading)
    db.session.flush()  # gives the reading an id so alerts can point at it

    new_alerts = check_reading(reading)

    device.last_seen = datetime.now(timezone.utc)
    wifi = _percent_or_none(data.get("wifi_signal"))
    if wifi is not None:
        device.wifi_signal = wifi
    battery = _percent_or_none(data.get("battery_level"))
    if battery is not None:
        device.battery_level = battery

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
    reading = query.order_by(VitalReading.recorded_at.desc(), VitalReading.id.desc()).first()
    return jsonify({"reading": reading.to_dict() if reading else None})


@vitals_bp.get("/history")
@login_required
def history():
    config = current_app.config
    patient_id = request.args.get("patient_id", type=int)
    if not patient_id:
        return error("patient_id is required", 400)

    minutes = request.args.get("minutes", default=60, type=int)
    minutes = max(1, min(minutes, config["HISTORY_MAX_MINUTES"]))
    max_points = request.args.get("max_points", default=config["HISTORY_DEFAULT_POINTS"], type=int)
    max_points = max(10, min(max_points, config["HISTORY_MAX_POINTS"]))

    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    readings = (
        VitalReading.query.filter(
            VitalReading.patient_id == patient_id,
            VitalReading.recorded_at >= since,
        )
        .order_by(VitalReading.recorded_at.asc(), VitalReading.id.asc())
        .all()
    )

    total = len(readings)
    if total > max_points:
        # Keep the chart light: pick evenly spaced points but always keep the newest one
        step = math.ceil(total / max_points)
        picked = readings[::step]
        if picked[-1] is not readings[-1]:
            picked.append(readings[-1])
        readings = picked

    return jsonify({"readings": [r.to_dict() for r in readings], "total": total})