import secrets

from flask import Blueprint, request, jsonify

from extensions import db
from models import Device, Patient
from utils.auth_utils import login_required

devices_bp = Blueprint("devices", __name__, url_prefix="/api/devices")


@devices_bp.get("")
@login_required
def list_devices():
    devices = Device.query.order_by(Device.created_at.desc()).all()
    return jsonify({"devices": [d.to_dict() for d in devices]})


@devices_bp.post("")
@login_required
def register_device():
    # Registers a new ESP32 unit and issues it an API key. Flash this key
    # (or set it as an env var picked up by firmware/esp32_simulator.py) so the
    # device can authenticate to /api/vitals/ingest.
    data = request.get_json(silent=True) or {}
    device_uid = (data.get("device_uid") or "").strip()
    if not device_uid:
        return jsonify({"error": "device_uid is required"}), 400
    if Device.query.filter_by(device_uid=device_uid).first():
        return jsonify({"error": "A device with that ID is already registered"}), 409

    patient_id = data.get("patient_id")
    if patient_id and not Patient.query.get(patient_id):
        return jsonify({"error": "patient_id does not exist"}), 400

    device = Device(
        device_uid=device_uid,
        patient_id=patient_id,
        api_key=secrets.token_hex(16),
        firmware_version=data.get("firmware_version", "v1.0.0"),
    )
    db.session.add(device)
    db.session.commit()
    return jsonify({"device": device.to_dict(), "api_key": device.api_key}), 201


@devices_bp.put("/<int:device_id>/assign")
@login_required
def assign_device(device_id):
    device = Device.query.get_or_404(device_id)
    data = request.get_json(silent=True) or {}
    patient_id = data.get("patient_id")
    if patient_id and not Patient.query.get(patient_id):
        return jsonify({"error": "patient_id does not exist"}), 400
    device.patient_id = patient_id
    db.session.commit()
    return jsonify({"device": device.to_dict()})


@devices_bp.delete("/<int:device_id>")
@login_required
def delete_device(device_id):
    device = Device.query.get_or_404(device_id)
    db.session.delete(device)
    db.session.commit()
    return jsonify({"message": "Device removed"})