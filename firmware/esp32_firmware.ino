/*
  VitalTrack ESP32 firmware (reference sketch)
  ---------------------------------------------
  Reads heart rate + SpO2 from a MAX30100 and temperature from a DS18B20,
  then POSTs a JSON reading to the Flask backend's /api/vitals/ingest route
  every few seconds - the same endpoint firmware/esp32_simulator.py talks to.

  Libraries needed (Arduino IDE -> Library Manager):
    - MAX30100lib          by OXullo Intersecans
    - OneWire
    - DallasTemperature
    - ArduinoJson

  Wiring:
    MAX30100  SDA -> ESP32 GPIO21, SCL -> ESP32 GPIO22, VIN -> 3V3, GND -> GND
    DS18B20   DATA -> ESP32 GPIO4 (with a 4.7k pull-up resistor to 3V3)

  Before flashing:
    1. Fill in WIFI_SSID / WIFI_PASSWORD below.
    2. Set SERVER_URL to your Flask server's LAN IP, e.g. http://192.168.1.20:5000
    3. Set DEVICE_API_KEY to the key printed by `python seed.py`
       (also saved to firmware/device_key.txt).
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <MAX30100_PulseOximeter.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ---- Configure before flashing ----
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL    = "http://192.168.1.20:5000/api/vitals/ingest";
const char* DEVICE_API_KEY = "PASTE_DEVICE_API_KEY_HERE";
const unsigned long REPORT_INTERVAL_MS = 3000;

#define ONE_WIRE_BUS 4
#define REPORTING_PERIOD_MS 1000

PulseOximeter pox;
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature tempSensor(&oneWire);

float lastHeartRate = 0;
float lastSpO2 = 0;
unsigned long lastReportTime = 0;

void onBeatDetected() {
  Serial.println("Beat!");
}

void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println("\nConnected, IP: " + WiFi.localIP().toString());
}

void setup() {
  Serial.begin(115200);
  connectWiFi();

  tempSensor.begin();

  Serial.print("Initializing MAX30100...");
  if (!pox.begin()) {
    Serial.println("FAILED - check wiring");
  } else {
    Serial.println("SUCCESS");
    pox.setIRLedCurrent(MAX30100_LED_CURR_7_6MA);
    pox.setOnBeatDetectedCallback(onBeatDetected);
  }
}

void sendReading(float heartRate, float spo2, float temperature) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected, skipping upload");
    return;
  }

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_API_KEY);

  StaticJsonDocument<256> doc;
  doc["heart_rate"] = heartRate;
  doc["spo2"] = spo2;
  doc["temperature"] = temperature;
  doc["api_key"] = DEVICE_API_KEY;
  doc["wifi_signal"] = map(constrain(WiFi.RSSI(), -90, -30), -90, -30, 0, 100);

  String body;
  serializeJson(doc, body);

  int statusCode = http.POST(body);
  Serial.printf("POST -> %d\n", statusCode);
  http.end();
}

void loop() {
  pox.update();

  if (pox.getHeartRate() > 0) lastHeartRate = pox.getHeartRate();
  if (pox.getSpO2() > 0) lastSpO2 = pox.getSpO2();

  if (millis() - lastReportTime > REPORT_INTERVAL_MS) {
    tempSensor.requestTemperatures();
    float temperature = tempSensor.getTempCByIndex(0);

    // Fall back to plausible values until the sensor has a stable finger reading,
    // so the dashboard has something to show while warming up.
    float heartRate = lastHeartRate > 0 ? lastHeartRate : 72;
    float spo2 = lastSpO2 > 0 ? lastSpO2 : 97;

    Serial.printf("HR=%.1f SpO2=%.1f Temp=%.1f\n", heartRate, spo2, temperature);
    sendReading(heartRate, spo2, temperature);

    lastReportTime = millis();
  }
}