from flask import Blueprint, jsonify, request

from extensions import db
from models import Alert, Device, Patient, VitalReading
from utils.auth_utils import login_required
from utils.http import error, json_body

patients_bp = Blueprint("patients", __name__, url_prefix="/api/patients")

GENDERS = ("Male", "Female", "Other")
STATUSES = ("active", "discharged")


def _next_patient_code():
    # VT-1001, VT-1002,... always one higher than the biggest existing number.
    highest = 1000
    for (code,) in db.session.query(Patient.patient_code).all():
        suffix = code.split("-")[-1]
        if suffix.isdigit():
            highest = max(highest, int(suffix))
    return f"VT-{highest + 1}"


def _clean(data, partial):
    # Validate the fields a client may send. Returns (clean_values, error_message).
    clean = {}

    if "name" in data or not partial:
        name = str(data.get("name") or "").strip()
        if not name:
            return None, "Patient name is required"
        if len(name) > 128:
            return None, "Name is too long (max 128 characters)"
        clean["name"] = name

    if "age" in data:
        age = data["age"]
        if age in (None, ""):
            clean["age"] = None
        else:
            try:
                age = int(age)
            except (TypeError, ValueError):
                return None, "Age must be a whole number"
            if not 0 <= age <= 130:
                return None, "Age must be between 0 and 130"
            clean["age"] = age

    if "gender" in data:
        gender = data["gender"]
        if gender in (None, ""):
            clean["gender"] = None
        elif gender not in GENDERS:
            return None, "Gender must be one of: " + ", ".join(GENDERS)
        else:
            clean["gender"] = gender

    if "ward" in data:
        ward = str(data["ward"] or "").strip()
        if len(ward) > 64:
            return None, "Ward is too long (max 64 characters)"
        clean["ward"] = ward or None

    if "status" in data:
        if data["status"] not in STATUSES:
            return None, "Status must be 'active' or 'discharged'"
        clean["status"] = data["status"]

    return clean, None


@patients_bp.get("")
@login_required
def list_patients():
    status = request.args.get("status")
    query = Patient.query
    if status:
        query = query.filter_by(status=status)
    patients = query.order_by(Patient.created_at.desc(), Patient.id.desc()).all()
    include_latest = request.args.get("include_latest") == "1"
    return jsonify({"patients": [p.to_dict(include_latest=include_latest) for p in patients]})


@patients_bp.post("")
@login_required
def create_patient():
    clean, problem = _clean(json_body(), partial=False)
    if problem:
        return error(problem, 400)

    clean.setdefault("status", "active")
    patient = Patient(patient_code=_next_patient_code(), **clean)
    db.session.add(patient)
    db.session.commit()
    return jsonify({"patient": patient.to_dict()}), 201


@patients_bp.get("/<int:patient_id>")
@login_required
def get_patient(patient_id):
    patient = db.get_or_404(Patient, patient_id)
    return jsonify({"patient": patient.to_dict(include_latest=True)})


@patients_bp.put("/<int:patient_id>")
@login_required
def update_patient(patient_id):
    patient = db.get_or_404(Patient, patient_id)
    clean, problem = _clean(json_body(), partial=True)
    if problem:
        return error(problem, 400)

    for field, value in clean.items():
        setattr(patient, field, value)
    db.session.commit()
    return jsonify({"patient": patient.to_dict()})


@patients_bp.delete("/<int:patient_id>")
@login_required
def delete_patient(patient_id):
    patient = db.get_or_404(Patient, patient_id)

    # Alerts point at readings, so they go first. The patient's device is kept, just unassigned.
    Alert.query.filter_by(patient_id=patient.id).delete(synchronize_session=False)
    VitalReading.query.filter_by(patient_id=patient.id).delete(synchronize_session=False)
    Device.query.filter_by(patient_id=patient.id).update({"patient_id": None}, synchronize_session=False)
    db.session.delete(patient)
    db.session.commit()
    return jsonify({"message": "Patient deleted"})