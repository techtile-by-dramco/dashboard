import React, {useEffect} from "react";
import {Card, Button, Modal, Tag, Tooltip, message} from "antd";
import { useState } from "react";
import {useGraph} from "../Dashboard";
import axios from "axios"; 
import pingRpi from "./PingRpi";

const FRESH_MS = 5 * 60 * 1000; // 5 minutes; tweak if you like

function getRuntimeState(lastReceived, sourceObj) {
  if (!lastReceived) return "empty";
  // Support seconds or milliseconds
  const tsMs = Number(lastReceived) < 1e12 ? Number(lastReceived) * 1000 : Number(lastReceived);
  const age = Date.now() - tsMs;
  if (age > FRESH_MS) return "stale";
  const src = sourceObj?.value;
  if (src === "live") return "live";
  if (src === "db")   return "db";
  return "db";
}

function stateToBackground(state) {
  switch (state) {
    case "live":  return "#dfffd6"; // green-ish
    case "db":    return "#d6ecff"; // blue-ish for "from DB"
    case "stale": return "#fff4d6"; // amber-ish
    case "empty": return "#f0f0f0"; // grey
    default:      return "#f0f0f0";
  }
}

const RpiCell = ({ tile, wallName, updateTile, selectedDisplayField }) => {
    const [modalOpen, setModalOpen] = useState(false);
    const [now, setNow] = useState(Date.now());
    const { showGraphForTile } = useGraph();

    const openModal = () => setModalOpen(true);
    const closeModal = () => setModalOpen(false);

    useEffect(() => {
        const interval = setInterval(() => {
            setNow(Date.now());
        }, 10000); // update every 10 seconds

        return () => clearInterval(interval); // cleanup
    }, []);


    // Get background color based on status
    //const getBackgroundColor = () => {
    //  const runtimeState = getRuntimeState(tile.last_received, tile.data?.source);
    //  if (runtimeState !== "empty") return stateToBackground(runtimeState);

      // fallback to legacy status coloring when we truly have no data yet
    //  switch (tile.status?.value) {
    //    case "working":     return "#dfffd6";
    //    case "faulty":      return "#ffd6d6";
    //    case "deactivated": return "#f0f0f0";
    //    default:            return "#f0f0f0";
    //  }
    //};


   const getBackgroundColor = () => {

    //While DB refresh is running → freeze tiles in last known color
    if (window.__isRefreshing === true) {
        switch (tile.status?.value) {
        case "working":     return "#dfffd6"; // green
        case "faulty":      return "#ffd6d6"; // red
        case "deactivated": return "#f0f0f0"; // grey
        default:            return "#f0f0f0";
        }
    }

    //ORIGINAL logic below this line
    const ts = tile?.last_received
        ? (tile.last_received < 1e12 ? tile.last_received * 1000 : tile.last_received)
        : 0;

    const isFresh = ts && (Date.now() - ts) <= FRESH_MS;

    if (isFresh) {
        switch (tile.status?.value) {
        case "working":     return "#dfffd6"; // green
        case "faulty":      return "#ffd6d6"; // red
        case "deactivated": return "#f0f0f0"; // grey
        default:            return "#f0f0f0";
        }
    }

    const runtimeState = getRuntimeState(tile.last_received, tile.data?.source);
    if (runtimeState !== "empty") {
        return stateToBackground(runtimeState); // stale/yellow logic
    }

    return "#f0f0f0";
    };

      // Get status text for display
    const getStatusText = () => {
        switch (tile.status.value) {
            case "working":
                return "Working";
            case "faulty":
                return "Faulty";
            case "deactivated":
                return "Deactivated";
            default:
                return "Unknown";
        }
    };

    // Handle status change
    const handleStatusChange = (newStatus) => {
        updateTile(tile.id, { status: {value: newStatus, timestamp: Date.now()}});
        closeModal();
    };

    const timeSince = (ts) => {

        if(!ts) return "N/A";

        let timestamp = ts < 1e12 ? ts * 1000 : ts;

        const current = Date.now();

        let  seconds = Math.floor((current - timestamp) / 1000);
        if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''} ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
        const days = Math.floor(hours / 24);
        return `${days} day${days !== 1 ? 's' : ''} ago`;
    };

    const sendControlCommand = async (command) => {
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const verifyOffAfterDelay = async (cleanId, hostname, initialDelayMs = 8000, maxMs = 90000) => {
            await sleep(initialDelayMs);
            const start = Date.now();
            let pingStatus = "faulty";

            while (Date.now() - start < maxMs) {
                try {
                    pingStatus = await pingRpi(hostname); // returns "working" or "faulty"
                    console.log(`[PING] Tile ${cleanId} (${hostname}) -> ${pingStatus}`);
                    if (pingStatus === "working") break; // still up → not actually off
                } catch (e) {
                }
                await sleep(3000);
            }

            if (pingStatus === "working") {
                updateTile(tile.id, { status: { value: "working", timestamp: Date.now() } });
                updateTile(tile.id, { metadata: { ...(tile.metadata || {}), wasShutdown: false, wasPoweredOff: false } });
                message.warning(`Device ${cleanId} is still reachable after ${command}.`);
            } else {
                updateTile(tile.id, { status: { value: "faulty", timestamp: Date.now() } });
                message.success(`Device ${cleanId} confirmed offline after ${command}.`);
            }
        };




        try {
            const cleanId =  tile.id.startsWith("rpi-") ? tile.id.replace(/^rpi-/, ""): tile.id;

            //await axios.post(`http://10.128.48.5:5000/control/${cleanId}/${command}`);
            axios.post(`http://10.128.48.5:5001/control/${cleanId}/${command}`)
            .then(() => message.success(`Sent ${command} to ${cleanId}`))
            .catch(() => message.error(`Failed to send ${command}`));
            //message.success(`Sent ${command} to ${cleanId}`);
            //console.log(`[SEND COMMAND] ${command} to rpi ${cleanId}`);
            const hostname = `rpi-${cleanId}.local`;

            if (command === "shutdown") {
		updateTile(tile.id, {status: {value: "faulty", timestamp: Date.now() }} );
                updateTile(tile.id, {
                    metadata: { ...(tile.metadata || {}), wasShutdown: command === "shutdown", wasPoweredOff: command === "poweroff",
                    },
                });
                (async () => {await verifyOffAfterDelay(cleanId, hostname, 8000, 90000);
                })();
                return;
            }


            if (command === "reboot") {
                const hostname = `rpi-${cleanId}.local`;
                const sleep = (ms) => new Promise(res=>setTimeout(res,ms));

                (async () => {
                    await sleep(8000);
                    const start = Date.now();
                    let pingStatus = "faulty";

                    while (Date.now() - start < 120000) {
                        pingStatus = await pingRpi(hostname);
                        console.log(`[PING] Tile ${cleanId} (${hostname})-> result: ${pingStatus}`);
                        if (pingStatus === "working") break;
                        await sleep(3000);
                    }

                    updateTile(tile.id, {status: {value:pingStatus, timestamp: Date.now() } });
                    updateTile(tile.id, { metadata: { ...(tile.metadata || {}), wasShutdown: false } });
                })();
            }

        } catch (err) {
            console.error(err);
            message.error(`Failed to send ${command} to ${tile.id}`);
            updateTile(tile.id, {status: {value: "faulty", timestamp: Date.now() } } );
        }
    };

    return (
        <>
            <Card
                onClick={openModal}
                style={{
                    background: getBackgroundColor(),
                    maxWidth: "120px",
                    maxHeight: "120px",
                    textAlign: "center",
                    cursor: "pointer"
                }}
            >
                {tile.id} ({tile.data?.[selectedDisplayField]?.value ?? "N/A"}{selectedDisplayField === "cpuTemp" ? "°" : ""})
            </Card>
            <Modal
                title={`Tile: ${tile.id} (last updated ${timeSince(tile.last_received)})`}
                open={modalOpen}
                onCancel={closeModal}
                footer={null}
            >
                <div>
                    <p>Walls: {tile.walls?.join(", ")}</p>
                    <p>Segments: {tile.segments?.join(", ")}</p>
                    <p>Tile ID: {tile.id}</p>
                    <p>
                        Status: <Tag color={
                        tile.status.value === "working" ? "green" :
                            tile.status.value === "faulty" ? "red" :
                                "default"
                    }>
                        {getStatusText()}
                    </Tag>
                    </p>
                    {Object.entries(tile.data).map(([key, value]) => (
                        <Tooltip
                            key={key}
                            title={`Last updated: ${timeSince(value.timestamp)}`}
                            placement="topLeft"
                        >
                            <p>{key}: {value.value}</p>
                        </Tooltip>
                    ))}

                    {tile.metadata && Object.keys(tile.metadata).length > 0 && (
                        <p>Metadata: {JSON.stringify(tile.metadata)}</p>
                    )}


                   <div style={{ display: "flex", gap: "10px", marginTop: "15px" }}>
                    <Button
                        onClick={() => sendControlCommand("reboot")}
                        style={{ backgroundColor: "rgba(175, 169, 120, 0.4)", color: "#948713" }} 
                    >
                        Reboot
                    </Button>

                    <Button
                        onClick={() => sendControlCommand("shutdown")}
                        style={{ backgroundColor: "rgba(209, 168, 106, 0.4)", color: "#945313" }}
                    >
                        Shutdown
                    </Button>
                    
                    <Button
                        style={{ backgroundColor: "rgba(90, 122, 75, 0.4)", color: "#276709" }}
                        onClick={() => sendControlCommand("poweron")}
                    >
                        Power on
                    </Button>

                    <Button
                        onClick={() => sendControlCommand("poweroff")}
                        style={{ backgroundColor: "rgba(209, 108, 106, 0.4)", color: "#941313" }}
                    >
                        Power off
                    </Button>
                </div>

                <div style={{ display: "flex", gap: "10px", marginTop: "10px", flexWrap: "wrap" }}>
                    <Button
                        onClick={async() => {
                            const hostname = `rpi-${tile.id}.local`;
                            const pingStatus = await pingRpi(hostname);
                            console.log(`[PING] Tile ${tile.id} (${hostname})-> result: ${pingStatus}`);
                            if (pingStatus === "working"){
                                message.success(`Ping to ${hostname} successful`);
                            } else {
                                message.error(`Ping to ${hostname} failed`);
                            }
                            updateTile(tile.id, {status: {value: pingStatus, timestamp: Date.now() } });
                        }}
                        style={{ backgroundColor: "rgba(89, 74, 122, 0.4)", color: "#2d0c7a"}}
                    >
                        Ping RPI
                    </Button>

                    <Button
                        onClick={() => showGraphForTile(tile.id)}
                        style={{ backgroundColor: "rgba(121, 104, 122, 0.4)", color: "#740c7a"}}
                    >
                        Show Graph
                    </Button>
                </div>
                </div>
            </Modal>
        </>
    );
};

export default RpiCell;
