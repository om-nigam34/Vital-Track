# VitalTrack

VitalTrack is an IoT-based patient vitals monitoring system that captures real-time health data — such as heart rate, SpO2, and temperature — using a microcontroller connected to multiple sensors. The data is sent to a backend, stored in a database, and visualized through a dashboard, enabling continuous, remote tracking of a patient's vital signs.

## Features

- Real-time capture of vital signs -> heart rate, SpO2, body temperature
- Wireless data transmission from microcontroller to backend server
- Persistent storage of historical vitals data
- Live web dashboard for continuous monitoring
- Alert/threshold system for abnormal readings

## Tech Stack

| Layer | Technology |
|---|---|
| Microcontroller | ESP32 |
| Sensors | MAX30100 for HR/SpO2, DS18B20 for temperature |
| Backend | Flask |
| Database | SQLite |
| Frontend/Dashboard | HTML/CSS/JS, |
| Communication | Wi-Fi / HTTP |

## System Architecture

```
[Sensors] --> [ESP32] --(Wi-Fi/HTTP)--> [Flask Backend] --> [SQLite DB]
                                                |
                                                v
                                        [Web Dashboard]
```

## Project Structure

```
VitalTrack/
├── firmware/           # ESP32 microcontroller code
├── backend/             # Flask server, API routes
├── database/             # SQLite schema/models
├── dashboard/            # Frontend dashboard files
├── requirements.txt
└── README.md
```

## Getting Started

### Prerequisites
- Python
- ESP32 board + Arduino IDE / PlatformIO
- Required sensors

### Installation

1. Clone the repository
   ```bash
   git clone https://github.com/om-nigam34/VitalTrack.git
   cd VitalTrack
   ```

2. Install backend dependencies
   ```bash
   pip install -r requirements.txt
   ```

3. Flash the firmware to your ESP32 (update Wi-Fi credentials and server endpoint in the firmware code first)

4. Run the backend server
   ```bash
   python app.py
   ```

5. Open the dashboard in your browser at `http://localhost:port`

## How It Works

1. Sensors connected to the ESP32 continuously read vital sign data.
2. The ESP32 sends this data over Wi-Fi to the Flask backend via HTTP requests.
3. The backend validates and stores incoming data in the SQLite database.
4. The dashboard fetches and displays this data in real time, allowing remote monitoring of the patient's condition.


## Author

**Om Nigam**
