# VitalTrack

A patient vitals monitor. An ESP32 reads heart rate, SpO2 and body temperature, sends them over Wi-Fi to a Flask server, which stores them in SQLite and shows them on a live dashboard with alerts for abnormal readings.

## What it does

- Login with username and password
- Live dashboard: heart rate, SpO2, temperature, trend charts, ECG-style waveform
- Alerts when a value leaves its normal range (each alert is raised once per minute, not on every reading)
- Add, edit and delete patients; register ESP32 devices and assign them to patients
- A simulator, so everything works before the hardware is connected

## Tech stack

| Part | Technology |
|---|---|
| Microcontroller | ESP32 |
| Sensors | MAX30100 (heart rate, SpO2), DS18B20 (temperature) |
| Backend | Python, Flask, SQLAlchemy, PyJWT |
| Database | SQLite |
| Dashboard | HTML, CSS, JavaScript (Chart.js, included in the repo) |
| Communication | Wi-Fi, HTTP + JSON |

```
[Sensors] -> [ESP32] --Wi-Fi/HTTP--> [Flask server] -> [SQLite]
                                           |
                                           v
                                    [Web dashboard]
```

## Run it

You need Python 3.10 or newer.

```
git clone https://github.com/om-nigam34/Vital-Track.git
cd Vital-Track
pip install -r requirements.txt

cd backend
python seed.py      # once: creates the demo login, patient and device
python app.py       # starts the server
```

Open http://localhost:5000 and sign in with `admin` / `admin123`.

To see live data without any hardware, open a second terminal:

```
cd firmware
python esp32_simulator.py --scenario mixed
```

`mixed` goes through normal, fever, fast heart rate and low SpO2, so alerts show up on their own.
Other scenarios: `normal`, `fever`, `tachycardia`, `low_spo2`.

Stop either program with `Ctrl+C`.

## Using the real ESP32

1. Wire the sensors as described at the top of `firmware/esp32_firmware.ino`.
2. Copy `firmware/secrets.h.example` to `firmware/secrets.h` and fill in your Wi-Fi name, password, device API key, and your computer's address. `secrets.h` is git-ignored, so it stays off GitHub.
3. When the server starts it prints `ESP32 server address: http://192.168.x.x:5000`. Use that address (plus `/api/vitals/ingest`) as `SERVER_URL`. Do not use `localhost`.
4. The computer and the ESP32 must be on the same Wi-Fi. If nothing arrives, check that Windows Firewall allows Python on private networks.
5. Flash it and open the Serial Monitor. It prints `Sent OK` for each reading, and tells you if the finger is missing, the key is wrong or the server cannot be reached.

## Project layout

```
backend/     Flask server: app.py, models.py, routes/, utils/, seed.py, tests/
dashboard/   The website: HTML pages, css/, js/ (js/vendor has Chart.js)
database/    schema.sql (the SQLite file is created when you run the app)
firmware/    esp32_firmware.ino, secrets.h.example, esp32_simulator.py
```

## Settings

Everything has a working default. To change something, set an environment variable before `python app.py`.

| Variable | Effect |
|---|---|
| `VITALTRACK_DEBUG=1` | Auto-restart when you edit Python files, and detailed error pages. Development only. |
| `VITALTRACK_PORT=8000` | Use another port |
| `VITALTRACK_ALLOW_REGISTRATION=0` | Hide "Create an account" and block new sign-ups |
| `VITALTRACK_SECRET_KEY=...` | Your own login-token key. If unset, one is generated and saved in `database/.secret_key`. |

PowerShell example: `$env:VITALTRACK_DEBUG = "1"; python app.py`

Normal ranges, the alert cooldown and the sensor sanity limits are in `backend/config.py`.

## Tests

```
cd backend
python -m unittest discover -s tests -v
```

The tests use a temporary database, so your data is not touched.

## Troubleshooting

- **Dashboard shows `--` and "Waiting for data"**: nothing is sending readings. Start the simulator, and check that its output says `OK`.
- **Simulator says "key is wrong"**: run `python seed.py` again, or pass the key with `--key`.
- **Simulator says "device is not assigned"**: assign the device to a patient on the Patients page.
- **Signed out right after logging in**: run `pip install -r requirements.txt` again, then restart the server.
- **Forgot the demo password**: delete `database/vitaltrack.db` and run `python seed.py` (this also deletes your patients and readings).

## Notes

- The ECG waveform is an illustration: the MAX30100 and DS18B20 cannot measure ECG, so the line is drawn from the live heart rate. A real ECG needs a sensor such as the AD8232.
- "Pause Live View" only pauses the page, it does not change the device.
- This is a college project, not a medical device.

## Author

**Om Nigam**