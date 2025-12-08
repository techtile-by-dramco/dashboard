//import axios from "axios";

//const pingRpi = async (hostname) => {
//    try {
//        const response = await axios.get(`http://10.128.48.5:5000/ping/${hostname}`);
//        if (response.data.status === 'alive') {
//            return 'working';
//        } else {
//            return 'deactivated';
//        }
//
//    } catch (err) {
//        return 'faulty';
//    }
//};

//export default pingRpi;

// Components/PingRpi.js
import yaml from "js-yaml";

let cachedApiBase = null;

async function getApiBase() {
  if (cachedApiBase !== null) return cachedApiBase;
  try {
    const res = await fetch("/hosts.yaml");
    const text = await res.text();
    const data = yaml.load(text);
    const ip = data?.all?.vars?.api_ip;
    cachedApiBase = ip ? `http://${ip}:5000` : "";
  } catch {
    cachedApiBase = "";
  }
  return cachedApiBase;
}

export default async function pingRpi(hostname) {
  try {
    console.log(`[PING] Attempting to ping RPI with hostname: ${hostname}`);  // Log the hostname being pinged
    const apiBase = await getApiBase();
    const url = apiBase
      ? `${apiBase}/ping/${encodeURIComponent(hostname)}`
      : `/ping/${encodeURIComponent(hostname)}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const j = await res.json();
    // Dashboard expects "working" / "faulty"
    return j?.status === "alive" ? "working" : "faulty";
  } catch {
    return "faulty";
  }
}
