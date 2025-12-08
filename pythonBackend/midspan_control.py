import time
import json
import yaml
from pathlib import Path
from pysnmp.hlapi import *
import paho.mqtt.client as mqtt
from typing import Dict, Any, Optional
import sys
import math
from pysnmp.hlapi import (
SnmpEngine, UdpTransportTarget,ContextData,ObjectType,ObjectIdentity,UsmUserData,setCmd, Integer,
getCmd,usmHMACMD5AuthProtocol, usmHMACSHAAuthProtocol, usmAesCfb128Protocol, usmAesCfb192Protocol,
usmAesCfb256Protocol, usmDESPrivProtocol, usmNoAuthProtocol, usmNoPrivProtocol,
)

cfg_path = Path("/home/pi/TechtileDashboard/pythonBackend/midspan_config.yaml")

BROKER_HOST = "10.128.48.5"
BROKER_PORT = 1883



# ---------------------------------------------------------
# Formatting helpers (copied from SNMP_Midspan.py)
# ---------------------------------------------------------
def to_float(val):
    if val is None:
        return None
    try:
        return float(val)
    except:
        return None

def fmt_watts(x):
    if x is None:
        return None
    return f"{float(x):.2f}W"

def fmt_volts(x):
    if x is None:
        return None
    # integer volts look cleaner without decimals
    x_f = float(x)
    if x_f.is_integer():
        return f"{int(x_f)}V"
    return f"{x_f:.2f}V"

def fmt_celsius(x):
    if x is None:
        return None
    return f"{float(x):.2f}°C"


# ---------------------------------------------------------
# SNMP + MQTT helpers
# ---------------------------------------------------------
def load_config(path: Path = cfg_path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)

def mqtt_connect():
    c = mqtt.Client()
    c.connect(BROKER_HOST, BROKER_PORT, keepalive=60)
    c.loop_start()
    return c


def mqtt_publish(client, topic, payload):
    payload_no_none = {k: v for k, v in payload.items() if v is not None}
    client.publish(topic, json.dumps(payload_no_none))

def mqtt_publish_json(client, topic, payload):
    # Remove None values for a clean payload
    payload = {k: v for k, v in payload.items() if v is not None}
    client.publish(topic, json.dumps(payload))

def map_auth_proto(name: str):
    name = (name or "").strip().upper()
    if name in ("", "NONE", "NOAUTH"):  # not expected here, but supported
        return usmNoAuthProtocol
    if name == "MD5":
        return usmHMACMD5AuthProtocol
    if name in ("SHA", "HMACSHA", "SHA1"):
        return usmHMACSHAAuthProtocol
    raise ValueError(f"Unsupported auth protocol: {name}")

def map_priv_proto(name: str):
    name = (name or "").strip().upper()
    if name in ("", "NONE", "NOPRIV"):
        return usmNoPrivProtocol
    if name == "DES":
        return usmDESPrivProtocol
    if name in ("AES128", "AES"):
        return usmAesCfb128Protocol
    if name == "AES192":
        return usmAesCfb192Protocol
    if name == "AES256":
        return usmAesCfb256Protocol
    raise ValueError(f"Unsupported privacy protocol: {name}")

def snmp_set(host, user, auth_pass, priv_pass, auth_proto, priv_proto, timeout, retries, oid, value):
    usm = UsmUserData(
        user,
        auth_pass if auth_proto is not usmNoAuthProtocol else None,
        priv_pass if priv_proto is not usmNoPrivProtocol else None,
        authProtocol=auth_proto,
        privProtocol=priv_proto,
    )

    errInd, errStat, errIdx, varBinds = next(
        setCmd(
            SnmpEngine(),
            usm,
            UdpTransportTarget((host, 161), timeout=timeout, retries=retries),
            ContextData(),
            ObjectType(ObjectIdentity(oid), Integer(value))
        )
    )

    if errInd:
        print(f"SNMP SET error: {errInd}")
        return False
    if errStat:
        print(f"SNMP SET failed: {errStat.prettyPrint()}")
        return False

    return True

def snmp_get(host, oid, user, auth_proto, priv_proto, auth_pass, priv_pass, timeout, retries):
    usm = UsmUserData(
        user,
        auth_pass if auth_proto != usmNoAuthProtocol else None,
        priv_pass if priv_proto != usmNoPrivProtocol else None,
        authProtocol=auth_proto,
        privProtocol=priv_proto,
    )
    try:
        errInd, errStat, errIdx, varBinds = next(
            getCmd(
                SnmpEngine(),
                usm,
                UdpTransportTarget((host, 161), timeout=timeout, retries=retries),
                ContextData(),
                ObjectType(ObjectIdentity(oid))
            )
        )
        if errInd or errStat:
            return None
        return str(list(varBinds)[0][1])
    except:
        return None


def map_oper_status(n):
    if n is None:
        return "inactive"
    if int(n) == 1:
        return "active"
    return "inactive"


def map_port_status(n):
    if n is None:
        return "inactive"
    if int(n) == 3:
        return "active"
    return "inactive"


def class_from_code(n):
    if n is None:
        return None
    return str(int(n))


# ---------------------------------------------------------
# MAIN LOOP
# ---------------------------------------------------------
def GetSNMP_poeport(host, midspan_id, port, c):
    """Fetch SNMP data for a PoE port based on its midspan ID and port number."""
    test_payload = {"message": "Test2"}
    mqtt_publish_json(c, "midspan/poeport/singlePortData", test_payload)
    # Retrieve the host IP of the midspan device from the configuration (or map).
    cfg = load_config()
    
    test_payload = {"message": "Test2.2"}
    mqtt_publish_json(c, "midspan/poeport/singlePortData", test_payload)
    # Retrieve the OIDs from the config
    oids = cfg["oids"]
    defaults = cfg["defaults"]
    midspans = cfg["midspans"]

    test_payload = {"message": "Test2.3"}
    mqtt_publish_json(c, "midspan/poeport/singlePortData", test_payload)
    # SNMP config
    snmp_cfg = defaults["snmp"]
    user = snmp_cfg["user"]
    auth_pass = snmp_cfg["auth_pass_env"]
    priv_pass = snmp_cfg["priv_pass_env"]
    auth_proto = usmHMACMD5AuthProtocol
    priv_proto = usmDESPrivProtocol
    timeout = float(snmp_cfg["timeout"])
    retries = int(snmp_cfg["retries"])
 
    test_payload = {"message": "Test2.3"}
    mqtt_publish_json(c, "midspan/poeport/singlePortData", test_payload)

    volt_raw = to_float(snmp_get(host, oids["device"]["system_voltage_v"], user, auth_proto, priv_proto, auth_pass, priv_pass, timeout, retries))

    det_oid  = oids["port"]["detection_status"].format(port=port)
    class_oid = oids["port"]["classification_code"].format(port=port)
    pwr_oid   = oids["port"]["actual_power_w"].format(port=port)
    max_oid   = oids["port"]["max_power_w"].format(port=port)

    test_payload = {"message": "Test3"}
    mqtt_publish_json(c, "midspan/poeport/singlePortData", test_payload)

    det_raw = to_float(snmp_get(host, det_oid,  user, auth_proto, priv_proto, auth_pass, priv_pass, timeout, retries))
    cls_raw = to_float(snmp_get(host, class_oid, user, auth_proto, priv_proto, auth_pass, priv_pass, timeout, retries))
    pwr_act = to_float(snmp_get(host, pwr_oid,   user, auth_proto, priv_proto, auth_pass, priv_pass, timeout, retries))
    pwr_max = to_float(snmp_get(host, max_oid,   user, auth_proto, priv_proto, auth_pass, priv_pass, timeout, retries))
    
    test_payload = {"message": "Test4"}
    mqtt_publish_json(c, "midspan/poeport/singlePortData", test_payload)

    port_payload = {
        "id": midspan_id,
        "port": port,
        "status": map_port_status(det_raw),
        "class": class_from_code(cls_raw),
        "power": fmt_watts(pwr_act),
        "maxPower": fmt_watts(pwr_max),
        "voltage": fmt_volts(volt_raw)  # midspan voltage applies to all ports
    }

    test_payload = {"message": "Test5"}
    mqtt_publish_json(c, "midspan/poeport/singlePortData", test_payload)
    # Publish to MQTT topic
    mqtt_publish_json(c, "midspan/poeport/singlePortData", port_payload)
    print(f"PoE port data for midspan {midspan_id}, port {port}: {payload}")


def collectSNMP_and_print(cfg):

    cfg = load_config()
    defaults = cfg["defaults"]
    midspans = cfg["midspans"]
    oids = cfg["oids"]

    # SNMP config
    snmp_cfg = defaults["snmp"]
    user = snmp_cfg["user"]
    auth_pass = snmp_cfg["auth_pass_env"]
    priv_pass = snmp_cfg["priv_pass_env"]
    auth_proto = usmHMACMD5AuthProtocol
    priv_proto = usmDESPrivProtocol
    timeout = float(snmp_cfg["timeout"])
    retries = int(snmp_cfg["retries"])

    # MQTT topics
    topic_device = defaults["mqtt"]["topic_device"]     # midspan/data
    topic_port   = defaults["mqtt"]["topic_port"]       # midspan/poeport

    client = mqtt_connect()

    while True:
        for m in midspans:
            mid = m["id"]
            host = m["host"]
            ports = int(m.get("number_ports", defaults.get("poe_ports", 24)))

            # -------------------------------
            # MIDSPAN DEVICE-LEVEL VALUES
            # -------------------------------
            oper_raw = to_float(snmp_get(host, oids["device"]["oper_status"], user, auth_proto, priv_proto, auth_pass, priv_pass, timeout, retries))
            temp_raw = to_float(snmp_get(host, oids["device"]["temperature_c"], user, auth_proto, priv_proto, auth_pass, priv_pass, timeout, retries))
            volt_raw = to_float(snmp_get(host, oids["device"]["system_voltage_v"], user, auth_proto, priv_proto, auth_pass, priv_pass, timeout, retries))
            pwr_raw  = to_float(snmp_get(host, oids["device"]["total_power_consumption"], user, auth_proto, priv_proto, auth_pass, priv_pass, timeout, retries))

            device_payload = {
                "id": mid,
                "status": map_oper_status(oper_raw),
                "temperature": fmt_celsius(temp_raw),
                "systemVoltage": fmt_volts(volt_raw),
                "totalPowerConsumption": fmt_watts(pwr_raw)
            }

            mqtt_publish(client, topic_device, device_payload)

            # -------------------------------
            # POE PORT VALUES
            # -------------------------------
            for p in range(1, ports + 1):

                det_oid  = oids["port"]["detection_status"].format(port=p)
                class_oid = oids["port"]["classification_code"].format(port=p)
                pwr_oid   = oids["port"]["actual_power_w"].format(port=p)
                max_oid   = oids["port"]["max_power_w"].format(port=p)

                det_raw = to_float(snmp_get(host, det_oid,  user, auth_proto, priv_proto, auth_pass, priv_pass, timeout, retries))
                cls_raw = to_float(snmp_get(host, class_oid, user, auth_proto, priv_proto, auth_pass, priv_pass, timeout, retries))
                pwr_act = to_float(snmp_get(host, pwr_oid,   user, auth_proto, priv_proto, auth_pass, priv_pass, timeout, retries))
                pwr_max = to_float(snmp_get(host, max_oid,   user, auth_proto, priv_proto, auth_pass, priv_pass, timeout, retries))

                port_payload = {
                    "id": mid,
                    "port": p,
                    "status": map_port_status(det_raw),
                    "class": class_from_code(cls_raw),
                    "power": fmt_watts(pwr_act),
                    "maxPower": fmt_watts(pwr_max),
                    "voltage": fmt_volts(volt_raw)  # midspan voltage applies to all ports
                }

                mqtt_publish(client, topic_port, port_payload)


def publish_port_state_after_set(mid_id, port, host, defaults, oids, mqtt_client, value):
    # --- Resolve config pieces we need
    mqtt_cfg = defaults.get("mqtt", {}) or {}
    topic_state = "midspan/poeport/state"   # Dedicated status-only topic


    dev_oids = (oids or {}).get("device", {}) or {}
    port_oids = (oids or {}).get("port", {}) or {}

    oid_detect       = port_oids.get("detection_status")
    oid_class        = port_oids.get("classification_code")
    oid_actual_power = port_oids.get("actual_power_w")
    oid_max_power_w  = port_oids.get("max_power_w")
    oid_voltage_dev  = dev_oids.get("system_voltage_v")

    # SNMP creds
    snmp_cfg  = defaults.get("snmp", {}) or {}
    user      = snmp_cfg.get("user")
    auth_proto = map_auth_proto(snmp_cfg.get("auth_proto", "MD5"))
    priv_proto = map_priv_proto(snmp_cfg.get("priv_proto", "DES"))
    auth_pass  = snmp_cfg.get("auth_pass_env")
    priv_pass  = snmp_cfg.get("priv_pass_env")
    timeout    = float(snmp_cfg.get("timeout", 1.5))
    retries    = int(snmp_cfg.get("retries", 3))

    # Helper to fill {port} in per-port OIDs
    def fmt_oid(tpl):
        return None if not tpl else tpl.format(port=port)

    # --- Read current device voltage (shared by ports)
    system_voltage = None
    if oid_voltage_dev:
        system_voltage = to_float(
            snmp_get(
                host,
                oid_voltage_dev,
                user,
                auth_proto,
                priv_proto,
                auth_pass,
                priv_pass,
                timeout,
                retries
            )
        )

    # --- Read ONLY this port’s values
    det_raw = to_float(
        snmp_get(
            host,
            fmt_oid(oid_detect),
            user,
            auth_proto,
            priv_proto,
            auth_pass,
            priv_pass,
            timeout,
            retries
        )
    ) if oid_detect else None

    cls_raw = to_float(
        snmp_get(
            host,
            fmt_oid(oid_class),
            user,
            auth_proto,
            priv_proto,
            auth_pass,
            priv_pass,
            timeout,
            retries
        )
    ) if oid_class else None

    pwr_actual = to_float(
        snmp_get(
            host,
            fmt_oid(oid_actual_power),
            user,
            auth_proto,
            priv_proto,
            auth_pass,
            priv_pass,
            timeout,
            retries
        )
    ) if oid_actual_power else None

    pwr_max = to_float(
        snmp_get(
            host,
            fmt_oid(oid_max_power_w),
            user,
            auth_proto,
            priv_proto,
            auth_pass,
            priv_pass,
            timeout,
            retries
        )
    ) if oid_max_power_w else None


    if value == 1: 
        payload = {
            "id": mid_id,
            "port": port,
            "status": "active",
            "power":  fmt_watts(pwr_actual),
            "voltage": fmt_volts(system_voltage) if system_voltage is not None else None,
            "maxPower": fmt_watts(pwr_max),
            "class": class_from_code(cls_raw),
        }

    elif value == 2:
        payload = {
            "id": mid_id,
            "port": port,
            "status": "inactive",
            "power":  fmt_watts(pwr_actual),
            "voltage": fmt_volts(system_voltage) if system_voltage is not None else None,
            "maxPower": fmt_watts(pwr_max),
            "class": class_from_code(cls_raw),
        }


    mqtt_publish_json(mqtt_client, topic_state, payload)


def start_mqtt_control_listener(cfg: Dict[str, Any]) -> mqtt.Client:
    """Listens on 'midspan/control/<midspan_id>/<port>' for JSON {'state':'on'|'off'} and flips PoE."""
    defaults = cfg.get("defaults", {})
    oids = cfg.get("oids", {})
    port_oids = oids.get("port", {})
    oid_enable_tpl = port_oids.get("admin_enable")
    if not oid_enable_tpl:
        raise RuntimeError("Missing 'oids.port.admin_enable' in midspan_config.yaml")

    # Build id -> host map
    id2host = {}
    for m in cfg.get("midspans", []):
        if m.get("id") and m.get("host"):
            id2host[m["id"]] = m["host"]

    # SNMP creds
    snmp_cfg = defaults.get("snmp", {})
    user = snmp_cfg.get("user")
    auth_proto = map_auth_proto(snmp_cfg.get("auth_proto", "MD5"))
    priv_proto = map_priv_proto(snmp_cfg.get("priv_proto", "DES"))
    auth_pass = snmp_cfg.get("auth_pass_env")
    priv_pass = snmp_cfg.get("priv_pass_env")
    timeout = float(snmp_cfg.get("timeout", 1.5))
    retries = int(snmp_cfg.get("retries", 3))

    # MQTT
    mqtt_cfg = defaults.get("mqtt", {})
    client = mqtt.Client()

    def on_connect(c, u, f, rc):
        print(f"[MQTT] Connected with rc={rc}")
        c.subscribe("midspan/control/+/+")
        print("[MQTT] Subscribed to midspan/control/+/+")

    def on_message(c, u, msg):
        print(f"Messag MQTT received")
        try:
            # Topic: midspan/control/<midspan_id>/<port>
            parts = msg.topic.split("/")
            if len(parts) != 4:
                print(f"[CTRL] Ignoring unexpected topic: {msg.topic}")
                return
            _, _, mid_id, port_str = parts
            host = id2host.get(mid_id)
            if not host:
                print(f"[CTRL] Unknown midspan id '{mid_id}'")
                return

            try:
                payload = json.loads(msg.payload.decode("utf-8"))
            except Exception:
                payload = {}

            state = (payload.get("state") or "").strip().lower()
            if state not in ("on", "off", "get", "set"):
                print(f"[CTRL] Invalid state '{state}' in payload for {msg.topic}: {payload}")
                return

            if state == "on" or state == "off":
                try:
                    port = int(port_str)
                except Exception:
                    print(f"[CTRL] Invalid port '{port_str}' in topic {msg.topic}")
                    return

                oid_enable_power = oid_enable_tpl.format(port=port)
                value = 1 if state == "on" else 2  # 1 = enable, 2 = disable (typical admin state enums)

                ok = snmp_set(host, user, auth_pass, priv_pass, auth_proto, priv_proto, timeout, retries, oid_enable_power, value)

                publish_port_state_after_set(mid_id, port, host, defaults, oids, c, value)

                print(f"[CTRL] midspan={mid_id} host={host} port={port} -> {state.upper()} => {'OK' if ok else 'FAIL'}")

                # Optional: publish an acknowledgement
                ack_topic = f"midspan/control/ack/{mid_id}/{port}"
                mqtt_publish_json(c, ack_topic, {"state": state, "ok": ok})
            
            elif state == "get":
                test_payload = {"message": "Test1"}
                mqtt_publish_json(c, "midspan/poeport/singlePortData", test_payload)
                port = int(port_str)
                GetSNMP_poeport(host, mid_id, port, c)
            
        except Exception as e:
            print(f"[CTRL] Exception handling message on {msg.topic}: {e}", file=sys.stderr)

    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(mqtt_cfg["host"], int(mqtt_cfg.get("port", 1883)), keepalive=60)
    client.loop_start()
    return client


if __name__ == "__main__":
    if not cfg_path.exists():
        print(f"Config file not found: {cfg_path}", file=sys.stderr)
        sys.exit(1)

    try:
        cfg = load_config(cfg_path)
    except Exception as e:
        print(f"Failed to load YAML config: {e}", file=sys.stderr)
        sys.exit(1)
    

    ctrl_client = start_mqtt_control_listener(cfg)
    collectSNMP_and_print(cfg)
    time.sleep(30)
