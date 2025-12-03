import time
import json
import yaml
from pathlib import Path
from pysnmp.hlapi import *
import paho.mqtt.client as mqtt

CONFIG_PATH = Path("/home/pi/TechtileDashboard/pythonBackend/midspan_config.yaml")

BROKER_HOST = "10.128.48.5"
BROKER_PORT = 1883

INTERVAL_S = 30


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
def load_config():
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def mqtt_connect():
    c = mqtt.Client()
    c.connect(BROKER_HOST, BROKER_PORT, keepalive=60)
    c.loop_start()
    return c


def mqtt_publish(client, topic, payload):
    payload_no_none = {k: v for k, v in payload.items() if v is not None}
    client.publish(topic, json.dumps(payload_no_none))


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
def main_loop():

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

        time.sleep(INTERVAL_S)


if __name__ == "__main__":
    main_loop()
