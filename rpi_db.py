import json
import time
import sqlite3
from mqtt_config import client, TOPICS

# === Database Setup ===
conn = sqlite3.connect("/home/pi/rpi_data.db", timeout=5, check_same_thread=False)
#conn.execute("PRAGMA journal_mode=WAL;")     # ensures WAL every time
conn.execute("PRAGMA synchronous=NORMAL;")
conn.execute("PRAGMA busy_timeout=5000;")
cursor = conn.cursor()

# Create a table for each topic based on its name
def sanitize_topic_name(topic):
    return topic.replace("/", "_")  # e.g., rpi/data → rpi_data

def create_table_if_not_exists(table_name, sample_data):
    columns = [f"{key} TEXT" for key in sample_data.keys()]
    columns.append("timestamp INTEGER")
    sql = f"CREATE TABLE IF NOT EXISTS {table_name} ({', '.join(columns)})"
    cursor.execute(sql)
    conn.commit()

# === Dynamic Data Insertion ===
def store_data(topic, data):
    table = sanitize_topic_name(topic)
    create_table_if_not_exists(table, data)

    keys = list(data.keys())
    placeholders = ", ".join(["?"] * (len(keys) + 1))  # +1 for timestamp
    columns = ", ".join(keys + ["timestamp"])
    values = [data.get(k, "") for k in keys] + [int(time.time()*1000)]

    sql = f"INSERT INTO {table} ({columns}) VALUES ({placeholders})"
    cursor.execute(sql, values)
    conn.commit()

# === MQTT Message Handler ===
def on_message(client, userdata, msg):
    try:
        data = json.loads(msg.payload.decode())
        print(f"Received message on {msg.topic}: {data}")
        store_data(msg.topic, data)
    except json.JSONDecodeError:
        print(f"Invalid JSON on {msg.topic}: {msg.payload.decode()}")
    except Exception as e:
        print(f"Error on {msg.topic}: {e}")

# Set message handler
client.on_message = on_message

# === Run MQTT Client ===
if __name__ == "__main__":
    client.loop_forever()
