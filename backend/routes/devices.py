import re
import secrets

from flask import Blueprint, jsonify

from extensions import db
from models import Device, Patient, VitalReading
from utils.auth_utils import login_required
from utils.http import error, json_body

devices_bp = Blueprint("devices", __name__, url_prefix="/api/devices")

DEVICE_UID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")


def _patient_id_from(data):
    # Returns (patient_id_or_None, problem). A missing/empty value means 'no patient'.
    raw = data.get("patient_id")
    if raw in (None, ""):
        return None, None
    try:
        patient_id = int(raw)
    except (TypeError, ValueError):
        return None, "patient_id must be a number"
    if db.session.get(Patient, patient_id) is None:
        return None, "patient_id does not exist"
    return patient_id, None


def _other_device_of(patient_id, device_id=None):
    query = Device.query.filter(Device.patient_id == patient_id)
    if device_id is not None:
        query = query.filter(Device.id != device_id)
    return query.first()


@devices_bp.get("")
@login_required
def list_devices():
    devices = Device.query.order_by(Device.created_at.desc(), Device.id.desc()).all()
    return jsonify({"devices": [d.to_dict() for d in devices]})


@devices_bp.post("")
@login_required
def register_device():
    # Registers a new ESP32 and issues its API key. The key is returned ONLY here -
    # put it in the firmware's secrets.h (or pass it to esp32_simulator.py --key).
    data = json_body()
    device_uid = str(data.get("device_uid") or "").strip()
    if not DEVICE_UID_RE.match(device_uid):
        return error("Device ID must be 1-64 characters: letters, numbers, dot, dash, underscore or colon", 400)
    if Device.query.filter_by(device_uid=device_uid).first():
        return error("A device with that ID is already registered", 409)

    patient_id, problem = _patient_id_from(data)
    if problem:
        return error(problem, 400)
    if patient_id and _other_device_of(patient_id):
        return error("That patient already has a device assigned", 409)

    firmware = str(data.get("firmware_version") or "v1.0.0").strip()[:16]
    device = Device(
        device_uid=device_uid,
        patient_id=patient_id,
        api_key=secrets.token_hex(16),
        firmware_version=firmware,
    )
    db.session.add(device)
    db.session.commit()
    return jsonify({"device": device.to_dict(), "api_key": device.api_key}), 201


@devices_bp.put("/<int:device_id>/assign")
@login_required
def assign_device(device_id):
    device = db.get_or_404(Device, device_id)
    patient_id, problem = _patient_id_from(json_body())
    if problem:
        return error(problem, 400)
    if patient_id and _other_device_of(patient_id, device.id):
        return error("That patient already has a device assigned", 409)

    device.patient_id = patient_id
    db.session.commit()
    return jsonify({"device": device.to_dict()})


@devices_bp.delete("/<int:device_id>")
@login_required
def delete_device(device_id):
    device = db.get_or_404(Device, device_id)
    # Keep the stored readings
    VitalReading.query.filter_by(device_id=device.id).update({"device_id": None}, synchronize_session=False)
    db.session.delete(device)
    db.session.commit()
    return jsonify({"message": "Device removed"})