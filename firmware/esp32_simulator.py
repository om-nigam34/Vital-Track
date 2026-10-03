import argparse
import os
import random
import time

import requests

DEFAULT_URL = "http://localhost:5000"
KEY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "device_key.txt")

# (heart_rate_range, spo2_range, temperature_range) per scenario, all realistic-ish
SCENARIOS = {
    "normal": {"hr": (62, 95), "spo2": (96, 99), "temp": (36.3, 37.0)},
    "fever": {"hr": (85, 105), "spo2": (94, 98), "temp": (38.0, 39.2)},
    "tachycardia": {"hr": (105, 135), "spo2": (93, 97), "temp": (36.5, 37.3)},
    "low_spo2": {"hr": (80, 100), "spo2": (86, 93), "temp": (36.4, 37.1)},
}


def read_api_key(cli_key):
    if cli_key:
        return cli_key
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE) as f:
            return f.read().strip()
    raise SystemExit(
        "No device API key found. Run `python seed.py` in backend/ first, "
        "or pass --key <your-device-api-key>."
    )


def next_reading(scenario, previous):
    ranges = SCENARIOS[scenario]

    def walk(prev, bounds, max_step):
        lo, hi = bounds
        if prev is None:
            prev = (lo + hi) / 2
        value = prev + random.uniform(-max_step, max_step)
        return round(min(max(value, lo), hi), 1)

    hr = walk(previous.get("heart_rate"), ranges["hr"], 3)
    spo2 = walk(previous.get("spo2"), ranges["spo2"], 1)
    temp = walk(previous.get("temperature"), ranges["temp"], 0.1)
    return {"heart_rate": hr, "spo2": spo2, "temperature": temp}


def main():
    parser = argparse.ArgumentParser(description="Simulate an ESP32 VitalTrack device")
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--key", default=None)
    parser.add_argument("--interval", type=float, default=3.0)
    parser.add_argument("--scenario", choices=SCENARIOS.keys(), default="normal")
    parser.add_argument("--count", type=int, default=0, help="stop after N readings (0 = run forever)")
    args = parser.parse_args()

    api_key = read_api_key(args.key)
    endpoint = f"{args.url.rstrip('/')}/api/vitals/ingest"

    print(f"VitalTrack ESP32 simulator -> {endpoint}")
    print(f"Scenario: {args.scenario} | interval: {args.interval}s | key: {api_key[:8]}...")

    reading = {}
    sent = 0
    while True:
        reading = next_reading(args.scenario, reading)
        payload = {
            **reading,
            "api_key": api_key,
            "wifi_signal": random.randint(70, 95),
            "battery_level": max(20, 100 - sent // 20),
        }
        try:
            resp = requests.post(
                endpoint,
                json=payload,
                headers={"X-Device-Key": api_key},
                timeout=5,
            )
            status = "OK" if resp.ok else f"FAILED ({resp.status_code}: {resp.text[:120]})"
            print(f"[{sent + 1}] HR={reading['heart_rate']} SpO2={reading['spo2']} "
                  f"Temp={reading['temperature']} -> {status}")
        except requests.RequestException as exc:
            print(f"[{sent + 1}] Could not reach server: {exc}")

        sent += 1
        if args.count and sent >= args.count:
            break
        time.sleep(args.interval)


if __name__ == "__main__":
    main()