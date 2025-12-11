import React, { useState, useEffect } from "react";
import { Card, Modal, Button, Tag, Tooltip, message } from "antd";
import axios from "axios";

const POEPort = ({ midspanId, portId, portData, togglePort }) => {
    //console.log("MIDSPANID: ", midspanId, " PortID: ", portId);
    const [modalOpen, setModalOpen] = useState(false);
    const [now, setNow] = useState(Date.now());

    const openModal = () => setModalOpen(true);
    const closeModal = () => setModalOpen(false);

    useEffect(() => {
        const interval = setInterval(() => {
            setNow(Date.now());
        }, 10000);
        return () => clearInterval(interval);
    }, []);

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

    const getBackgroundColor = () => {
        const status = portData?.status?.value;

        if (status === "active") {
            return "#dfffd6"; // Green background when status is active
        }

        if (status === "inactive") {
            return "#ffd6d6"; // Light red background when inactive
        }

        if (status === "unconnected"){
            return "#f0f0f0"; 
        }

        const rawPower = portData?.power?.value;
        const numericPower = parseFloat(String(rawPower).replace(/W/i, "").trim());

        //if (!isNaN(numericPower) && numericPower === 0) {
        //    return "#f0f0f0"; // Gray background if power is 0W
        //}

        
        return "#FFFFFF"; // Default white background for unknown status
    };

     const updateData = () => {
        axios.post(`http://10.128.48.5:5000/control/${midspanId}/${portId}/get`)
            .then(() => {
                // Success message
                console.log(`Successfully sent 'get' command to ${midspanId} port ${portId}`);
                message.success(`Sent 'get' command to ${midspanId} port ${portId}`);
            })
            .catch((error) => {
                // Log the error details
                console.error(`Failed to send 'get' command to ${midspanId} port ${portId}`, error);
                message.error(`Failed to send 'get' command to ${midspanId} port ${portId}`);
            });
    };

    return (
        <>
            <Card
                onClick={openModal}
                style={{
                    height: "110px",
                    width: "110px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    textAlign: "center",
                    backgroundColor: getBackgroundColor(),
                    cursor: "pointer"
                }}
            >
                <strong>Port:</strong> {portId}<br />
                <strong>Tile:</strong> {portData?.rpi ?? "N/A"}<br />
            </Card>

            <Modal
                title={`${midspanId} - Port: ${portId} (last updated: ${portData?.last_received ? timeSince(portData.last_received) : 'N/A'})`}
                open={modalOpen}
                onCancel={closeModal}
                footer={null}
            >
                <div>
                    <p><strong>Midspan ID:</strong> {midspanId}</p>
                    <p><strong>Port ID:</strong> {portId}</p>
                    <p><strong>Connected RPI:</strong> {portData?.rpi ?? "N/A"}</p>
                    <p>
                        <strong>Status:</strong>
                        <Tag color={
                            portData?.status?.value === "active" ? "green" :
                                portData?.status?.value === "inactive" ? "red" :
                                    "default"
                        }>
                            {portData?.status?.value ?? "Unknown"}
                        </Tag>
                    </p>
                    <p><strong>Power:</strong> {portData?.power?.value ?? "N/A"}</p>
                    <p><strong>Voltage:</strong> {portData?.voltage?.value ?? "N/A"}</p>
                    <p><strong>Max Power:</strong> {portData?.maxPower?.value ?? "N/A"}</p>
                    <p><strong>Class:</strong> {portData?.class?.value ?? "N/A"}</p>

                    {Object.entries(portData || {}).map(([key, value]) => {
                        if (['rpi', 'power', 'status', 'voltage', 'last_received', 'midspan_id', 'port_id', 'midspan', 'port', 'maxPower', 'class', 'id'].includes(key)) {
                            return null;
                        }
                        return (
                            <Tooltip
                                key={key}
                                title={`Last updated: ${portData.last_received ? timeSince(portData.last_received) : 'N/A'}`}
                                placement="topLeft"
                            >
                                <p><strong>{key}:</strong> {typeof value === "object" && value?.value !== undefined ? value.value : String(value)}</p>
                            </Tooltip>
                        );
                    })}
                    <Button
                        onClick={updateData}
                        style={{ backgroundColor: "lightblue", color: "rgba(1,1,1,1)" }}
                    >
                        Update Data
                    </Button>
                </div>
            </Modal>
        </>
    );
};

export default POEPort;
