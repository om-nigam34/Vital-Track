"""
Threshold-checking utility.

Takes a freshly-saved VitalReading, compares each value against the ranges in
Config.THRESHOLDS, and creates Alert rows for anything out of range. Also derives
a simple ECG status label since the current sensor list (MAX30100 + DS18B20) has
no dedicated ECG front-end - see the note in README_STACK_NOTES.md.
"""

from flask import current_app

from extensions import db
from models import Alert


LABELS = {
    "heart_rate": "Heart Rate",
    "spo2": "SpO2",
    "temperature": "Temperature",
}


def _severity_for(vital_type, value, low, high):
    # Anything more than ~15% past the threshold edge is flagged critical,
    # a smaller breach is a warning.
    span = max(high - low, 1e-6)
    if value < low:
        breach = (low - value) / span
    else:
        breach = (value - high) / span
    return "critical" if breach > 0.15 else "warning"


def check_reading(reading):
    """Given a saved VitalReading, create Alert rows for out-of-range vitals.
    Returns the list of newly created Alert objects (not yet committed)."""

    thresholds = current_app.config["THRESHOLDS"]
    new_alerts = []

    values = {
        "heart_rate": reading.heart_rate,
        "spo2": reading.spo2,
        "temperature": reading.temperature,
    }

    for vital_type, value in values.items():
        if value is None:
            continue
        bounds = thresholds[vital_type]
        low, high, unit = bounds["low"], bounds["high"], bounds["unit"]

        if value < low or value > high:
            direction = "Low" if value < low else "High"
            label = LABELS[vital_type]
            severity = _severity_for(vital_type, value, low, high)
            alert = Alert(
                patient_id=reading.patient_id,
                reading_id=reading.id,
                vital_type=vital_type,
                severity=severity,
                title=f"{direction} {label}",
                message=f"{label} reading of {value:g}{unit} is outside the normal range ({low}-{high}{unit}).",
            )
            db.session.add(alert)
            new_alerts.append(alert)

    reading.ecg_status = "Irregular" if any(a.vital_type == "heart_rate" for a in new_alerts) else "Normal"

    return new_alerts