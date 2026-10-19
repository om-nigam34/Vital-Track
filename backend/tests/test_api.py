"""
API tests. Run from the backend/ folder:

    python -m unittest discover -s tests -v

Each test gets its own throwaway database, so your real data is never touched.
"""

import os
import sys
import tempfile
import unittest
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import jwt  # noqa: E402

from app import create_app  # noqa: E402
from extensions import db  # noqa: E402
from models import Alert, Device, Patient, User, VitalReading, utcnow  # noqa: E402

DEVICE_KEY = "test-device-key-1234567890abcdef"
GOOD = {"heart_rate": 75, "spo2": 98, "temperature": 36.6}


class ApiTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db_path = os.path.join(self.tmp.name, "test.db").replace("\\", "/")
        self.app = create_app({
            "TESTING": True,
            "SECRET_KEY": "unit-test-secret-key-that-is-long-enough-123456",
            "SQLALCHEMY_DATABASE_URI": "sqlite:///" + db_path,
        })
        self.client = self.app.test_client()

        with self.app.app_context():
            user = User(username="admin", full_name="Admin", role="admin")
            user.set_password("admin123")
            patient = Patient(patient_code="VT-1001", name="John Doe", age=28,
                              gender="Male", ward="General", status="active")
            db.session.add_all([user, patient])
            db.session.flush()
            db.session.add(Device(device_uid="ESP32-DEMO-01", patient_id=patient.id, api_key=DEVICE_KEY))
            db.session.commit()
            self.patient_id = patient.id

        self.token = self.login()

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.engine.dispose()
        self.tmp.cleanup()

    # helpers
    def login(self, username="admin", password="admin123"):
        res = self.client.post("/api/auth/login", json={"username": username, "password": password})
        return res.get_json().get("token") if res.status_code == 200 else None

    @property
    def auth(self):
        return {"Authorization": f"Bearer {self.token}"}

    def ingest(self, payload=None, key=DEVICE_KEY):
        return self.client.post("/api/vitals/ingest", json=payload or GOOD, headers={"X-Device-Key": key})


class AuthTests(ApiTestCase):
    def test_token_works_on_the_very_next_request(self):
        # Regression: with PyJWT 2.10+ a numeric "sub" made every request after login return 401
        self.assertIsNotNone(self.token)
        res = self.client.get("/api/patients", headers=self.auth)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.client.get("/api/auth/me", headers=self.auth).get_json()["user"]["username"], "admin")

    def test_token_subject_is_a_string(self):
        payload = jwt.decode(self.token, options={"verify_signature": False})
        self.assertIsInstance(payload["sub"], str)

    def test_wrong_password_and_unknown_user(self):
        self.assertEqual(self.client.post("/api/auth/login", json={"username": "admin", "password": "nope"}).status_code, 401)
        self.assertEqual(self.client.post("/api/auth/login", json={"username": "ghost", "password": "x"}).status_code, 401)
        self.assertEqual(self.client.post("/api/auth/login", json={}).status_code, 400)

    def test_username_is_case_insensitive(self):
        self.assertIsNotNone(self.login(username="ADMIN"))

    def test_login_is_locked_after_repeated_failures(self):
        for _ in range(self.app.config["LOGIN_MAX_FAILURES"]):
            self.client.post("/api/auth/login", json={"username": "admin", "password": "bad"})
        res = self.client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        self.assertEqual(res.status_code, 429)

    def test_protected_routes_reject_missing_bad_and_expired_tokens(self):
        self.assertEqual(self.client.get("/api/patients").status_code, 401)
        self.assertEqual(self.client.get("/api/patients", headers={"Authorization": "Bearer garbage"}).status_code, 401)

        with self.app.app_context():
            expired = jwt.encode(
                {"sub": "1", "exp": utcnow() - timedelta(minutes=1)},
                self.app.config["SECRET_KEY"], algorithm="HS256",
            )
        res = self.client.get("/api/patients", headers={"Authorization": f"Bearer {expired}"})
        self.assertEqual(res.status_code, 401)
        self.assertIn("expired", res.get_json()["error"].lower())

    def test_register_rules(self):
        ok = self.client.post("/api/auth/register", json={"username": "nurse.priya", "password": "longenough1", "full_name": "Priya"})
        self.assertEqual(ok.status_code, 201)
        self.assertEqual(self.client.post("/api/auth/register", json={"username": "Nurse.Priya", "password": "longenough1"}).status_code, 409)
        self.assertEqual(self.client.post("/api/auth/register", json={"username": "ab", "password": "longenough1"}).status_code, 400)
        self.assertEqual(self.client.post("/api/auth/register", json={"username": "okname", "password": "short"}).status_code, 400)

    def test_register_can_be_disabled(self):
        self.app.config["ALLOW_REGISTRATION"] = False
        res = self.client.post("/api/auth/register", json={"username": "someone", "password": "longenough1"})
        self.assertEqual(res.status_code, 403)
        self.assertFalse(self.client.get("/api/meta").get_json()["registration_enabled"])


class PatientTests(ApiTestCase):
    def test_create_update_list_delete(self):
        res = self.client.post("/api/patients", headers=self.auth, json={"name": " Asha Verma ", "age": "34", "gender": "Female", "ward": "ICU"})
        self.assertEqual(res.status_code, 201)
        patient = res.get_json()["patient"]
        self.assertEqual(patient["name"], "Asha Verma")
        self.assertEqual(patient["age"], 34)
        self.assertEqual(patient["patient_code"], "VT-1002")

        res = self.client.put(f"/api/patients/{patient['id']}", headers=self.auth, json={"status": "discharged"})
        self.assertEqual(res.get_json()["patient"]["status"], "discharged")

        listed = self.client.get("/api/patients?status=discharged", headers=self.auth).get_json()["patients"]
        self.assertEqual([p["name"] for p in listed], ["Asha Verma"])

        self.assertEqual(self.client.delete(f"/api/patients/{patient['id']}", headers=self.auth).status_code, 200)
        self.assertEqual(self.client.get(f"/api/patients/{patient['id']}", headers=self.auth).status_code, 404)

    def test_codes_never_repeat_after_a_delete(self):
        first = self.client.post("/api/patients", headers=self.auth, json={"name": "A"}).get_json()["patient"]
        second = self.client.post("/api/patients", headers=self.auth, json={"name": "B"}).get_json()["patient"]
        self.client.delete(f"/api/patients/{first['id']}", headers=self.auth)
        third = self.client.post("/api/patients", headers=self.auth, json={"name": "C"}).get_json()["patient"]
        self.assertEqual([first["patient_code"], second["patient_code"], third["patient_code"]], ["VT-1002", "VT-1003", "VT-1004"])

    def test_validation(self):
        bad = [
            {},
            {"name": "   "},
            {"name": "x" * 129},
            {"name": "Ok", "age": 200},
            {"name": "Ok", "age": "abc"},
            {"name": "Ok", "gender": "Robot"},
            {"name": "Ok", "status": "gone"},
        ]
        for body in bad:
            res = self.client.post("/api/patients", headers=self.auth, json=body)
            self.assertEqual(res.status_code, 400, body)

    def test_deleting_a_patient_removes_their_data_but_keeps_the_device(self):
        self.ingest({"heart_rate": 150, "spo2": 98, "temperature": 36.6})
        with self.app.app_context():
            self.assertGreater(VitalReading.query.count(), 0)
            self.assertGreater(Alert.query.count(), 0)

        self.assertEqual(self.client.delete(f"/api/patients/{self.patient_id}", headers=self.auth).status_code, 200)

        with self.app.app_context():
            self.assertEqual(VitalReading.query.count(), 0)
            self.assertEqual(Alert.query.count(), 0)
            device = Device.query.filter_by(device_uid="ESP32-DEMO-01").first()
            self.assertIsNotNone(device)
            self.assertIsNone(device.patient_id)


class IngestTests(ApiTestCase):
    def test_good_reading_is_stored_and_shows_on_the_patient(self):
        res = self.ingest(dict(GOOD, wifi_signal=80, battery_level=90))
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.get_json()["alerts_created"], [])

        patient = self.client.get(f"/api/patients/{self.patient_id}", headers=self.auth).get_json()["patient"]
        self.assertEqual(patient["latest_reading"]["heart_rate"], 75)
        self.assertEqual(patient["latest_reading"]["ecg_status"], "Normal")
        self.assertTrue(patient["device"]["connected"])
        self.assertEqual(patient["device"]["wifi_signal"], 80)
        self.assertEqual(patient["device"]["battery_level"], 90)

    def test_device_key_checks(self):
        self.assertEqual(self.client.post("/api/vitals/ingest", json=GOOD).status_code, 401)
        self.assertEqual(self.ingest(key="wrong").status_code, 403)
        # key inside the JSON body also works (older firmware)
        res = self.client.post("/api/vitals/ingest", json=dict(GOOD, api_key=DEVICE_KEY))
        self.assertEqual(res.status_code, 201)

    def test_unassigned_device_is_refused(self):
        with self.app.app_context():
            db.session.add(Device(device_uid="SPARE", api_key="spare-key"))
            db.session.commit()
        self.assertEqual(self.ingest(key="spare-key").status_code, 409)

    def test_sensor_errors_are_rejected(self):
        bad = [
            dict(GOOD, temperature=-127),          # unplugged DS18B20
            dict(GOOD, heart_rate=0),
            dict(GOOD, spo2=120),
            dict(GOOD, heart_rate="fast"),
            dict(GOOD, temperature=float("nan")),
            {"heart_rate": 75, "spo2": 98},        # missing temperature
        ]
        for payload in bad:
            # NaN is not valid JSON, so send it as a raw body for that case
            if payload.get("temperature") != payload.get("temperature"):
                res = self.client.post("/api/vitals/ingest", data='{"heart_rate":75,"spo2":98,"temperature":NaN}',
                                       content_type="application/json", headers={"X-Device-Key": DEVICE_KEY})
            else:
                res = self.ingest(payload)
            self.assertEqual(res.status_code, 400, payload)
        res = self.client.post("/api/vitals/ingest", data="not json", content_type="text/plain", headers={"X-Device-Key": DEVICE_KEY})
        self.assertEqual(res.status_code, 400)
        with self.app.app_context():
            self.assertEqual(VitalReading.query.count(), 0)

    def test_out_of_range_creates_alerts_with_severity(self):
        res = self.ingest({"heart_rate": 150, "spo2": 90, "temperature": 36.6}).get_json()
        alerts = {a["vital_type"]: a for a in res["alerts_created"]}
        self.assertEqual(set(alerts), {"heart_rate", "spo2"})
        self.assertEqual(alerts["heart_rate"]["title"], "High Heart Rate")
        self.assertEqual(alerts["heart_rate"]["severity"], "critical")
        self.assertEqual(alerts["spo2"]["title"], "Low SpO2")
        self.assertIn("150 BPM", alerts["heart_rate"]["message"])
        self.assertEqual(res["reading"]["ecg_status"], "Irregular")

    def test_same_problem_does_not_create_an_alert_every_reading(self):
        first = self.ingest({"heart_rate": 130, "spo2": 98, "temperature": 36.6}).get_json()
        second = self.ingest({"heart_rate": 131, "spo2": 98, "temperature": 36.6}).get_json()
        self.assertEqual(len(first["alerts_created"]), 1)
        self.assertEqual(second["alerts_created"], [])
        # ...but the reading itself is still flagged, even while the alert is in cooldown
        self.assertEqual(second["reading"]["ecg_status"], "Irregular")
        with self.app.app_context():
            self.assertEqual(Alert.query.count(), 1)

    def test_alert_is_raised_again_after_the_cooldown(self):
        self.app.config["ALERT_COOLDOWN_SECONDS"] = 0
        self.ingest({"heart_rate": 130, "spo2": 98, "temperature": 36.6})
        self.ingest({"heart_rate": 131, "spo2": 98, "temperature": 36.6})
        with self.app.app_context():
            self.assertEqual(Alert.query.count(), 2)


class DataTests(ApiTestCase):
    def test_timestamps_are_utc_with_z_suffix(self):
        self.ingest({"heart_rate": 130, "spo2": 98, "temperature": 36.6})
        patient = self.client.get(f"/api/patients/{self.patient_id}", headers=self.auth).get_json()["patient"]
        self.assertTrue(patient["latest_reading"]["recorded_at"].endswith("Z"))
        self.assertTrue(patient["device"]["last_seen"].endswith("Z"))
        alert = self.client.get("/api/alerts", headers=self.auth).get_json()["alerts"][0]
        self.assertTrue(alert["created_at"].endswith("Z"))
        self.assertTrue(patient["created_at"].endswith("Z"))

    def test_history_returns_recent_readings_and_limits_points(self):
        for i in range(60):
            self.ingest({"heart_rate": 70 + (i % 5), "spo2": 98, "temperature": 36.6})
        res = self.client.get(f"/api/vitals/history?patient_id={self.patient_id}&minutes=60", headers=self.auth).get_json()
        self.assertEqual(res["total"], 60)
        self.assertEqual(len(res["readings"]), 60)

        small = self.client.get(f"/api/vitals/history?patient_id={self.patient_id}&minutes=60&max_points=20", headers=self.auth).get_json()
        self.assertLessEqual(len(small["readings"]), 21)
        self.assertEqual(small["readings"][-1]["id"], res["readings"][-1]["id"])  # newest point kept

        self.assertEqual(self.client.get("/api/vitals/history", headers=self.auth).status_code, 400)

    def test_alerts_filter_and_mark_read(self):
        self.ingest({"heart_rate": 130, "spo2": 90, "temperature": 36.6})
        data = self.client.get("/api/alerts?unread_only=1", headers=self.auth).get_json()
        self.assertEqual(data["unread_count"], 2)
        alert_id = data["alerts"][0]["id"]

        self.client.post(f"/api/alerts/{alert_id}/read", headers=self.auth)
        self.assertEqual(self.client.get("/api/alerts", headers=self.auth).get_json()["unread_count"], 1)

        self.client.post(f"/api/alerts/read-all?patient_id={self.patient_id}", headers=self.auth)
        self.assertEqual(self.client.get("/api/alerts", headers=self.auth).get_json()["unread_count"], 0)


class DeviceTests(ApiTestCase):
    def test_register_returns_the_key_once_and_never_lists_it(self):
        res = self.client.post("/api/devices", headers=self.auth, json={"device_uid": "ESP32-ICU-02"})
        self.assertEqual(res.status_code, 201)
        body = res.get_json()
        self.assertEqual(len(body["api_key"]), 32)
        listed = self.client.get("/api/devices", headers=self.auth).get_json()["devices"]
        self.assertTrue(all("api_key" not in d for d in listed))
        self.assertEqual(self.client.post("/api/devices", headers=self.auth, json={"device_uid": "ESP32-ICU-02"}).status_code, 409)
        self.assertEqual(self.client.post("/api/devices", headers=self.auth, json={"device_uid": "bad id!"}).status_code, 400)

    def test_one_device_per_patient(self):
        res = self.client.post("/api/devices", headers=self.auth, json={"device_uid": "SECOND", "patient_id": self.patient_id})
        self.assertEqual(res.status_code, 409)

        second = self.client.post("/api/devices", headers=self.auth, json={"device_uid": "SECOND"}).get_json()["device"]
        res = self.client.put(f"/api/devices/{second['id']}/assign", headers=self.auth, json={"patient_id": self.patient_id})
        self.assertEqual(res.status_code, 409)

    def test_assign_unassign_and_delete_keeps_readings(self):
        self.ingest()
        with self.app.app_context():
            device_id = Device.query.filter_by(device_uid="ESP32-DEMO-01").first().id

        res = self.client.put(f"/api/devices/{device_id}/assign", headers=self.auth, json={"patient_id": None})
        self.assertIsNone(res.get_json()["device"]["patient_id"])
        self.assertEqual(self.client.put(f"/api/devices/{device_id}/assign", headers=self.auth, json={"patient_id": 9999}).status_code, 400)

        self.assertEqual(self.client.delete(f"/api/devices/{device_id}", headers=self.auth).status_code, 200)
        with self.app.app_context():
            self.assertEqual(VitalReading.query.count(), 1)
            self.assertIsNone(VitalReading.query.first().device_id)


class MiscTests(ApiTestCase):
    def test_api_errors_are_json(self):
        res = self.client.get("/api/does-not-exist")
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.get_json(), {"error": "Not found"})
        self.assertEqual(self.client.delete("/api/health").status_code, 405)
        self.assertEqual(self.client.get("/api/health").get_json()["status"], "ok")

    def test_pages_are_served(self):
        for page in ("/", "/index.html", "/dashboard.html", "/patients.html", "/alerts.html", "/js/api.js", "/css/style.css"):
            self.assertEqual(self.client.get(page).status_code, 200, page)


if __name__ == "__main__":
    unittest.main()