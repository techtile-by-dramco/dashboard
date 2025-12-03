import json
import math
import sys
from pathlib import Path
from typing import Any, Dict, Optional
import paho.mqtt.client as mqtt
import yaml
from pysnmp.hlapi import (
    SnmpEngine, UdpTransportTarget,ContextData,ObjectType,ObjectIdentity,UsmUserData,setCmd, Integer,
    getCmd,usmHMACMD5AuthProtocol, usmHMACSHAAuthProtocol, usmAesCfb128Protocol, usmAesCfb192Protocol,
    usmAesCfb256Protocol, usmDESPrivProtocol, usmNoAuthProtocol, usmNoPrivProtocol,
)

def load_config(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)

def mqtt_connect(mqtt_cfg):
    # Create an MQTT connection to the broker
    client = mqtt.Client()
    client.connect(mqtt_cfg["host"], int(mqtt_cfg.get("port", 1883)), keepalive=60)
    client.loop_start()  # Start network loop in the background
    return client

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

def snmp_get(host: str, port: int, user: str, auth_pass: Optional[str], priv_pass: Optional[str], auth_proto, priv_proto, timeout: float, retries: int, oid: str) -> Optional[str]:
    try:
        usm = UsmUserData(
            user,
            auth_pass if auth_proto is not usmNoAuthProtocol else None,
            priv_pass if priv_proto is not usmNoPrivProtocol else None,
            authProtocol=auth_proto,
            privProtocol=priv_proto,
        )

        errInd, errStat, errIdx, varBinds = next(
            getCmd(
                SnmpEngine(),
                usm,
                UdpTransportTarget((host, 161), timeout=timeout, retries=retries),
                ContextData(),
                ObjectType(ObjectIdentity(oid.strip().strip('"')))
            )
        )

        if errInd:
            print(f"[{host}] SNMP engine error on {oid}: {errInd}", file=sys.stderr)
            return None
        if errStat:
            print(f"[{host}] SNMP error on {oid}: {errStat.prettyPrint()}", file=sys.stderr)
            return None

        for n, v in varBinds:
            return str(v)
        return None
    except Exception as e:
        print(f"[{host}] Exception during SNMP GET {oid}: {e}", file=sys.stderr)
        return None

def to_float(val: Optional[str]) -> Optional[float]:
    if val is None:
        return None
    try:
        return float(val)
    except Exception:
        # Some agents return integers but as strings, still fine; else unsupported format
        try:
            return float(int(val, 10))
        except Exception:
            return None

def fmt_watts(x):     return None if x is None else f"{x:.2f}W"
def fmt_volts(x):     return None if x is None else f"{int(x) if float(x).is_integer() else x}V"
def fmt_amps(x):      return None if x is None else f"{x:.2f}A"
def fmt_celsius(x):   return None if x is None else f"{x:.2f}°C"

def device_status_from_oper(n: Optional[float]) -> str:
    # Conservative mapping; adjust if your platform uses different enums.
    # Common main PSE oper statuses:
    #   1 = active/up, 2 = off/down; else unknown
    if n is None:
        return "unknown"
    if int(n) == 1:
        return "active"
    if int(n) == 2:
        return "off"
    return "unknown"

def port_status_from_detection(n: Optional[float]) -> str:
    # As per your comment:
    # detection_status: deliveringPower(3), searching(2), otherFault(6)
    if n is None:
        return "inactive" #"unknown"
    i = int(n)
    if i == 3:
        return "active"
    if i == 2:
        return "inactive" #"searching"
    if i == 6:
        return "inactive" #"fault"
    return "inactive" #"unknown"


def class_from_code(n: Optional[float]) -> Optional[str]:
    if n is None:
        return None
    i = int(n)
    if i == 1:
        return "1"
    if i == 2:
        return "2"
    if i == 3:
        return "3"
    if i == 4:
        return "4"
    if i == 5:
        # Some devices use 5 for class4 in a different MIB flavor; keep it readable
        return "4"
    return f"{i}"


def collect_and_print(cfg: Dict[str, Any]) -> None:
    midspans = cfg.get("midspans", [])
    defaults = cfg.get("defaults", {})
    oids = cfg.get("oids", {})


    snmp_cfg = defaults.get("snmp", {})
    user = snmp_cfg.get("user")
    auth_proto = map_auth_proto(snmp_cfg.get("auth_proto", "MD5"))
    priv_proto = map_priv_proto(snmp_cfg.get("priv_proto", "DES"))
    auth_pass = snmp_cfg.get("auth_pass_env")
    priv_pass = snmp_cfg.get("priv_pass_env")
    timeout = float(snmp_cfg.get("timeout", 1.5))
    retries = int(snmp_cfg.get("retries", 3))

    mqtt_cfg = defaults.get("mqtt", {})
    topic_device = mqtt_cfg.get("topic_device", "midspan/data")
    topic_port = mqtt_cfg.get("topic_port", "midspan/poeport")

    dev_oids = oids.get("device", {})
    port_oids = oids.get("port", {})

    
    # Device OIDs
    oid_max_power_avail = dev_oids.get("max_power_available")
    oid_oper_status = dev_oids.get("oper_status")
    oid_total_power = dev_oids.get("total_power_consumption")
    oid_voltage = dev_oids.get("system_voltage_v")
    oid_temp = dev_oids.get("temperature_c")

    # Port OIDs (with {port})
    oid_detect = port_oids.get("detection_status")
    oid_class = port_oids.get("classification_code")
    oid_actual_power = port_oids.get("actual_power_w")
    oid_max_power_w = port_oids.get("max_power_w")

    oid_enable_power = port_oids.get("admin_enable")
    port_num = 5
    oid_enable_power = oid_enable_power.format(port=port_num)

    first_midspan = midspans[0]
    host = first_midspan.get("host")
    # --- do the SETs ---
    #ok_off = snmp_set(host, user, auth_pass, priv_pass,
    #"                 auth_proto, priv_proto, timeout, retries,
    #                  oid_enable_power, 2)  # 2 = off
    #print("OFF result:", ok_off)
    #
    #ok_on = snmp_set(host, user, auth_pass, priv_pass,
    #                 auth_proto, priv_proto, timeout, retries,
    #                 oid_enable_power, 1)  # 1 = on
    #print("ON result:", ok_on)
 
    for m in midspans:
        mid_id = m.get("id")
        host = m.get("host")
        default_poe_ports = int(defaults.get("poe_ports", 24))
        try:
            poe_ports = int(m.get("number_ports", default_poe_ports))
        except (TypeError, ValueError):
            poe_ports = default_poe_ports  # safety fallback

        # ---- Device-level queries
        max_power_avail = to_float(snmp_get(host, 161, user, auth_pass, priv_pass,
                                            auth_proto, priv_proto, timeout, retries,
                                            oid_max_power_avail)) if oid_max_power_avail else None

        oper_status_raw = to_float(snmp_get(host, 161, user, auth_pass, priv_pass,
                                            auth_proto, priv_proto, timeout, retries,
                                            oid_oper_status)) if oid_oper_status else None

        total_power = to_float(snmp_get(host, 161, user, auth_pass, priv_pass,
                                        auth_proto, priv_proto, timeout, retries,
                                        oid_total_power)) if oid_total_power else None

        system_voltage = to_float(snmp_get(host, 161, user, auth_pass, priv_pass,
                                           auth_proto, priv_proto, timeout, retries,
                                           oid_voltage)) if oid_voltage else None

        temperature = to_float(snmp_get(host, 161, user, auth_pass, priv_pass,
                                        auth_proto, priv_proto, timeout, retries,
                                        oid_temp)) if oid_temp else None
        print("Temperature: ", temperature)
        print("voltage: ", system_voltage)
        print("Power: ", total_power)
        print("Status: ", oper_status_raw)
        print("Power available: ", max_power_avail)

        device_payload = {
            "id": mid_id,
            "totalPowerConsumption": fmt_watts(total_power),
            "maxAvailablePowerBudget": fmt_watts(max_power_avail) if max_power_avail is not None else None,
            "systemVoltage": fmt_volts(system_voltage),
            "temperature": fmt_celsius(temperature),
            "status": device_status_from_oper(oper_status_raw),
        }

        # Print device payload
        print(topic_device)
        print(json.dumps({k: v for k, v in device_payload.items() if v is not None}, ensure_ascii=False))
        # Separator for readability
        print()

        #Connect once before loop
        mqtt_cfg = defaults.get("mqtt", {})
        client = mqtt_connect(mqtt_cfg)

        #Instead of print(topic_device) / print(json.dumps(...)):
        mqtt_publish_json(client, topic_device, device_payload)

        #And for ports:
        #mqtt_publish_json(client, topic_port, device_payload)

        for p in range(1, poe_ports + 1):
            # Resolve OIDs with {port}
            def oid_fmt(template: Optional[str]) -> Optional[str]:
                if not template:
                    return None
                return template.format(port=p)

            det_raw = to_float(snmp_get(host, 161, user, auth_pass, priv_pass,
                                        auth_proto, priv_proto, timeout, retries,
                                        oid_fmt(oid_detect))) if oid_detect else None

            cls_raw = to_float(snmp_get(host, 161, user, auth_pass, priv_pass,
                                        auth_proto, priv_proto, timeout, retries,
                                        oid_fmt(oid_class))) if oid_class else None

            pwr_actual = to_float(snmp_get(host, 161, user, auth_pass, priv_pass,
                                           auth_proto, priv_proto, timeout, retries,
                                           oid_fmt(oid_actual_power))) if oid_actual_power else None

            pwr_max = to_float(snmp_get(host, 161, user, auth_pass, priv_pass,
                                        auth_proto, priv_proto, timeout, retries,
                                        oid_fmt(oid_max_power_w))) if oid_max_power_w else None

            # Compute derived values
            voltage_v = system_voltage  # assume ports share the reported system voltage
            current_a = (pwr_actual / voltage_v) if (pwr_actual is not None and voltage_v and voltage_v > 0) else None

            port_payload = {
                "id": mid_id,
                "port": p,
                "status": port_status_from_detection(det_raw),
                #"voltage": fmt_volts(voltage_v) if voltage_v is not None else None,
                #"current": fmt_amps(current_a),
                "power": fmt_watts(pwr_actual),
                "voltage": fmt_volts(voltage_v) if voltage_v is not None else None,
                "maxPower": fmt_watts(pwr_max),
                "class": class_from_code(cls_raw),
            }

            print(topic_port)
            print(json.dumps({k: v for k, v in port_payload.items() if v is not None}, ensure_ascii=False))
            print()


            #Connect once before loop
            mqtt_cfg = defaults.get("mqtt", {})
            client = mqtt_connect(mqtt_cfg)

            #Instead of print(topic_device) / print(json.dumps(...)):
            #mqtt_publish_json(client, topic_device, device_payload)

            #And for ports:
            mqtt_publish_json(client, topic_port, port_payload)

def publish_port_state_after_set(mid_id, port, host, defaults, oids, mqtt_client, value):
    # --- Resolve config pieces we need
    mqtt_cfg = defaults.get("mqtt", {}) or {}
    topic_port = mqtt_cfg.get("topic_port", "midspan/poeport")

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
            snmp_get(host, 161, user, auth_pass, priv_pass,
                     auth_proto, priv_proto, timeout, retries, oid_voltage_dev)
        )

    # --- Read ONLY this port’s values
    det_raw = to_float(snmp_get(host, 161, user, auth_pass, priv_pass,
                                auth_proto, priv_proto, timeout, retries, fmt_oid(oid_detect))) if oid_detect else None

    cls_raw = to_float(snmp_get(host, 161, user, auth_pass, priv_pass,
                                auth_proto, priv_proto, timeout, retries, fmt_oid(oid_class))) if oid_class else None

    pwr_actual = to_float(snmp_get(host, 161, user, auth_pass, priv_pass,
                                   auth_proto, priv_proto, timeout, retries, fmt_oid(oid_actual_power))) if oid_actual_power else None

    pwr_max = to_float(snmp_get(host, 161, user, auth_pass, priv_pass,
                                auth_proto, priv_proto, timeout, retries, fmt_oid(oid_max_power_w))) if oid_max_power_w else None

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


    mqtt_publish_json(mqtt_client, topic_port, payload)



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
            if state not in ("on", "off"):
                print(f"[CTRL] Invalid state '{state}' in payload for {msg.topic}: {payload}")
                return

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
        except Exception as e:
            print(f"[CTRL] Exception handling message on {msg.topic}: {e}", file=sys.stderr)

    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(mqtt_cfg["host"], int(mqtt_cfg.get("port", 1883)), keepalive=60)
    client.loop_start()
    return client

if __name__ == "__main__":
    cfg_path = Path(__file__).parent / "midspan_config.yaml"
    if not cfg_path.exists():
        print(f"Config file not found: {cfg_path}", file=sys.stderr)
        sys.exit(1)

    try:
        cfg = load_config(cfg_path)
    except Exception as e:
        print(f"Failed to load YAML config: {e}", file=sys.stderr)
        sys.exit(1)

    ctrl_client = start_mqtt_control_listener(cfg)

    collect_and_print(cfg)
    time.sleep(10)
