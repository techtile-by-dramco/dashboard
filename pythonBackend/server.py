from flask import Flask, request, jsonify
from flask_cors import CORS
from flask import make_response, request
from flask_caching import Cache
import os
from numbers import Number
import json
import socket
import yaml
import sqlite3
import time
import uuid
import threading
from ping3 import ping
from mqtt_config import client  # Ensure mqtt_config.py defines and connects the MQTT client
import re
DB_PATH = "/home/pi/rpi_data.db"  # must match rpi_db.py
SAFE_TABLE = re.compile(r"^[A-Za-z0-9_]+$")
SAFE_COL   = re.compile(r"^[A-Za-z0-9_]+$")

app = Flask(__name__)

CORS(
    app,
    resources={r"/*": {"origins": "*"}},
    allow_headers=["Content-Type"],
    methods=["GET", "POST", "OPTIONS"]
)

@app.route('/', defaults={'path': ''}, methods=['OPTIONS'])
@app.route('/<path:path>', methods=['OPTIONS'])
def catch_all_options(path):
    resp = make_response("", 204)
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp

cache = Cache(app, config={'CACHE_TYPE': 'simple'})

STATUS_FILE_PATH = "status.json"
PENDING_REQUESTS = {}

LAST_SHUTDOWN = {}
HOSTS_CACHE = None
HOSTS_PATH = "/home/pi/TechtileDashboard/dashboard/public/hosts.yaml"

# load hosts.yaml file
def load_hosts_yaml(path=HOSTS_PATH):
    global HOSTS_CACHE
    try:
        with open(path, "r") as f:
            HOSTS_CACHE = yaml.safe_load(f)
    except Exception as e:
        print("[ERROR] Could not read hosts.yaml:", e)
        HOSTS_CACHE = None

# PDU-rpi port mapping
def get_midspan_mapping_for_rpi(device_id):
    """
    Return (midspan_id, poe_port) for a given RPi device, or (None, None) if not found.
    Expecting hosts.yaml to map like:
      all:
        hosts:
          A01:
            ansible_host: rpi-a01.local
            midspan: midspan-001
            poe-port: 1
    """
    global HOSTS_CACHE
    if HOSTS_CACHE is None:
        load_hosts_yaml()
    try:
        entry = HOSTS_CACHE["all"]["hosts"].get(device_id)
        if not entry:
            return (None, None)
        return (entry.get("midspan"), entry.get("poe-port"))
    except Exception as e:
        print("[WARN] MIDSPAN mapping lookup failed:", e)
        return (None, None)

# PDU control publisher
def publish_midspan_port(midspan_id, port, state):
    """
    state: "on" or "off"
    Topic design is up to you; this is a generic example:
      midspan/control/<midspan_id>/<port>
      payload: {"state":"on"} or {"state":"off"}
    """
    if not midspan_id or port is None:
        print(f"[MIDSPAN] Missing mapping. midspan_id={midspan_id}, port={port}")
        return False
    topic = f"midspan/control/{midspan_id}/{port}"
    payload = {"state": state}
    try:
        client.publish(topic, json.dumps(payload))
        print(f"[MIDSPAN] Published {state} to {topic}")
        return True
    except Exception as e:
        print("[MIDSPAN] Publish failed:", e)
        return False

def is_rpi_online(device_id, timeout=1.2):
    try:
        host = f"rpi-{device_id}.local"
        r = ping(host, timeout=timeout)
        return isinstance(r, Number) and r > 0
    except Exception:
        return False

# Shutdown, reboot, poweroff and poweron functions
def shutdown(device_id):
    req_id = str(uuid.uuid4())
    topic = f"rpi/control/{device_id}"
    payload = {"request_id": req_id, "command": "shutdown"}
    PENDING_REQUESTS[req_id] = {
        "device_id": device_id,
        "command": "shutdown",
        "timestamp": time.time()
    }
    client.publish(topic, json.dumps(payload))
    LAST_SHUTDOWN[device_id] = time.time()
    print(f"[REBOOT] Sent shutdown to {device_id} (req {req_id})")

def reboot(device_id):
    req_id = str(uuid.uuid4())
    topic = f"rpi/control/{device_id}"
    payload = {"request_id": req_id, "command": "reboot"}
    PENDING_REQUESTS[req_id] = {
        "device_id": device_id,
        "command": "reboot",
        "timestamp": time.time()
    }
    client.publish(topic, json.dumps(payload))
    print(f"[REBOOT] Sent reboot to {device_id} (req {req_id})")


def poweroff(device_id, shutdown_grace_s=20):
    if device_id not in LAST_SHUTDOWN:
        print(f"[POWER OFF] Poweroff requested without prior shutdown for {device_id} — doing safe shutdown first.")
        shutdown(device_id)
        time.sleep(shutdown_grace_s)
    else:
        print(f"[POWER OFF] Poweroff requested after shutdown for {device_id} — skipping shutdown step.")

    midspan_id, poe_port = get_midspan_mapping_for_rpi(device_id)
    if not midspan_id:
        print(f"[POWER OFF] No MIDSPAN mapping for {device_id}, cannot power on.")
        return
    publish_midspan_port(midspan_id, poe_port, "off")

def poweron(device_id, cycle_off_s=3):
    midspan_id, poe_port = get_midspan_mapping_for_rpi(device_id)
    if not midspan_id:
        print(f"[ORCH] No MIDSPAN mapping for {device_id}, cannot power on.")
        return

    if device_id in LAST_SHUTDOWN:
        print(f"[POWER ON] Poweron after shutdown for {device_id}.")
        publish_midspan_port(midspan_id, poe_port, "off")
        time.sleep(cycle_off_s)
        publish_midspan_port(midspan_id, poe_port, "on")
    else:
        print(f"[POWER ON] Poweron without shutdown for {device_id} — just turning PDU on.")
        publish_midspan_port(midspan_id, poe_port, "on")

    LAST_SHUTDOWN.pop(device_id, None)


# MQTT handlers
def on_mqtt_message(client, userdata, message):
    try:
        payload = json.loads(message.payload.decode("utf-8"))
        topic_parts = message.topic.split("/")
        if topic_parts[:3] == ["rpi", "control", "ack"]:
            device_id = topic_parts[3] if len(topic_parts) > 3 else "unknown"
            request_id = payload.get("request_id")
            print(f"[ACK] Received from {message.topic}: {payload}")

            if request_id and request_id in PENDING_REQUESTS:
                PENDING_REQUESTS.pop(request_id, None)

                confirm_topic = f"rpi/control/confirm/{payload['device_id']}"
                confirm_payload = {"request_id": request_id}
                client.publish(confirm_topic, json.dumps(confirm_payload))
                print(f"[CONFIRM] Sent confirmation for {request_id} to {confirm_topic}")
    except Exception as e:
        print(f"[ERROR] MQTT on_message failed: {e}")

client.on_message = on_mqtt_message
client.subscribe("rpi/control/ack/#")
client.loop_start()

def publish_status_periodically():
    topic = "experiment"
    interval = 10  # seconden

    while True:
        if os.path.exists(STATUS_FILE_PATH):
            try:
                with open(STATUS_FILE_PATH, "r") as f:
                    data = json.load(f)
                client.publish(topic, json.dumps(data))
                print(f"[MQTT] Published status to '{topic}':", data)
            except Exception as e:
                print(f"[ERROR] Failed to publish status: {e}")
        else:
            print(f"[MQTT] Status file not found, skipping publish")

        time.sleep(interval)
mqtt_status_thread = threading.Thread(target=publish_status_periodically, daemon=True)
mqtt_status_thread.start()


# Flask routes
@app.route("/status", methods=["GET"])
def get_status():
    if not os.path.exists(STATUS_FILE_PATH):
        return jsonify({"status": "inactive", "message": ""}), 200

    try:
        with open(STATUS_FILE_PATH, "r") as f:
            data = json.load(f)
        return jsonify(data), 200
    except Exception as e:
        return jsonify({"error": f"Error reading status file: {str(e)}"}), 500


@app.route("/status", methods=["POST"])
def update_status():
    try:
        data = request.get_json(force=True)
        print("Received JSON:", data)

        if not data:
            return jsonify({"error": "Missing JSON body"}), 400

        status = data.get("status", "inactive")
        message = data.get("message", "")

        json_data = {
            "status": status if status in ["active", "inactive"] else "inactive",
            "message": message or ""
        }

        with open(STATUS_FILE_PATH, "w") as f:
            json.dump(json_data, f)

        return jsonify({"success": True, "data": json_data}), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/ping/<hostname>", methods=["GET"])
def ping_host(hostname):
    try:
        try:
            resolved_ip = socket.gethostbyname(hostname)
        except Exception as e:
            resolved_ip = f"unresolved({e})"
        response_time = ping(hostname, timeout=1)
        print(f"[PING DEBUG] Hostname={hostname}, Resolved IP={resolved_ip}, Result={response_time}({type(response_time)})")

        if isinstance(response_time, Number) and response_time > 0:
            return jsonify({"status": "alive", "time": round(response_time * 1000, 2)})
        else:
            return jsonify({"status": "failed"})
    except Exception as e:
        return jsonify({"error": "Error while pinging", "details": str(e)}), 500


@app.route("/data/<deviceId>", methods=["GET"])
@cache.cached(timeout=60, query_string=True)
def get_device_data(deviceId):
    try:
        hours = int(request.args.get("hours", 4))
        cutoff_timestamp = int(time.time()) - hours * 3600

        conn = sqlite3.connect('/home/pi/rpi_data.db', check_same_thread=False)
        cursor = conn.cursor()

        query = """
            SELECT cpuLoad, cpuTemp, ram, diskUsage, timestamp
            FROM rpi_data
            WHERE id = ? AND timestamp >= ?
            ORDER BY timestamp ASC
        """
        cursor.execute(query, (deviceId, cutoff_timestamp))
        rows = cursor.fetchall()
        conn.close()

        formatted = []
        for row in rows:
            cpu_load = float(str(row[0]).replace('%', '')) if row[0] else 0
            cpu_temp = float(row[1]) if row[1] else 0
            ram = float(str(row[2]).replace('MB', '').replace('GB', '').strip()) if row[2] else 0
            disk_usage = float(str(row[3]).replace('MB', '').replace('GB', '').strip()) if row[3] else 0
            timestamp = row[4]

            formatted.append({
                "cpuLoad": cpu_load,
                "cpuTemp": cpu_temp,
                "ram": ram,
                "diskUsage": disk_usage,
                "timestamp": timestamp
            })

        return jsonify(formatted)
    except Exception as e:
        return jsonify({"error": "Database error", "details": str(e)}), 500


import time
@app.route("/control/<device_id>/<command>", methods=["POST"])
def send_control_command(device_id, command):
    try:
        if command not in ["shutdown", "reboot", "poweron", "poweroff"]:
            return jsonify({"error": "Unsupported command"}), 400
        #start_time = time.time()
        #print(f"[DEBUG time] Start /control for {device_id} at {start_time}")

        if command == "shutdown":
            shutdown(device_id)
            return jsonify({"success": True, "mode": "backend_shutdown"}), 200

        if command == "reboot":
            reboot(device_id)
            return jsonify({"success": True, "mode": "backend_reboot"}), 200

        if command == "poweroff":
            threading.Thread(target=poweroff, args=(device_id,), daemon=True).start()
            return jsonify({"success": True, "mode": "backend_poweroff"}), 200

        if command == "poweron":
            threading.Thread(target=poweron, args=(device_id,), daemon=True).start()
            return jsonify({"success": True, "mode": "backend_poweron"}), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/db/latest", methods=["GET"])
def db_latest():
    try:
        table = request.args.get("table")
        filters = request.args.to_dict(flat=True)
        filters.pop("table", None)

        if not SAFE_TABLE.match(table):
            return jsonify({"error": "invalid table"}), 400

        clauses, values = [], []
        for k, v in filters.items():
            if not SAFE_COL.match(k):
                return jsonify({"error": f"invalid filter key {k}"}), 400
            clauses.append(f"{k} = ?")
            values.append(v)

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"SELECT * FROM {table} {where} ORDER BY timestamp DESC LIMIT 1"

        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        try:
            cur.execute(sql, values)
            row = cur.fetchone()
            conn.close()
            return jsonify({k: row[k] for k in row.keys()} if row else None), 200
        except sqlite3.OperationalError as e:
            # e.g., "no such table"
            conn.close()
            return jsonify(None), 200

    except Exception as e:
        return jsonify({"error": "db error", "details": str(e)}), 500


# server.py  (inside /db/latest/batch)
@app.route("/db/latest/batch", methods=["POST"])
def db_latest_batch():
    try:
        payload = request.get_json(force=True) or {}
        queries = payload.get("queries", [])
        out = []

        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        for q in queries:
            table = q.get("table", "")
            if not SAFE_TABLE.match(table):
                out.append({"table": table, "row": None, "error": "invalid table"})
                continue

            filters = q.get("filters", {}) or {}
            clauses, values = [], []
            bad = False
            for k, v in filters.items():
                if not SAFE_COL.match(k):
                    out.append({"table": table, "row": None, "error": f"invalid filter key {k}"})
                    bad = True
                    break
                clauses.append(f"{k} = ?")
                values.append(v)
            if bad:
                continue

            where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
            sql = f"SELECT * FROM {table} {where} ORDER BY timestamp DESC LIMIT 1"
            try:
                cur.execute(sql, values)
                row = cur.fetchone()
                out.append({"table": table, "row": ({k: row[k] for k in row.keys()} if row else None)})
            except sqlite3.OperationalError as e:
                # Most common: "no such table"
                out.append({"table": table, "row": None, "error": str(e)})

        conn.close()
        return jsonify({"results": out}), 200
    except Exception as e:
        return jsonify({"error": "db error", "details": str(e)}), 500

def get_lan_ip():
    """
    Returns the LAN IP address of the current machine by opening a UDP connection
    with a non-routable address and retrieving the socket's local IP.
    """
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception as e:
        print("Could not determine LAN IP:", e)
        return "127.0.0.1"


def update_api_ip_in_yaml(ip, path=HOSTS_PATH):
    """
    Updates the given YAML file with the specified IP under the path 'all.vars.api_ip'.

    Args:
        ip (str): The IP address to write.
        path (str): Path to the YAML file (default is 'hosts.yaml').
    """
    try:
        with open(path, "r") as f:
            data = yaml.safe_load(f)

        data["all"]["vars"]["api_ip"] = ip

        with open(path, "w") as f:
            yaml.dump(data, f)

        print("Updated api_ip in hosts.yaml:", ip)

    except Exception as e:
        print("Failed to update YAML:", e)


def cleanup_pending_requests():
    while True:
        time.sleep(30)
        now = time.time()
        for req_id in list(PENDING_REQUESTS.keys()):
            if now - PENDING_REQUESTS[req_id]["timestamp"] > 60:
                print(f"[TIMEOUT] Removing stale request ID: {req_id}")
                del PENDING_REQUESTS[req_id]

cleanup_thread = threading.Thread(target=cleanup_pending_requests, daemon=True)
cleanup_thread.start()

@app.after_request
def add_cors_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


if __name__ == "__main__":
    #update_api_ip_in_yaml(get_lan_ip(), "/home/pi/TechtileDashboard/build/hosts.yaml")
    update_api_ip_in_yaml(get_lan_ip(), HOSTS_PATH)
    app.run(host="0.0.0.0", port=5000)
