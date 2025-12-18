import time
import json
import yaml
from pathlib import Path
from typing import Dict, Any, Optional
import sys

import paho.mqtt.client as mqtt
from pysnmp.hlapi import (
    SnmpEngine,
    CommunityData,
    UdpTransportTarget,
    ContextData,
    ObjectType,
    ObjectIdentity,
    getCmd,
)

# ---------------------------------------------------------
# CONFIG PATH
# ---------------------------------------------------------
cfg_path = Path("/home/pi/TechtileDashboard/pythonBackend/pdu_config.yaml")

BROKER_HOST = "10.128.48.5"
BROKER_PORT = 1883

# ---------------------------------------------------------
# HELPER FUNCTIONS (exact zelfde stijl als midspan_control)
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
    xf = float(x)
    if xf.is_integer():
        return f"{int(xf)}V"
    return f"{xf:.2f}V"

def fmt_amps(x):
    if x is None:
        return None
    xf = float(x)
    return f"{xf:.3f}A" if xf < 10 else f"{xf:.2f}A"

def load_config(path: Path = cfg_path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)

def map_oper_status(n):
    print("status raw:", n)

    try:
        n = int(n)
    except (TypeError, ValueError):
        return "inactive"

    # PDU-specific mapping (gebaseerd op metingen)
    if n == 1:
        return "inactive"
    if n == 2:
        return "active"

    return "inactive"


def mqtt_connect():
    c = mqtt.Client()
    c.connect(BROKER_HOST, BROKER_PORT, keepalive=60)
    c.loop_start()
    return c

def mqtt_publish_json(c, topic, payload):
    print("TEST1")
    payload = {k: v for k, v in payload.items() if v is not None}
    c.publish(topic, json.dumps(payload))

# ---------------------------------------------------------
# SNMP v2 GET (parallel aan snmp_get() in midspan_control, maar v2)
# ---------------------------------------------------------
def snmp_get(host, community, oid, timeout, retries):
    try:
        iterator = getCmd(
            SnmpEngine(),
            CommunityData(community, mpModel=1),      # <-- SNMP v2c
            UdpTransportTarget((host, 161), timeout=timeout, retries=retries),
            ContextData(),
            ObjectType(ObjectIdentity(oid))
        )
        errInd, errStat, errIdx, varBinds = next(iterator)
        if errInd or errStat:
            print(f"SNMP error: {errStat.prettyPrint()}")

            return None
        print("VALUE: " ,str(list(varBinds)[0][1]) )
        return str(list(varBinds)[0][1])
    except Exception as e:
        print(f"SNMP GET error for OID {oid}: {e}")
        return None

# ---------------------------------------------------------
# MAIN COLLECTOR — EXACT ZELFDE STRUCTUUR ALS collectSNMP_and_print()
# ---------------------------------------------------------
def collectSNMP_and_print(cfg):

    defaults = cfg["defaults"]
    pdu_list = cfg.get("pdus", [])

    oids = cfg["oids"]
    dev_oids  = oids.get("device", {})
    port_oids = oids.get("port", {})

    # SNMP config
    snmp_cfg  = defaults["snmp"]
    read_community = snmp_cfg["read_community"]
    write_community = snmp_cfg["write_community"]

    timeout   = float(snmp_cfg["timeout"])
    retries   = int(snmp_cfg["retries"])

    # MQTT topics
    topic_device = defaults["mqtt"]["topic_device"]   # typically: pdu/data
    topic_port   = defaults["mqtt"]["topic_port"]     # typically: pdu/port

    client = mqtt_connect()

    while True:
        for p in pdu_list:
            print("p: ", p)

            pdu_id = p["id"]
            print(pdu_id)
            host   = p["host"]
            nports = int(p.get("number_ports", defaults.get("pdu_ports", 8)))

            # -------------------------
            # DEVICE-LEVEL SNMP VALUES
            # (zelfde als midspan, maar volgens jouw OIDs)
            # -------------------------

            print("OID deviceCurrent: ", dev_oids.get("deviceCurrent"))
            print("OID deviceVoltage: ", dev_oids.get("deviceVoltage"))
            print("OID devicePower: ", dev_oids.get("devicePower"))
            print("OID devicePowerDissipation: ", dev_oids.get("devicePowerDissipation"))

            model = snmp_get(host, read_community, dev_oids.get("modelName"), timeout, retries)
            cur   = to_float(snmp_get(host, read_community, dev_oids.get("deviceCurrent"), timeout, retries))
            volt  = to_float(snmp_get(host, read_community, dev_oids.get("deviceVoltage"), timeout, retries))
            pwr   = to_float(snmp_get(host, read_community, dev_oids.get("devicePower"), timeout, retries))
            diss  = to_float(snmp_get(host, read_community, dev_oids.get("devicePowerDissipation"), timeout, retries))
            vMax  = to_float(snmp_get(host, read_community, dev_oids.get("inputMaxVoltage"), timeout, retries))
            cMax  = to_float(snmp_get(host, read_community, dev_oids.get("inputMaxCurrent"), timeout, retries))
            cap   = to_float(snmp_get(host, read_community, dev_oids.get("powerCapacity"), timeout, retries))
  

            device_payload = {
                "id": pdu_id,
                "modelName": model,
                "deviceCurrent": fmt_amps(cur),
                "deviceVoltage": fmt_volts(volt),
                "devicePower": fmt_watts(pwr),
                "devicePowerDissipation": fmt_watts(diss),
                "inputMaxVoltage": fmt_volts(vMax),
                "inputMaxCurrent": fmt_amps(cMax),
                "powerCapacity": fmt_watts(cap)
            }

            print("device_payload: ", device_payload)

            mqtt_publish_json(client, topic_device, device_payload)

            # -------------------------
            # PORT-LEVEL SNMP VALUES
            # (zelfde onderverdeling als midspan-poorten)
            # -------------------------
            for port in range(1, nports + 1):

                curr_oid   = port_oids.get("current")
                volt_oid   = port_oids.get("voltage")
                power_oid  = port_oids.get("power")
                diss_oid   = port_oids.get("powerDissipation")
                status_oid = port_oids.get("status")

                def fmt_oid(tpl):
                    return None if not tpl else tpl.format(port=port)

                cur = to_float(snmp_get(host, read_community, fmt_oid(curr_oid), timeout, retries))
                vol = to_float(snmp_get(host, read_community, fmt_oid(volt_oid), timeout, retries))
                pwr = to_float(snmp_get(host, read_community, fmt_oid(power_oid), timeout, retries))
                dis = to_float(snmp_get(host, read_community, fmt_oid(diss_oid), timeout, retries))
                stat = map_oper_status(snmp_get(host, read_community, fmt_oid(status_oid), timeout, retries))
             
                port_payload = {
                    "id": pdu_id,
                    "port": port,
                    "status": stat,
                    "current": fmt_amps(cur),
                    "voltage": fmt_volts(vol),
                    "power": fmt_watts(pwr),
                    "powerDissipation": fmt_watts(dis)
                }

                mqtt_publish_json(client, topic_port, port_payload)

        time.sleep(10)   # zelfde cycle timing als midspan, aanpasbaar

# ---------------------------------------------------------
# MAIN
# ---------------------------------------------------------
if __name__ == "__main__":
    if not cfg_path.exists():
        print(f"Config not found: {cfg_path}", file=sys.stderr)
        sys.exit(1)

    cfg = load_config(cfg_path)
    collectSNMP_and_print(cfg)