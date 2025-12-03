# rpis_control.py
import time
import json
import yaml
import socket
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from ping3 import ping  # pip install ping3
import paho.mqtt.client as mqtt

BROKER_HOST = "10.128.48.5"
BROKER_PORT = 1883
TOPIC_PING   = "rpi/ping"

# Same path your backend already uses for hosts.yaml
HOSTS_PATH = "/home/pi/TechtileDashboard/dashboard/public/hosts.yaml"

PING_TIMEOUT_S = 1.2
INTERVAL_S     = 30
MAX_WORKERS    = 64

def load_hosts(path: str):
    """
    Expects a structure like:
      all:
        hosts:
          A01:
            ansible_host: rpi-a01.local
            midspan: midspan-001
            poe-port: 1
    Returns dict: { "A01": {"ansible_host":"rpi-a01.local", ...}, ... }
    """
    with open(path, "r") as f:
        data = yaml.safe_load(f) or {}
    return (data.get("all", {}).get("hosts") or {})

def resolve_target(rpi_id: str, host_entry: dict) -> str:
    # Prefer explicit ansible_host; fall back to mDNS name
    host = host_entry.get("ansible_host")
    return host if host else f"rpi-{rpi_id}.local"

def ping_once(target: str) -> float:
    """
    Returns RTT (seconds) if alive, or 0 / None if not.
    """
    try:
        # attempt to resolve, but don't crash if it fails
        try:
            socket.gethostbyname(target)
        except Exception:
            pass
        rtt = ping(target, timeout=PING_TIMEOUT_S)
        return rtt if isinstance(rtt, (int, float)) and rtt > 0 else 0.0
    except Exception:
        return 0.0

def publish_json(client: mqtt.Client, topic: str, payload: dict):
    client.publish(topic, json.dumps(payload))

def main():
    # MQTT
    client = mqtt.Client()
    client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)
    client.loop_start()

    while True:
        try:
            hosts = load_hosts(HOSTS_PATH)
            ids = list(hosts.keys())

            results = []
            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
                futures = {
                    ex.submit(ping_once, resolve_target(rpi_id, hosts[rpi_id])): rpi_id
                    for rpi_id in ids
                }
                for fut in as_completed(futures):
                    rpi_id = futures[fut]
                    rtt = float(fut.result() or 0.0)
                    status = "working" if rtt > 0 else "faulty"
                    results.append({"id": rpi_id, "status": status, "rtt_ms": round(rtt * 1000, 2) if rtt else None})

            # Publish each result to rpi/ping (consumed by rpi_db.py and stored as table rpi_ping)
            for row in results:
                publish_json(client, TOPIC_PING, row)

        except Exception as e:
            print("[rpis_control] loop error:", e)

        time.sleep(INTERVAL_S)

if __name__ == "__main__":
    main()
