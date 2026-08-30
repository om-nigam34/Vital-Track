from flask import Blueprint, request, jsonify

from extensions import db
from models import Alert
from utils.auth_utils import login_required

alerts_bp = Blueprint("alerts", __name__, url_prefix="/api/alerts")


@alerts_bp.get("")
@login_required
def list_alerts():
    patient_id = request.args.get("patient_id", type=int)
    unread_only = request.args.get("unread_only") == "1"
    limit = request.args.get("limit", default=50, type=int)

    query = Alert.query
    if patient_id:
        query = query.filter_by(patient_id=patient_id)
    if unread_only:
        query = query.filter_by(is_read=False)

    alerts = query.order_by(Alert.created_at.desc()).limit(limit).all()
    unread_count = Alert.query.filter_by(is_read=False).count()
    return jsonify({"alerts": [a.to_dict() for a in alerts], "unread_count": unread_count})


@alerts_bp.post("/<int:alert_id>/read")
@login_required
def mark_read(alert_id):
    alert = Alert.query.get_or_404(alert_id)
    alert.is_read = True
    db.session.commit()
    return jsonify({"alert": alert.to_dict()})


@alerts_bp.post("/read-all")
@login_required
def mark_all_read():
    patient_id = request.args.get("patient_id", type=int)
    query = Alert.query.filter_by(is_read=False)
    if patient_id:
        query = query.filter_by(patient_id=patient_id)
    query.update({"is_read": True})
    db.session.commit()
    return jsonify({"message": "All alerts marked as read"})