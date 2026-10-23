# Threshold checking.

# For every new reading, compare heart rate / SpO2 / temperature with the normal
# ranges in Config.THRESHOLDS and create an Alert for anything outside them.

# The same abnormal value is usually reported again every few seconds, so an alert
# is only created again after ALERT_COOLDOWN_SECONDS (default 60 s) for the same
# patient and the same kind of problem. Without this, one fever would create
# hundreds of identical alerts.

from datetime import timedelta

from flask import current_app

from extensions import db
from models import Alert, utcnow

LABELS = {
    "heart_rate": "Heart Rate",
    "spo2": "SpO2",
    "temperature": "Temperature",
}


def _severity_for(value, low, high):
    # More than ~15% of the normal range past the edge = critical, a smaller breach = warning.
    span = max(high - low, 1e-6)
    breach = (low - value) / span if value < low else (value - high) / span
    return "critical" if breach > 0.15 else "warning"


def _format_value(value, unit):
    text = f"{round(value, 1):g}"
    return f"{text}{unit}" if unit == "%" else f"{text} {unit}"


def find_breaches(reading, thresholds):
    # List of out-of-range vitals for a reading (it does not touch the database).
    values = {
        "heart_rate": reading.heart_rate,
        "spo2": reading.spo2,
        "temperature": reading.temperature,
    }
    breaches = []
    for vital_type, value in values.items():
        if value is None:
            continue
        bounds = thresholds[vital_type]
        low, high, unit = bounds["low"], bounds["high"], bounds["unit"]
        if value < low or value > high:
            direction = "Low" if value < low else "High"
            label = LABELS[vital_type]
            breaches.append({
                "vital_type": vital_type,
                "title": f"{direction} {label}",
                "severity": _severity_for(value, low, high),
                "message": (
                    f"{label} reading of {_format_value(value, unit)} is outside the "
                    f"normal range ({low}-{_format_value(high, unit)})."
                ),
            })
    return breaches


def check_reading(reading):
    # Set the reading's ecg_status and create alerts for new problems.
    # Returns the list of Alert objects that were added (not yet committed).

    thresholds = current_app.config["THRESHOLDS"]
    cooldown = timedelta(seconds=current_app.config["ALERT_COOLDOWN_SECONDS"])
    cutoff = utcnow() - cooldown

    breaches = find_breaches(reading, thresholds)

    # The sensor list has no real ECG front-end, so "Irregular" simply means the heart
    # rate is outside its normal range. This is decided from the reading itself, not from
    # whether a new alert was created, so it stays correct while an alert is in cooldown.
    reading.ecg_status = "Irregular" if any(b["vital_type"] == "heart_rate" for b in breaches) else "Normal"

    new_alerts = []
    for breach in breaches:
        recently_alerted = (
            Alert.query.filter(
                Alert.patient_id == reading.patient_id,
                Alert.vital_type == breach["vital_type"],
                Alert.title == breach["title"],
                Alert.created_at >= cutoff,
            ).first()
            is not None
        )
        if recently_alerted:
            continue
        alert = Alert(
            patient_id=reading.patient_id,
            reading_id=reading.id,
            vital_type=breach["vital_type"],
            severity=breach["severity"],
            title=breach["title"],
            message=breach["message"],
        )
        db.session.add(alert)
        new_alerts.append(alert)

    return new_alerts