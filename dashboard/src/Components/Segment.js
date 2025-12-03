import React from "react";
import RpiCell from "./RpiCell";
import {Button,message,Switch} from "antd";
import { PoweroffOutlined } from "@ant-design/icons";
import axios from "axios";
import pingRpi from "./PingRpi";

const Segment = ({ segmentLabel, segmentData, updateTile, toggleSegment,selectedDisplayField }) => {
    if (!segmentData || !segmentData.tiles) {
        return <div>Loading {segmentLabel}...</div>;
    }

    const tiles = segmentData.tiles;
    const tileKeys = Object.keys(tiles);


    const getPrefix = (key) => (key.match(/^[^\d]+/)||[''])[0];
    const getNumber = (key) => (key.match(/\d+$/)||[''])[0];
    const isSpecialTile = (key) => !/\d+$/.test(key);

    const cols = [...new Set(tileKeys.filter(key => !isSpecialTile(key)).map(getPrefix))].sort();
    const rows = [...new Set(tileKeys.filter(key => !isSpecialTile(key)).map(getNumber))].sort();
    // Extract unique columns and rows dynamically
    //const cols = [...new Set(tileKeys.map(key => key.charAt(0)))].sort();
    //const rows = [...new Set(tileKeys.map(key => key.slice(1)))].sort();
    const cellsPerRow = Math.max(1, Math.ceil(rows.length / 2 - 1));

    const setSegmentStatus = async (status) => {
        const deviceIds = Object.keys(tiles);

        console.log(`[SEGMENT ACTION] Turn All ${status === "deactivated" ? "Off" : "On"} pressed for segment "${segmentLabel}".`);

        for(const tileId of deviceIds) {
            //updateTile(tileId, { status: {value:status, timestamp: Date.now()}});
            try{
                const command = status === "deactivated" ? "shutdown" : "reboot";
                console.log(`[COMMAND] Sending "${command}" to device "${tileId}" via POST /control/${tileId}/${command}`);
                console.log(`[DEBUG TIME] Sending request to ${tileId} at`, new Date().toISOString()); 
                await axios.post(`http://10.128.48.5:5000/control/${tileId}/${command}`);
                console.log(`[DEBUG TIME TWO] Response from ${tileId} at`, new Date().toISOString());
                message.success(`Sent ${command} to ${tileId}`);
            }catch(error){
                console.error(`Failed to set ${status} for ${tileId}`, error);
                message.error(`Failed ${status} for ${tileId}`);
            }
        }
        setTimeout(async () => {
            const timestamp = Date.now();
            await Promise.allSettled( 
                deviceIds.map(async (tileId) => {
                    const hostname = `rpi-${tileId}.local`;
                    const pingStatus = await pingRpi(hostname);
                    updateTile(tileId, {status: {value: pingStatus, timestamp}});
                }) 
            );
        },10000);
    };

    return (
        <div style={{border: "1px solid #ddd", padding: "10px", borderRadius: "8px"}}>
            <h2 style={{textAlign: "center"}}>{segmentLabel}</h2>

            <div style={{
                textAlign: "center",

                display: "flex",
                justifyContent: "center",
                gap: "10px"
            }}>
                <Button type="primary" onClick={() => setSegmentStatus("working")} style={{backgroundColor: "green"}}>
                    Turn All On
                </Button>
                <Button danger onClick={() => setSegmentStatus("deactivated")}>
                    Turn All Off
                </Button>
            </div>


            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(120px,1fr))",
                    //maxWidth: "48vw",
                    //gridAutoRows: "1fr",
                    gap: "10px",
                    justifyItems: "center",
		    alignItems: "start",
		    marginTop: "20px"
                }}
            >
		{tileKeys
		//	.filter(key => !isSpecialTile(key))
			.sort((a,b) => a.localeCompare(b,undefined, {numeric:true}))
			.map((key) => (
				<RpiCell
					key={key}
					tile={tiles[key]}
					wallName={segmentLabel}
					updateTile={updateTile}
					disabled={!segmentData.active}
					selectedDisplayField={selectedDisplayField}
				/>
			))}
		{/**
                {rows.reduce((result, rowLabel, index) => {
                    if (index % cellsPerRow === 0) {
                        result.push([]);
                    }
                    result[result.length - 1].push(rowLabel);
                    return result;
                }, []).map((rowGroup, groupIndex) => (
                    <React.Fragment key={groupIndex}>
                        {rowGroup.map((rowLabel) => (
                            <React.Fragment key={rowLabel}>
                                {cols.map((colLabel) => {
                                    const tileKey = `${colLabel}${rowLabel}`;
                                    return tiles[tileKey] ? (
                                        <RpiCell
                                            key={tileKey}
                                            tile={tiles[tileKey]}
                                            wallName={segmentLabel}
                                            updateTile={updateTile}
                                            disabled={!segmentData.active} // Disable tiles if inactive
                                            selectedDisplayField={selectedDisplayField}
                                        />
                                    ) : (
                                        <div key={tileKey} style={{height: "40px"}}></div>
                                    );
                               })}
                            </React.Fragment>
                        ))}
                    </React.Fragment>
		))}
		*/}
            </div>
		{/**
	    <div style={{ marginTop: "20px", display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" }}//>
		{tileKeys
			.filter(isSpecialTile)
			.map((key) => (
				<RpiCell
					key={key}
					tile={tiles[key]}
					wallName={segmentLabel}
					updateTile={updateTile}
					disabled ={!segmentData.active}
					selectedDisplayField={selectedDisplayField}
				/>
			))}
		</div>
		*/}
        </div>
    );
};

export default Segment;
