from flask import Blueprint, request, jsonify

from extensions import db
from models import Patient
from utils.auth_utils import login_required

patients_bp = Blueprint("patients", __name__, url_prefix="/api/patients")


def _next_patient_code():
    last = Patient.query.order_by(Patient.id.desc()).first()
    next_num = 1001 if not last else 1001 + Patient.query.count()
    code = f"VT-{next_num}"
    while Patient.query.filter_by(patient_code=code).first():
        next_num += 1
        code = f"VT-{next_num}"
    return code


@patients_bp.get("")
@login_required
def list_patients():
    status = request.args.get("status")
    query = Patient.query
    if status:
        query = query.filter_by(status=status)
    patients = query.order_by(Patient.created_at.desc()).all()
    include_latest = request.args.get("include_latest") == "1"
    return jsonify({"patients": [p.to_dict(include_latest=include_latest) for p in patients]})


@patients_bp.post("")
@login_required
def create_patient():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Patient name is required"}), 400

    patient = Patient(
        patient_code=_next_patient_code(),
        name=name,
        age=data.get("age"),
        gender=data.get("gender"),
        ward=data.get("ward"),
        status=data.get("status", "active"),
    )
    db.session.add(patient)
    db.session.commit()
    return jsonify({"patient": patient.to_dict()}), 201


@patients_bp.get("/<int:patient_id>")
@login_required
def get_patient(patient_id):
    patient = Patient.query.get_or_404(patient_id)
    return jsonify({"patient": patient.to_dict(include_latest=True)})


@patients_bp.put("/<int:patient_id>")
@login_required
def update_patient(patient_id):
    patient = Patient.query.get_or_404(patient_id)
    data = request.get_json(silent=True) or {}

    for field in ("name", "age", "gender", "ward", "status"):
        if field in data:
            setattr(patient, field, data[field])

    db.session.commit()
    return jsonify({"patient": patient.to_dict()})


@patients_bp.delete("/<int:patient_id>")
@login_required
def delete_patient(patient_id):
    patient = Patient.query.get_or_404(patient_id)
    db.session.delete(patient)
    db.session.commit()
    return jsonify({"message": "Patient deleted"})