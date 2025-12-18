import React from "react";
import { Collapse } from "antd";
import PDUPort from "./PDUport";

const PDUDevice = ({ PDUId, PDUData, ports, togglePort }) => {
    const { Panel } = Collapse;
    //const isOffline = PDUData?.data?.status?.value !== "active";
    //console.log("---- PDUDevice render ----");
    //console.log("PDUId:", PDUId);
    //console.log("PDUData:", PDUData);
    //console.log("deviceVoltage raw:", PDUData?.data?.deviceVoltage);
    //console.log("deviceVoltage value:", PDUData?.data?.deviceVoltage?.value);
    //console.log("parseFloat:", parseFloat(PDUData?.data?.deviceVoltage?.value));
    const voltage = PDUData?.data?.deviceVoltage?.value;
    const voltageValue = parseFloat(voltage);

    const isActive =
        !Number.isNaN(voltageValue) &&
        voltageValue > 0;

    //console.log("isActive:", isActive);



    return (
        <div style={{ marginBottom: "20px", border: "1px solid #ddd", padding: "10px", borderRadius: "8px" }}>
            <h2 style={{ textAlign: "center" }}>
                {PDUId}{" "}
                {isActive
                ? <span style={{ color: "green" }}>✅</span>
                : <span style={{ color: "red" }}>❌</span>}
            </h2>

            <Collapse defaultActiveKey={[]} style={{ width: "auto" }}>
                <Panel header="Device Details" key="1">
                    {PDUData && (
                        <div>
                            {Object.entries(PDUData.data || {}).map(([key, valueObj]) => (
                                <p key={key}><strong>{key}:</strong> {valueObj.value}</p>
                            ))}
                            <p><strong>Last Received:</strong> {new Date(PDUData.last_received).toLocaleString()}</p>
                        </div>
                    )}
                </Panel>
            </Collapse>

            <div>
                <h3>PDU Ports</h3>
                <div style={{ display: "flex", flexWrap: "wrap" }}>
                    {ports && Object.entries(ports).map(([portId, portData]) => (
                        <PDUPort key={portId} PDUId ={PDUId} portId={portId} portData={portData} togglePort={togglePort} />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default PDUDevice;
