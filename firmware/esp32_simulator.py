# ESP32 simulator - sends fake but realistic readings, so you can build and demo the
# dashboard before the real hardware is wired up. It talks to the server exactly like
# the real firmware does.

# Quick start (server must be running and `python seed.py` must have been run once):
#     cd firmware
#     python esp32_simulator.py

# Options:
#     --scenario  normal | fever | tachycardia | low_spo2 | mixed   (default: normal)
#                 "mixed" cycles through all of them so alerts appear on their own
#     --interval  seconds between readings (default: 3)
#     --count     stop after N readings (default: keep going until Ctrl+C)
#     --url       server address (default: http://localhost:5000)
#     --key       device API key (default: read from firmware/device_key.txt)

import argparse
import os
import random
import sys
import time

import requests

DEFAULT_URL = "http://localhost:5000"
KEY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "device_key.txt")

SCENARIOS = {
    "normal": {"hr": (62, 95), "spo2": (96, 99), "temp": (36.3, 37.0)},
    "fever": {"hr": (85, 105), "spo2": (94, 98), "temp": (38.0, 39.2)},
    "tachycardia": {"hr": (105, 135), "spo2": (93, 97), "temp": (36.5, 37.3)},
    "low_spo2": {"hr": (80, 100), "spo2": (86, 93), "temp": (36.4, 37.1)},
}
MIXED_ORDER = ["normal", "fever", "normal", "tachycardia", "normal", "low_spo2"]
MIXED_STEP = 12  # readings per scenario in "mixed" mode


def read_api_key(cli_key):
    if cli_key:
        return cli_key.strip()
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, encoding="utf-8") as f:
            key = f.read().strip()
        if key:
            return key
    sys.exit(
        "No device API key found.\n"
        "  1. Start the server:   cd backend && python app.py\n"
        "  2. Create demo data:   cd backend && python seed.py   (saves the key for you)\n"
        "  or pass a key:         python esp32_simulator.py --key YOUR_KEY"
    )


def scenario_for(name, sent):
    if name != "mixed":
        return name
    return MIXED_ORDER[(sent // MIXED_STEP) % len(MIXED_ORDER)]


def next_reading(scenario, previous):
    """Small random walk so the charts look like a live signal and not like noise."""
    ranges = SCENARIOS[scenario]

    def walk(prev, bounds, max_step):
        low, high = bounds
        if prev is None or not low - max_step * 3 <= prev <= high + max_step * 3:
            prev = (low + high) / 2   # first reading, or the scenario just changed
        value = prev + random.uniform(-max_step, max_step)
        return round(min(max(value, low), high), 1)

    return {
        "heart_rate": walk(previous.get("heart_rate"), ranges["hr"], 3),
        "spo2": walk(previous.get("spo2"), ranges["spo2"], 1),
        "temperature": walk(previous.get("temperature"), ranges["temp"], 0.1),
    }


def explain_failure(resp):
    """Turn an error response into a plain-English next step."""
    try:
        detail = resp.json().get("error", resp.text[:120])
    except ValueError:
        detail = resp.text[:120]
    hints = {
        401: "the device key is missing",
        403: "the device key is wrong - run `python seed.py` again, or check --key",
        409: "this device is not assigned to a patient - assign it on the Patients page",
        400: "the server rejected the values",
    }
    return f"FAILED ({resp.status_code}): {detail}" + (f"  -> {hints[resp.status_code]}" if resp.status_code in hints else "")


def main():
    parser = argparse.ArgumentParser(description="Simulate an ESP32 VitalTrack device")
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--key", default=None)
    parser.add_argument("--interval", type=float, default=3.0)
    parser.add_argument("--scenario", choices=[*SCENARIOS, "mixed"], default="normal")
    parser.add_argument("--count", type=int, default=0, help="stop after N readings (0 = run until Ctrl+C)")
    args = parser.parse_args()

    api_key = read_api_key(args.key)
    base = args.url.rstrip("/")
    endpoint = f"{base}/api/vitals/ingest"

    print(f"VitalTrack ESP32 simulator -> {endpoint}")
    print(f"Scenario: {args.scenario} | every {args.interval}s | key: {api_key[:6]}... | Ctrl+C to stop\n")

    reading, sent, failures_in_a_row = {}, 0, 0
    try:
        while True:
            scenario = scenario_for(args.scenario, sent)
            reading = next_reading(scenario, reading)
            payload = {
                **reading,
                "wifi_signal": random.randint(70, 95),
                "battery_level": max(20, 100 - sent // 40),
            }
            label = f"[{sent + 1}] {scenario:<11} HR={reading['heart_rate']:<5} SpO2={reading['spo2']:<5} Temp={reading['temperature']:<5}"
            try:
                resp = requests.post(endpoint, json=payload, headers={"X-Device-Key": api_key}, timeout=5)
                if resp.ok:
                    failures_in_a_row = 0
                    new_alerts = len(resp.json().get("alerts_created", []))
                    print(f"{label} -> OK" + (f"  ({new_alerts} new alert)" if new_alerts else ""))
                else:
                    failures_in_a_row += 1
                    print(f"{label} -> {explain_failure(resp)}")
                    if resp.status_code in (401, 403) and failures_in_a_row >= 3:
                        sys.exit("\nStopping: the server keeps refusing this device key.")
            except requests.RequestException:
                failures_in_a_row += 1
                print(f"{label} -> cannot reach {base}  (is `python app.py` running?)")

            sent += 1
            if args.count and sent >= args.count:
                break
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print(f"\nStopped after {sent} readings.")


if __name__ == "__main__":
    main()