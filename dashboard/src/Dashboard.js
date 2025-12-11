import {useState,useCallback, useReducer, useEffect, useRef, createContext, useContext} from "react";
import { BrowserRouter as Router, Route,Routes, Switch, Link, useLocation } from 'react-router-dom';
import { Layout, Button, message } from "antd";
import { generateMockData } from "./Components/mqttWebSocketListener";
import InfoBar from "./Components/ServerBar";
import Wall from "./Components/Wall";
import ControlPanel from "./Components/ControlPanel";
import Segment from "./Components/Segment";
import DashboardHeader from "./Components/DashboardHeader";
import yaml from "js-yaml";
import pingRpi from './Components/PingRpi';
import GraphPage from "./Components/GraphPage";
import MidspanDevice from "./Components/MidspanDevice";
import PDUDevice from "./Components/PDUdevice";
import Ceiling from './Views/Ceiling';  // Import the Ceiling view
import Floor from './Views/Floor';  // Import the Ceiling view
import WallEast from './Views/WallEast';  // Import the Ceiling view
import WallWest from './Views/WallWest';  // Import the Ceiling view
import axios from "axios"; 



const { Header, Content, Footer } = Layout;

const STALE_MS = 5 * 60 * 1000; // adjust if you like

function getRuntimeState(lastReceived, sourceObj) {
  if (!lastReceived) return "empty";
  const age = Date.now() - Number(lastReceived);
  if (age > STALE_MS) return "stale";
  const src = sourceObj?.value;
  if (src === "live") return "live";
  if (src === "db") return "db";
  return "db";
}

function stateClasses(state) {
  switch (state) {
    case "live":  return "ring-2 ring-green-500";
    case "db":    return "ring-2 ring-blue-400";
    case "stale": return "ring-2 ring-amber-500 opacity-85";
    case "empty": return "opacity-50 grayscale";
    default:      return "";
  }
}

async function fetchHosts() {
    const response = await fetch("/hosts.yaml");
    const text = await response.text();
    return yaml.load(text);
}

// Tiles reducer for state management
const tilesReducer = (state, action) => {
    switch (action.type) {
        case 'UPDATE_TILE':
            const { tileId, updates } = action.payload;
            return {
                ...state,
                [tileId]: {
                    ...state[tileId],
                    ...updates
                }
            };

        case 'BULK_UPDATE_TILES':
            const updatedState = { ...state };
            action.payload.forEach(({ tileId, updates }) => {
                updatedState[tileId] = {
                    ...updatedState[tileId],
                    ...updates
                };
            });
            return updatedState;

        case 'RESET_TILE':
            return {
                ...state,
                [action.payload.tileId]: {
                    ...state[action.payload.tileId],
                    value: 0,
                    metadata: {},
                    status: "working"
                }
            };

        default:
            return state;
    }
};

// Midspan reducer for state management
const midspanReducer = (state, action) => {
    switch (action.type) {
        case 'UPDATE_MIDSPAN':
            const { midspanId, updates } = action.payload;
            return {
                ...state,
                [midspanId]: {
                    ...state[midspanId],
                    ...updates,
                    last_received: Date.now()
                }
            };

        case 'BULK_UPDATE_MIDSPANS':
            const updatedState = { ...state };
            action.payload.forEach(({ midspanId, updates }) => {
                updatedState[midspanId] = {
                    ...updatedState[midspanId],
                    ...updates,
                    last_received: Date.now()
                };
            });
            return updatedState;

        case 'RESET_MIDSPAN':
            return {
                ...state,
                [action.payload.midspanId]: {
                    ...state[action.payload.midspanId],
                    data: {},
                    status: "working"
                }
            };

        default:
            return state;
    }
};

// POE Ports reducer for state management
const poePortsReducer = (state, action) => {
    switch (action.type) {
        case 'UPDATE_POE_PORT':
            const { midspanId, portId, updates } = action.payload;
            //console.log('Updating POE Port with data:', action.payload);  // Add this for debugging

            return {
                ...state,
                [midspanId]: {
                    ...(state[midspanId] || {}),
                    [portId]: {
                        ...state[midspanId]?.[portId],
                        ...updates,
                       last_received: Date.now()
                    }
                }
            };

        case 'BULK_UPDATE_POE_PORTS':
            const updatedState = { ...state };
            action.payload.forEach(({ midspanId, portId, updates }) => {
                if (!updatedState[midspanId]) {
                    updatedState[midspanId] = {};
                }
                updatedState[midspanId][portId] = {
                    ...updatedState[midspanId][portId],
                    ...updates,
                    last_received: Date.now()
                };
            });
            return updatedState;

        case 'INITIALIZE_POE_PORTS': {
          const next = { ...state };
          Object.entries(action.payload || {}).forEach(([mid, ports]) => {
            if (!next[mid]) next[mid] = {};
            Object.entries(ports || {}).forEach(([port, initVals]) => {
              next[mid][port] = {
                ...(next[mid][port] || {}),
                ...initVals
              };
            });
          });
          return next;
        }

        default:
            return state;
    }
};

// PDU reducer for state management
const pduReducer = (state, action) => {
    switch (action.type) {

        case 'UPDATE_PDU_PORT':{
            const { pduId, portId, updates } = action.payload;
            return {
                ...state,
                [pduId]: {
                    ...state[pduId],
                    [portId]: {
                        ...(state[pduId]?.[portId] || {} ),
                        ...updates,
                        last_received: Date.now()
                    }
                }
            };
        }
        case 'UPDATE_PDU':{
            const { pduId, updates } = action.payload;
            return {
                ...state,
                [pduId]: {
                    ...state[pduId],
                    ...updates,
                    last_received: Date.now()
                }
            };
        }

        case 'INITIALIZE_PDU_PORTS':{
            return {
                ...state,
                ...action.payload
            };
        }
        case 'BULK_UPDATE_PDUS':{
            const updatedState = { ...state };
            action.payload.forEach(({ pduId, updates }) => {
                updatedState[pduId] = {
                    ...updatedState[pduId],
                    ...updates,
                    last_received: Date.now()
                };
            });
            return updatedState;
        }
        default:
            return state;
    }
};

const pduPortReducer = (state, action) => {
  switch (action.type) {
    case 'INITIALIZE_PDU_PORTS': {
      // volledige init per PDU, zodat 1..8 altijd zichtbaar zijn
      return { ...state, ...action.payload };
    }
    case 'UPDATE_PDU_PORT': {
      const { pduId, portId, updates } = action.payload;
      return {
        ...state,
        [pduId]: {
          ...state[pduId],
          [portId]: {
            ...state[pduId]?.[portId],
            ...updates,
            last_received: Date.now()
          }
        }
      };
    }
    default:
      return state;
  }
};

// Server reducer for singleton server state
const serverReducer = (state, action) => {
    switch (action.type) {
        case 'UPDATE_SERVER':
            return {
                ...state,
                ...action.payload.updates,
                last_received: Date.now()
            };

        case 'BULK_UPDATE_SERVERS':
            return action.payload.reduce((acc, update) => ({
                ...acc,
                ...update,
                last_received: Date.now()
            }), state);

        default:
            return state;
    }
};

function generateTiles(wallOrSegmentName, cellData) {
    const Tiles = {};
    const now = Date.now();
    Object.keys(cellData).forEach((key) => {
        Tiles[key] = {
            id: key,
            row: key.slice(1),
            col: key.charAt(0),
            value: 0,
            metadata: {},
            data: {},
            status: { value: "unknown", timestamp: null },
            last_received: null,
            walls: new Set(),
            segments: new Set(),
        };
    });
    return Tiles;
}

const Dashboard = ({viewMode, setViewMode}) => {
    const [rpiCells, setRpiCells] = useState({});
    //const [tiles, setTiles] = useState({});
    const [apiBase, setApiBase] = useState("");
    const [midspans, setMidspans] = useState({});
    const [midspanConnections, setMidspanConnections] = useState({});
    const [pduDevices, setPduDevices] = useState({});
    const [wallNames, setWallNames] = useState({});
    const [open, setOpen] = useState(false);
    //const [viewMode, setViewMode] = useState("walls")
    const [visibleItems, setVisibleItems] = useState([]);
    const [rpi_ip, setrpi_ip] = useState("10.128.48.5");
    const [activity, setActivity] = useState(false);
    const [openHeader, setOpenHeader] = useState(false);
    const [showExtra, setShowExtra] = useState(false);
    const [showOnlyFaulty, setShowOnlyFaulty] = useState(false);
    const [selectedTileId, setSelectedTileId] = useState(null);
    const [graphVisible, setGraphVisible] = useState(false);
    const [statusJson, setStatusJson] = useState({
        status: "inactive",
        message: ""
    });
    const [midspanPortCountsState, setMidspanPortCountsState] = useState({});

    const [selectedDisplayField, setSelectedDisplayField] = useState("cpuTemp");
    const [preloadComplete, setPreloadComplete] = useState(false);
    const showGraphForTile = (tileId) => {
        setSelectedTileId(tileId);
        setGraphVisible(true);
    };

    // Initialize all reducers
    const [tiles, dispatchTiles] = useReducer(tilesReducer, {});
    const [midspanData, dispatchMidspan] = useReducer(midspanReducer, {});
    const [poePortsData, dispatchPoePorts] = useReducer(poePortsReducer, {});
    const [pduData, dispatchPdu] = useReducer(pduReducer, {});
    const [pduPortData, dispatchPduPorts] = useReducer(pduPortReducer, {});
    const [serverData, dispatchServer] = useReducer(serverReducer, {});

    const tilesRef = useRef(tiles);
    const midspanDataRef = useRef(midspanData);
    const poePortsDataRef = useRef(poePortsData);
    const pduDataRef = useRef(pduData);
    const pduPortDataRef = useRef(pduPortData);
    const serverDataRef = useRef(serverData);

    const filterTilesByViewMode = () => {
    switch (viewMode) {
      case "ceiling":
        return Object.entries(tiles).filter(([tileId, tileData]) => tileData.walls && tileData.walls.includes('ceiling'));
      case "floor":
        return Object.entries(tiles).filter(([tileId, tileData]) => tileData.walls && tileData.walls.includes('floor'));
      case "wallEast":
        return Object.entries(tiles).filter(([tileId, tileData]) => tileData.walls && tileData.walls.includes('wallEast'));
      case "wallWest":
        return Object.entries(tiles).filter(([tileId, tileData]) => tileData.walls && tileData.walls.includes('wallWest'));
      default:
        return Object.entries(tiles).filter(([tileId, tileData]) => tileData.walls && tileData.walls.includes('wall'));
    }
  };


    /*const [isRefreshingGlobal, setIsRefreshingGlobal] = useState(false);
    useEffect(() => {
      window.__isRefreshing = isRefreshingGlobal;
    }, [isRefreshingGlobal]);


     useEffect(() => {
      if (window.__isRefreshing) return;  

      const filteredTiles = filterTilesByViewMode();
      setVisibleItems(filteredTiles.map(([tileId]) => tileId));
    }, [viewMode, tiles]);*/

   /* useEffect(() => {
      // Mock fetching tiles data or use actual data from state
      setTiles({
        "A1": { walls: ["ceiling", "wallWest"], status: { value: "working" } },
        "A2": { walls: ["ceiling"], status: { value: "faulty" } },
        "B1": { walls: ["floor", "wallEast"], status: { value: "deactivated" } },
      });
    }, []);*/

    useEffect(() => {
        tilesRef.current = tiles;
    }, [tiles]);

    useEffect(() => {
        midspanDataRef.current = midspanData;
    }, [midspanData]);

    useEffect(() => {
        poePortsDataRef.current = poePortsData;
    }, [poePortsData]);

    useEffect(() => {
        pduDataRef.current = pduData;
    }, [pduData]);

    useEffect(() => {
        pduPortDataRef.current = pduPortData;
    }, [pduPortData]);

    useEffect(() => {
        serverDataRef.current = serverData;
    }, [serverData]);



function getRpiFromHosts(midspanId, portId) {
    const rpiId = poePortsDataRef.current[midspanId]?.[portId]?.rpi;

    if (rpiId) {
        return rpiId;
    }
    console.warn(`No RPI found for Midspan: ${midspanId}, Port: ${portId} in poePortsDataRef`);

    for (const [rpiId, entry] of Object.entries(midspanConnections || {})) {
        const mid = entry?.midspan ?? entry?.vars?.midspan;
        const poe = entry?.["poe-port"] ?? entry?.vars?.["poe-port"];

        if (mid === midspanId && String(poe) === String(portId)) {
            return rpiId;
        }
    }
    return null;
}



function applyResults(results) {
  const now = Date.now();
 
  const rpiCache = {};
  const midspanCache = {};
  const poePortCache = {}; // structure: poePortCache[mid][port] = {...}  



   // ---- RPI cache ----
  try {
    const existing = localStorage.getItem("rpiCache");
    if (existing) {
      const items = JSON.parse(existing)?.items || [];
      items.forEach((item) => {
        if (item?.id) rpiCache[item.id] = item;
      });
    }
  } catch (e) {
    console.warn("[cache:RPI] read failed", e);
  }

  // ---- MIDSPAN cache ----
  try {
    const existing = localStorage.getItem("midspanCache");
    if (existing) {
      const items = JSON.parse(existing)?.items || [];
      items.forEach((item) => {
        if (item?.id) midspanCache[item.id] = item;
      });
    }
  } catch (e) {
    console.warn("[cache:MIDSPAN] read failed", e);
  }

  // ---- POE PORT cache ----
  try {
    const existing = localStorage.getItem("poePortCache");
    if (existing) {
      const items = JSON.parse(existing)?.items || [];
      items.forEach((entry) => {
        const { id, port, data } = entry;
        if (!id || !port) return;
        if (!poePortCache[id]) poePortCache[id] = {};
        poePortCache[id][port] = entry;
      });
    }
  } catch (e) {
    console.warn("[cache:POE] read failed", e);
  }


  (results || []).forEach((r) => {
    const row = r.row;
    if (!row) return;

    const id = row.id || row.rpi_id || row.name;
    if (!id) return;

    // --- RPI TILES APPLY RESULTS ---
    if (r.table === "rpi_ping") {
      const now = Date.now(); 
      const raw = String(row.status || "").toLowerCase();
      let mapped = "unknown";

      const dbTs = Number(row.timestamp) || 0;
      const uiTs = tilesRef.current[id]?.last_received ||    0;
   
      if (dbTs && dbTs <= uiTs) {
        return; 
      }

      if (["working", "alive", "up", "online"].includes(raw)) {
        mapped = "working";
      } else if (["down", "faulty", "error", "unreachable"].includes(raw)) {
        mapped = "faulty";
      }
      
      const last_received = now;

      updateTile(id, {
        status: { value: mapped, timestamp: now },
        last_received: Date.now(),
      });

      rpiCache[id] = {
        id,
        status: {
          value: mapped || "faulty",
          timestamp: now,
        },
        last_received: last_received || now,
      };
      return;
    }

    // --- MIDSPAN APPLY RESULTS ---
    if (r.table === "midspan_data") {
      const dbTs = Number(row.timestamp) || 0;
      const uiTs = midspanDataRef.current[id]?.last_received ||    0;
      //console.log("[PRINTED midsp: ", id,  " - TIME dbTs]: ", dbTs); 
      //console.log("[PRINTED midsp:  ", id,  " - TIME uiTs]: ", uiTs);
      if (dbTs && dbTs <= uiTs) {
        return; 
      }
      
      const devicePayload = {id,
      data: {
        totalPowerConsumption: { value: row.totalPowerConsumption, timestamp: now },
        maxAvailablePowerBudget: { value: row.maxAvailablePowerBudget, timestamp: now },
        systemVoltage: { value: row.systemVoltage, timestamp: now },
        temperature: { value: row.temperature, timestamp: now },
        status: { value: row.status, timestamp: now },
        source: { value: "db", timestamp: now }
      },
      last_received: now
    };

      updateMidspan(id, devicePayload);
      midspanCache[id] = devicePayload;
      return;
    }



    // --- MIDSPAN POEPORTS APPLY RESULTS---
    if (r.table === "midspan_poeport") {
      const mid = r.midspanId;
      const port = row.port;
      if (!port) return;             

      const now  = Date.now();
      const dbTs = Number(row.timestamp) || 0; 
      const uiTs = poePortsDataRef.current[mid]?.[port]?.last_received || 0;
      //console.log("[PRINTED poeport: ", mid, " - ", port,  " - TIME dbTs]: ", dbTs); 
      //console.log("[PRINTED poeport:  ", mid, " - ", port,  " - TIME uiTs]: ", uiTs);

      if (dbTs && dbTs <= uiTs) {   
        const existing = poePortsDataRef.current[mid]?.[port];
        
        if (!existing?.rpi) {
             updatePoePort(mid, port, {
                rpi: getRpiFromHosts(mid, port)
                ?? poePortsDataRef.current[mid]?.[port]?.rpi 
                ?? null
            });
         }

        return;  
      }

       const update = {
            status:  { value: row.status || "inactive", timestamp: now },
            power:   { value: row.power ?? null, timestamp: now },
            maxPower:{ value: row.maxPower ?? null, timestamp: now },
            voltage: { value: row.voltage ?? null, timestamp: now },
            class:   { value: row.class ?? null, timestamp: now },
            //rpi: row.rpi ?? poePortsDataRef.current[mid]?.[port]?.rpi ?? null,
            //rpi: getRpiFromHosts(mid, port),
            rpi: getRpiFromHosts(mid, port) 
            ?? poePortsDataRef.current[mid]?.[port]?.rpi 
            ?? null,
            source: { value: "db", timestamp: now },
            last_received: now
          };
 

          updatePoePort(mid, port, update);

          if (!poePortCache[mid]) poePortCache[mid] = {};
          poePortCache[mid][port] = { id: mid, port, data: update };
          return;
        }
      });

  try {
    localStorage.setItem(
      "rpiCache",
      JSON.stringify({ ts: now, items: Object.values(rpiCache) })
    );
  } catch (e) {
    console.warn("[cache:RPI] write failed", e);
  }


 try {
    localStorage.setItem(
      "midspanCache",
      JSON.stringify({ ts: now, items: Object.values(midspanCache) })
    );
  } catch (e) {
    console.warn("[cache:MIDSPAN] write failed", e);
  }


try {
    const flat = [];
    Object.entries(poePortCache).forEach(([mid, ports]) => {
      Object.values(ports).forEach((entry) => flat.push(entry));
    });
    localStorage.setItem(
      "poePortCache",
      JSON.stringify({ ts: now, items: flat })
    );
  } catch (e) {
    console.warn("[cache:POE] write failed", e);
  }


}
/*async function preloadEverythingFromDb12({
  rpiIds = [],
  midspanIds = [],
  pduIds = [],
  portCounts = {},       // ✔ ADD THIS
  poePortCount = 24,     // fallback
  pduPortCount = 8,
  apiBase = "",
}) {
  try {
    const base = apiBase && apiBase.length > 0
      ? apiBase
      : "http://10.128.48.5:5000";

    // ----------- Build DB batch queries -----------
    const queries = [];

    // --- RPI ping ---
    rpiIds.forEach(id => {
      queries.push({
        table: "rpi_ping",
        filters: { id }
      });
    });

    // --- Midspan device rows ---
    midspanIds.forEach(id => {
      queries.push({
        table: "midspan_data",
        filters: { id }
      });
    });

    // --- Midspan port rows (per port) ---
    midspanIds.forEach(id => {
      const count = (portCounts && portCounts[mid]) || poePortCount;
      for (let port = 1; port <= count; port++) {
        queries.push({
          table: "midspan_poeport",
          filters: { id, port: String(port) }
        });
      }
    });


    // ----------- Perform batch DB request -----------
    console.warn("[preload] sending batch query", queries.length);
    const url = base + "/db/latest/batch";

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries })
    });

    const results = await response.json();
    console.warn("[preload] batch results received:", results.length);

    // ----------- Apply the results -----------
    applyResults(results);

  } catch (err) {
    console.error("[preload] ERROR:", err);
  }
}

*/
async function preloadEverythingFromDb({
  rpiIds = [],
  midspanIds = [],
  pduIds = [],
  portCounts = {},       // ✔ ADD THIS
  poePortCount = 24,     // fallback
  pduPortCount = 8,
  apiBase = "",
}) {
  try {
    const base = apiBase && apiBase.length > 0 ? apiBase : "http://10.128.48.5:5000";
    const allResults = [];
    const RpiRequests = [];
    const batchRequests = [];


     // Start measuring time
    const startTime = Date.now();

    // ------------------- 1) Fetch All RPIs in a single batch -------------------
    const url = base + `/db/latest/batch`;

    const queries = rpiIds.map(id => ({
      table: "rpi_ping",
      filters: { id }
    }));

    const requestDuration = Date.now() - startTime;
    console.log(`[TIME 1] Fetch RPI batch request took ${requestDuration}ms`);

    // Start timing for the request
    const requestStartTime2 = Date.now();

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries })
    });

    const requestDuration2 = Date.now() - requestStartTime2;
    console.log(`[TIME 2] Fetch RPI batch request took ${requestDuration2}ms`);
    const requestStartTime3 = Date.now();

    const batchResults = await response.json();
    if (batchResults && batchResults.results && Array.isArray(batchResults.results)) {
        batchResults.results.forEach(result => {
            if (result?.row) {
                applyResults([result]);
            }
        });
    } else {
        console.error("Invalid response format:", batchResults);
    }

    const requestDuration3 = Date.now() - requestStartTime3;
    console.log(`[TIME 3] Fetch RPI batch request took ${requestDuration3}ms`);
    




    // ------------------- 2) Fetch Midspan devices individually -------------------
    /*for (const mid of midspanIds) {
      try {
        let url = `${base}/db/latest?table=midspan_data&id=${encodeURIComponent(mid)}`;
        console.log("[preload] starting fetch for midspan:", mid, "url:", url);
        let resp = await fetch(url);
        console.log("[preload] fetch completed for midspan:", mid, "status:", resp.status);
        let row = await resp.json();
        console.log("[preload] raw response text for midspan:", mid, row);


        // fallback if row missing
        if (!row) {
          url = `${base}/db/latest?table=midspan_data&id=${encodeURIComponent(mid)}&port=`;
          resp = await fetch(url);
          row = await resp.json();
        }

        const midspanData = {
          id: row.id,
          totalPowerConsumption: row.totalPowerConsumption || "N/A",
          maxAvailablePowerBudget: row.maxAvailablePowerBudget || "N/A",
          systemVoltage: row.systemVoltage || "N/A",
          temperature: row.temperature || "N/A",
          status: row.status || "inactive", // Default to inactive if status is missing
        };

        if (row)
          //allResults.push({ table: "midspan_data", row: midspanData });
          applyResults([{table: "midspan_data", row: midspanData }]);
          console.log("[ApplyResults] for midspan data", midspanData);
        } catch (e) {
          console.warn("[preload] midspan GET failed for", mid, e);
      }
    }
 
    // ------------------- 3) Fetch PoE ports per midspan -------------------
    for (const mid of midspanIds) {
     const MidspanResults = [];
     const count = portCounts[mid] || poePortCount;
     for (let port = 1; port <= count; port++) {        try {
          const p = new URLSearchParams({ id: mid, port: String(port) });
          const url = `${base}/db/latest?table=midspan_poeport&${p.toString()}`;
          //console.log("[preload] starting fetch for midspan-poeport:", mid, port, "url:", url);
          const resp = await fetch(url);
          console.log("[preload] fetch completed for midspan-poeport:", mid,port, "status:", resp.status);
          const row = await resp.json();
          //console.log("[preload] raw response text for midspan-poeport:", mid, port, row);
          if (row) MidspanResults.push({ table: "midspan_poeport", row, midspanId: mid });
        } catch (e) {
          console.warn(`[preload] PoE port GET failed for midspan ${mid}, port ${port}`, e);
        }
       }
    console.log("[preload] midspan ", mid, " results fetched:", MidspanResults);
    applyResults(MidspanResults); 
    }*/

    // ------------------- 2 & 3 Midspans and PDU ports -----------------
    for (const mid of midspanIds) {
        try {
            // Fetch midspan data
            let url = `${base}/db/latest?table=midspan_data&id=${encodeURIComponent(mid)}`;
            //console.log("[preload] starting fetch for midspan:", mid, "url:", url);
            let resp = await fetch(url);
            //console.log("[preload] fetch completed for midspan:", mid, "status:", resp.status);
            let row = await resp.json();
            //console.log("[preload] raw response text for midspan:", mid, row);

            // Fallback if row is missing
            if (!row) {
                url = `${base}/db/latest?table=midspan_data&id=${encodeURIComponent(mid)}&port=`;
                resp = await fetch(url);
                row = await resp.json();
            }

            // Construct midspan data to apply
            const midspanData = {
                id: row.id,
                totalPowerConsumption: row.totalPowerConsumption || "N/A",
                maxAvailablePowerBudget: row.maxAvailablePowerBudget || "N/A",
                systemVoltage: row.systemVoltage || "N/A",
                temperature: row.temperature || "N/A",
                status: row.status || "inactive", // Default to "inactive" if no status is found
                timestamp: row.timestamp || "N/A",
            };

            // Apply results for the midspan data immediately
            if (row) {
                applyResults([{ table: "midspan_data", row: midspanData }]);
                //console.log("[ApplyResults] for midspan data", midspanData);
            }

        } catch (e) {
            console.warn("[preload] midspan GET failed for", mid, e);
        }

        // ------------------- 2) Fetch PoE ports per midspan -------------------
        const count = portCounts[mid] || poePortCount;  // Get the number of ports for the current midspan

        // Fetch data for each PoE port of the current midspan, one by one
        for (let port = 1; port <= count; port++) {
            try {
                const p = new URLSearchParams({ id: mid, port: String(port) });
                const url = `${base}/db/latest?table=midspan_poeport&${p.toString()}`;

                //console.log("[preload] starting fetch for midspan-poeport:", mid, port, "url:", url);
                const resp = await fetch(url);
                //console.log("[preload] fetch completed for midspan-poeport:", mid, port, "status:", resp.status);
                const row = await resp.json();

                // Log the raw response if needed
                //console.log("[preload] raw response text for midspan-poeport:", mid, port, row);

                // If data is available, apply results for the current PoE port immediately
                if (row) {
                    applyResults([{ table: "midspan_poeport", row, midspanId: mid }]);
                    //console.log(`[ApplyResults] for midspan ${mid}, port ${port}`);
                }

            } catch (e) {
                console.warn(`[preload] PoE port GET failed for midspan ${mid}, port ${port}`, e);
            }
        }
    }

    console.log("[preload] All midspans and PoE ports processed.");

    // ------------------- 4) Fetch PDUs individually -------------------
    //for (const pdu of (pduIds || [])) {
    //  try {
    //    const url = `${base}/db/latest?table=pdu_data&pdu_id=${encodeURIComponent(pdu)}`;
    //    const resp = await fetch(url);
    //    const row = await resp.json();
    //    if (row) allResults.push({ table: "pdu_runtime", row });
    //  } catch (e) {
    //    console.warn("[preload] PDU GET failed for", pdu, e);
    //  }
    //}

    // ------------------- 5) Apply results -------------------
    //console.log("[preload] total results fetched:", allResults.length);
    //console.log("[preload] total results fetched:", allResults); 
   //applyResults(allResults);

  } catch (err) {
    console.error("[preload] ERROR:", err);
  }
}


/*
async function preloadEverythingFromDb1({
  rpiIds = [],
  apiBase = "",
}) {
  try {
    const base = apiBase && apiBase.length > 0 
      ? apiBase 
      : "http://10.128.48.5:5000";

    const requests = [];

    // --- ONLY RPI ping rows (original logic) ---
    (rpiIds || []).forEach((id) => {
      const url = base + `/db/latest?table=rpi_ping&id=${encodeURIComponent(id)}`;
      console.warn("[preload rpi] GET", url);
      requests.push(
        fetch(url)
          .then(resp => resp.json())
          .then(row => ({ table: "rpi_ping", row, id }))
          .catch(err => {
            console.warn("[preload rpi] failed for", id, err);
            return null;
          })
      );
    });

    const results = (await Promise.all(requests)).filter(Boolean);
    console.log("[preload rpi] done, results =", results.length);
    applyResults(results);

  } catch (err) {
    console.error("[preload rpi] ERROR:", err);
  }
}
*/
/*
async function preloadEverythingFromDb2({ rpiIds, midspanIds, pduIds, poePortCount = 8, pduPortCount = 8, apiBase ="" }) {
        // POST a small slice of queries and return its results
        async function postBatch(url, chunk, signal) {
        const t0 = performance.now();
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queries: chunk }), 
          signal
        });
        const json = await res.json();
        console.log("[DB preload] chunk", chunk.length, "returned", res.status, res.ok, "in", Math.round(performance.now() - t0), "ms");
        return json?.results || [];
      }

function applyResults2(results) {
  const now = Date.now();
  (results || []).forEach(r => {
    const row = r.row;
    if (!row) return;
    const ts = (Number(row.timestamp) || 0) * 1000 || now;

    switch (r.table) {

      case "rpi_ping": {
        console.warn("### DEBUG ### applyResults rpi_ping", row);
        const id = row.id;
        const ts = (Number(row.timestamp) || 0) * 1000 || now;
        const raw = String(row.status || "").toLowerCase();
        const mapped = raw === "working" || raw === "alive" ? "working"
                     : raw === "deactivated" ? "deactivated"
                     : "faulty";
        updateTile(id, {
          status: { value: mapped, timestamp: ts },
          last_received: ts
        });
        break;
      }


      case "rpi_data": {
        const id = row.id;
        const existing = (tilesRef.current[id]?.data) || {};
        updateTile(id, {
          data: {
            ...existing,
            cpuLoad:   { value: Number(row.cpuLoad),   timestamp: ts },
            cpuTemp:   { value: Number(row.cpuTemp),   timestamp: ts },
            ram:       { value: Number(row.ram),       timestamp: ts },
            diskUsage: { value: Number(row.diskUsage), timestamp: ts },
            source:    { value: "db", timestamp: ts }
          },
          last_received: ts
        });
        break;
      }

      case "midspan_data": {
        const mid = row.id;
        const port = row.port;
        const updates = {};
        for (const [k, v] of Object.entries(row)) {
          if (!["id","midspan_id","port","timestamp"].includes(k)) {
            updates[k] = { value: v, timestamp: ts };
          }
        }
        if (port != null && `${port}`.trim() !== "") {
          updatePoePort(mid, String(port), {
            ...updates,
            source: { value: "db", timestamp: ts },
            last_received: ts
          });
        } else {
          const existing = (midspanDataRef.current[mid]?.data) || {};
          console.log("[DB preload] midspan_data device row", { mid, updates, raw: row });
          updateMidspan(mid, {
            data: { ...existing, ...updates, source: { value: "db", timestamp: ts } },
            last_received: ts
          });
        }
        break;
      }

      case "midspan_poeport": {
        const mid = row.id;
        const port = String(row.port);
        const updates = {};
        for (const [k, v] of Object.entries(row)) {
          if (!["id","midspan_id","port","timestamp"].includes(k)) {
            updates[k] = { value: v, timestamp: ts };
          }
        }
        console.log("[DB preload] midspan_poeport row received", { mid, port, updates, raw: row });
        updatePoePort(mid, port, {
          ...updates,
          source: { value: "db", timestamp: ts },
          last_received: ts
        });
        break;
      }

      case "pdu_runtime": {
        const pdu = row.pdu_id;
        const existing = (pduDataRef.current[pdu]?.data) || {};
        const kv = Object.fromEntries(
          Object.entries(row)
            .filter(([k]) => !["pdu_id", "timestamp"].includes(k))
            .map(([k, v]) => [k, { value: v, timestamp: ts }])
        );
        updatePdu(pdu, { data: { ...existing, ...kv, source: { value: "db", timestamp: ts } } });
        break;
      }

      case "pdu_ports": {
        const pdu = row.pdu_id;
        const port = row.port;
        const updates = {};
        Object.entries(row).forEach(([k, v]) => {
          if (!["pdu_id", "port", "timestamp"].includes(k)) {
            updates[k] = { value: v, timestamp: ts };
          }
        });
        updatePduPort(pdu, port, { ...updates, source: { value: "db", timestamp: ts } });
        break;
      }
      default:
        break;
    }
  });
}

        const queries = [];

        // RPis (topic table: rpi_data, filter: id)
        //rpiIds.forEach(id => queries.push({ table: "rpi_data", filters: { id } }));
        rpiIds.forEach(id => {
            queries.push({ table: "rpi_data", filters: { id } });
            queries.push({ table: "rpi_ping", filters: { id } });
        });
        // Midspans device-level (midspan_data with empty port)
        midspanIds.forEach((mid) => {
          queries.push({ table: "midspan_data", filters: { id: mid } }); 
        });
        console.log("[DB preload] queries built:", queries.filter(q => q.table==="midspan_poeport").slice(0,10));

        midspanIds.forEach(mid => {
          for (let port = 1; port <= poePortCount; port++) {
            queries.push({ table: "midspan_poeport", filters: { id: mid, port: String(port) } });
          }
        });

        console.log("[DB preload] queries built (poeport, first 10):",
        queries.filter(q => q.table==="midspan_poeport").slice(0,10));

        pduIds.forEach(pdu => queries.push({ table: "pdu_data", filters: { pdu_id: pdu } }));

        try {
          const url = apiBase ? `${apiBase}/db/latest/batch` : `/db/latest/batch`;
          console.log("[DB preload] url:", url);
          const poeQueries = queries.filter(q => q.table === "midspan_poeport");
          console.log("[DB preload] building queries:", { all: queries.length, poe: poeQueries.length, samplePoe: poeQueries.slice(0, 10) });
          console.log("[DB preload] about to fetch batch test:", url);
          const CHUNK = 50;
          let results = [];
	 let batchWorked = true;
	 for (let i = 0; i < queries.length; i += CHUNK) {
	   const slice = queries.slice(i, i + CHUNK);
           const controller = new AbortController();
	   const timer = setTimeout(() => controller.abort(), 12000); // 4s per chunk
  	   try {
  	     const part = await postBatch(url, slice, controller.signal);
   	     results = results.concat(part);
             applyResults(part);

  	   } catch (e) {
  	     console.warn("[DB preload] chunk timed out/failed at", i, "size", slice.length, e?.name || e);
               batchWorked = false;
               break; // stop trying more chunks
             } finally {
               clearTimeout(timer);
             }
           }
           batchWorked = false;
if (!batchWorked) {
  console.warn("### DEBUG ### ENTERED FALLBACK BLOCK");
  console.warn("### DEBUG ### rpiIds =", rpiIds);
  console.warn("### DEBUG ### poeQueries =", poeQueries);
  // 1) midspan device rows (midspan_data) per midspanId
  for (const mid of midspanIds) {
    try {
      // try without port first
      let urlDev = `${apiBase ? apiBase : ""}/db/latest?table=midspan_data&id=${encodeURIComponent(mid)}`;
      let resp = await fetch(urlDev);
      let row = await resp.json();

      // if null, also try explicit empty port (covers DBs that store "" in 'port')
      if (!row) {
        urlDev = `${apiBase ? apiBase : ""}/db/latest?table=midspan_data&id=${encodeURIComponent(mid)}&port=`;
        resp = await fetch(urlDev);
        row = await resp.json();
      }

      console.log("[DB preload] single GET midspan_data", { id: mid }, "→", resp.status);
      applyResults([{ table: "midspan_data", row }]);
    } catch (e) {
      console.warn("[DB preload] single GET midspan_data failed for", mid, e);
    }
  }

  // 2) PoE ports (what you already had)
  for (const q of poeQueries) {
    try {
      const p = new URLSearchParams(q.filters);
      const getUrl = `${apiBase ? apiBase : ""}/db/latest?table=midspan_poeport&${p.toString()}`;
      const t0 = performance.now();
      const r = await fetch(getUrl);
      const row = await r.json();
      console.log("[DB preload] single GET midspan_poeport", q.filters, "→", r.status, "in", Math.round(performance.now()-t0), "ms");
      applyResults([{ table: "midspan_poeport", row }]);
    } catch (e) {
      console.warn("[DB preload] single GET midspan_poeport failed for", q.filters, e);
    }
  }

  for (const id of rpiIds) {
    try {
      console.warn("### DEBUG ### requesting rpi_ping for", id);
      const urlPing = `${apiBase ? apiBase : ""}/db/latest?table=rpi_ping&id=${encodeURIComponent(id)}`;
      const resp = await fetch(urlPing);
      const row = await resp.json();
      console.log("[DB preload] single GET rpi_ping", { id }, "→", resp.status);
      applyResults([{ table: "rpi_ping", row }]);
    } catch (e) {
      console.warn("[DB preload] single GET rpi_ping failed for", id, e);
    }
  }
}

          const poeResults = (results || []).filter(r => r.table === "midspan_poeport");
          const poeNonNull = poeResults.filter(r => r.row);
          const poeErrors  = poeResults.filter(r => r.error);
          console.log("[DB preload] results summary:", {
            total: results?.length,
            poe: poeResults.length,
            poeNonNull: poeNonNull.length,
            poeErrorsSample: poeErrors.slice(0, 3)
            });
            if (poeNonNull[0]) {
              console.log("[DB preload] first non-null poe row:", poeNonNull[0]);
            }

          try {
            const testMid  = (poeResults[0]?.filters?.id)   || "midspan-001";
            const testPort = (poeResults[0]?.filters?.port) || "5";
            const testUrl  = `${apiBase ? apiBase : ""}/db/latest?table=midspan_poeport&id=${encodeURIComponent(testMid)}&port=${encodeURIComponent(testPort)}`;
            const testRes  = await fetch(testUrl);
            const testJson = await testRes.json();
            console.log("[DB preload] direct GET test:", { url: testUrl, json: testJson });
            } catch (e) {
              console.warn("[DB preload] direct GET test failed:", e);
            }

          console.log("[DB preload] finished, current poePortsData:", poePortsDataRef.current);
        } catch (e) {
          console.warn("DB preload failed", e);
        }
      }*/

const normalizeTileId = (id) => {
        const match = id.match(/^([A-Z])(\d+)$/i);
        if (!match) return id;

        const [, letter, number] = match;
        return `${letter.toUpperCase()}${number.padStart(2, "0")}`;
    };

const getTilesByCategory = (categoryType, filterFn = () => true) => {
        const categorizedTiles = {};

        Object.entries(tiles).forEach(([tileId, tileData]) => {
            if (!filterFn(tileData)) return;

            let parents =
              categoryType === "walls" ? tileData.walls : tileData.segments;

              if (!parents) parents = [];
              if (parents instanceof Set) {
                parents = Array.from(parents);
              }
              parents.forEach((parent) => {
                if (!categorizedTiles[parent]) categorizedTiles[parent] = { tiles: {} };
                categorizedTiles[parent].tiles[tileId] = tileData;
            });
        });

        return Object.keys(categorizedTiles).sort().reduce((acc, key) => {
            acc[key] = categorizedTiles[key];
            return acc;
        }, {});
    };

    const walls = getTilesByCategory("walls", showOnlyFaulty ? (tile) => tile.status?.value === "faulty" : undefined);
    const segments = getTilesByCategory("segments", showOnlyFaulty ? (tile) => tile.status?.value === "faulty" : undefined);
    const faultyCount = Object.values(tiles).filter(tile => tile.status?.value === "faulty").length;
    const testWallTiles = Object.values(tiles).filter(tile => (
               (viewMode === "walls" && tile.segments?.includes("tests")) ||
	       (viewMode === "segments" && tile.segments?.includes("tests")))
               && (!showOnlyFaulty || tile.status?.value === "faulty" )
    );



    useEffect(() => {
        fetchHosts()
            .then(async (data) => {
                if (!data || !data.all) return;
                const ipFromYaml = data?.all?.vars?.api_ip;
                if (ipFromYaml) {
                    setrpi_ip(ipFromYaml);
                }
                const apiBaseStr = ipFromYaml ? `http://${ipFromYaml}:5000` : "";
                setApiBase(apiBaseStr);
                const allCells = {};
                const midspanConfig = data.all.vars.midspans;

                const midspanPortCounts = {};
                for (const [midId, cfg] of Object.entries(midspanConfig || {})) {
                    midspanPortCounts[midId] = cfg["nr-ports"] || 24;
                }
                setMidspanPortCountsState(midspanPortCounts);
                const midspanConnectionsConfig = {};
                const hostsFlat = data?.all?.hosts || {};
                Object.entries(hostsFlat).forEach(([rpiId, rpiObj]) => {
                  midspanConnectionsConfig[rpiId] = rpiObj;
                });

                console.log("[hosts] api_ip:", data?.all?.vars?.api_ip);
                console.log("[hosts] rpi keys:", Object.keys(midspanConnectionsConfig || {}));
                // peek at up to 3 host entries to see the shape (flat vs nested under vars)
                Object.entries(midspanConnectionsConfig || {})
                  .slice(0, 3)
                  .forEach(([rpiId, rpiData]) => {
                    console.log("[hosts] sample", rpiId, {
                      topLevelKeys: Object.keys(rpiData || {}),
                      poeTop: rpiData?.["poe-port"],
                      midspanTop: rpiData?.["midspan"],
                      poeVars: rpiData?.vars?.["poe-port"],
                      midspanVars: rpiData?.vars?.["midspan"],
                    });
                  });




                const fetchedWallNames = data.all.children.rpis.children;

                // Initialize PoE ports from hosts so each port has its rpi before DB preload
                const midspanPortsConfig = {};
                /*Object.entries(midspanConnectionsConfig || {}).forEach(([rpiId, rpiData]) => {
                  const poeInfo = rpiData["poe-port"];
                  const midspanInfo = rpiData["midspan"];
                  if (!poeInfo || !midspanInfo) return;

                  if (!midspanPortsConfig[midspanInfo]) midspanPortsConfig[midspanInfo] = {};
                  midspanPortsConfig[midspanInfo][poeInfo] = {
                    power: "N/A",
                    status: "unknown",
                    voltage: "N/A",
                    rpi: rpiId
                  };
                });*/

                Object.entries(midspanConnectionsConfig || {}).forEach(([rpiId, rpiData]) => {
                const poeInfo = rpiData?.["poe-port"] ?? rpiData?.vars?.["poe-port"];
                const midspanInfo = rpiData?.["midspan"]   ?? rpiData?.vars?.["midspan"];
                if (!poeInfo || !midspanInfo) return;

                if (!midspanPortsConfig[midspanInfo]) midspanPortsConfig[midspanInfo] = {};
                midspanPortsConfig[midspanInfo][poeInfo] = {
                  power: "N/A",
                  status: "unknown",
                  voltage: "N/A",
                  rpi: rpiId
                };
              });
                console.log("[midspanPortsConfig] built:", midspanPortsConfig);
                dispatchPoePorts({
                  type: 'INITIALIZE_POE_PORTS',
                  payload: midspanPortsConfig
                });


                // Process walls and segments using the same base cell data
                Object.entries(data.all.children).forEach(([key, cellData]) => {
                    if (!cellData.hosts) return;

                    const newTiles = generateTiles(key, cellData.hosts);

                    Object.entries(newTiles).forEach(([cellKey, cellInfo]) => {
                        if (!allCells[cellKey]) {
                            allCells[cellKey] = { ...cellInfo, walls: new Set(), segments: new Set() };
                        }

                        if (key.startsWith("segment")) {
                            allCells[cellKey].segments.add(key);
                        } else if (key in fetchedWallNames) {
                            allCells[cellKey].walls.add(key);
                        }
                    });
                });

		const testTiles = {};
		if(data.all.children.tests?.hosts) {
			const generatedTest = generateTiles("tests", data.all.children.tests.hosts);
			console.log("generatedTiles output for test:", generatedTest);

			Object.entries(generatedTest).forEach(([tileId, tileData]) => {
				testTiles[tileId] ={
					...tileData,
					walls: ["tests"],
					segments: ["tests"]
				};
			});
		}
		// Add test RPis as a new "test" wall group
		//const testTiles ={};
		//if (data.all.children.test?.hosts) {
		//	Object.entries(generateTiles("test", data.all.children.test.hosts)).forEach(([tileId, tileData]) => {
		//		testTiles[tileId] = {
		//			...tileData,
		//		walls: ["test"],
		//		segments: []
		//		};
		//	});
		//}
                // Convert sets to arrays for easier rendering
                Object.keys(allCells).forEach((cellKey) => {
                    allCells[cellKey].walls = Array.from(allCells[cellKey].walls);
                    allCells[cellKey].segments = Array.from(allCells[cellKey].segments);
                });

                // Initialize the tiles state with the processed cells
                dispatchTiles({
                    type: 'BULK_UPDATE_TILES',
                    payload: Object.entries(allCells).map(([tileId, tileData]) => ({
                        tileId,
                        updates: tileData
                    }))
                });

		dispatchTiles({
			type: 'BULK_UPDATE_TILES', 
			payload: Object.entries(testTiles).map(([tileId, tileData]) => ({
				tileId,
				updates: tileData
			}))
		});

  try {
    const cached = localStorage.getItem("rpiCache");
    if (cached) {
        const parsed = JSON.parse(cached);
        const items = parsed?.items;

        if (Array.isArray(items)) {
            const updatesFromCache = items
                .filter(entry => entry && entry.id)
                .map(entry => {
                    const safeStatus =
                        typeof entry.status === "object" &&
                        entry.status !== null &&
                        typeof entry.status.value === "string"
                            ? entry.status
                            : { value: "faulty", timestamp: Date.now() };

                    const safeLast =
                        typeof entry.last_received === "number"
                            ? entry.last_received
                            : Date.now();

                    return {
                        tileId: entry.id,
                        updates: {
                            status: safeStatus,
                            last_received: safeLast
                        }
                    };
                });

            if (updatesFromCache.length > 0) {
                dispatchTiles({
                    type: "BULK_UPDATE_TILES",
                    payload: updatesFromCache
                });
                console.warn(
                    "[cache] restored",
                    updatesFromCache.length,
                    "tiles from cache after hosts init"
                );
            }
        }
    }
} catch (e) {
    console.error("[cache] failed to restore from localStorage", e);
}

// ---- Restore MIDSPAN cache ----
try {
  const cachedMid = localStorage.getItem("midspanCache");
  if (cachedMid) {
    const parsed = JSON.parse(cachedMid);
    const items = parsed?.items || [];

    items.forEach((entry) => {
      if (!entry.id) return;

      // entry.data is already structured correctly
      updateMidspan(entry.id, {
        data: entry.data,
        last_received: entry.last_received ?? Date.now()
      });
    });

    console.warn(
      `[cache] restored ${items.length} midspan device entries from cache`
    );
  }
} catch (e) {
  console.warn("[cache] failed to restore midspan", e);
}

try {
  /*const cached = localStorage.getItem("poePortCache");
  if (cached) {
    const items = JSON.parse(cached)?.items || [];
    items.forEach((entry) => {
      const { id, port, data } = entry;
      updatePoePort(id, port, data);
    });
    console.warn("[cache] restored", items.length, "poe ports from cache");
  }*/

    const cached = localStorage.getItem("poePortCache");
    if (cached) {
      const items = JSON.parse(cached)?.items || [];
      items.forEach((entry) => {
        const { id, port, data } = entry;
        //const rpiFromHosts = getRpiFromHosts(id, port);
        updatePoePort(id, port, {
          ...data
          // als cache geen rpi had, herstel hem uit hosts of behoud bestaande
          //rpi: data?.rpi ?? rpiFromHosts ?? poePortsDataRef.current[id]?.[port]?.rpi ?? null
        });
      });
      console.warn("[cache] restored", items.length, "poe ports from cache (with rpi fallback)");
    }


} catch (e) {
  console.warn("[cache] failed to restore poe ports", e);
}


                //const pduDevicesConfig = {}
                //const ports = [1, 2, 3, 4, 5];
                //pduDevicesConfig["pdu-001"] = {"ports": ports}
                //pduDevicesConfig["pdu-002"] = {"ports": ports}  // TODO: add ports to PDU's
                const pduDevicesConfig = {};
                const pduRuntimeInit = {};
                const pduPortsInit = {};

                // Example: define static list of PDUs and their ports
                const pduList = [
                    { id: "pdu-001", ports: [1, 2, 3, 4, 5,6,7,8] },
                    { id: "pdu-002", ports: [1, 2, 3, 4, 5,6,7,8] },
                    { id: "pdu-003", ports: [1,2,3,4,5,6,7,8]}
                ];

                pduList.forEach(pdu => {
                    pduDevicesConfig[pdu.id] = { ports: pdu.ports };
                    pduRuntimeInit[pdu.id] = {
                        data: {},
                        last_received: Date.now()
                    };
                    pduPortsInit[pdu.id] = {};
                    pdu.ports.forEach(portNum => {
                        pduPortsInit[pdu.id][portNum] = {
                            status: { value: "unknown", timestamp: Date.now() }
                        };
                    });
                });

                // Dispatch initial PDU states
                dispatchPdu({
                    type: 'BULK_UPDATE_PDUS',
                    payload: Object.entries(pduRuntimeInit).map(([pduId, updates]) => ({
                        pduId,
                        updates
                    }))
                });
                dispatchPduPorts({
                    type: 'INITIALIZE_PDU_PORTS',
                    payload: pduPortsInit
                });

                setRpiCells(allCells);
                setMidspans(midspanConfig);
                setMidspanConnections(midspanConnectionsConfig)
                setWallNames(fetchedWallNames);
                setPduDevices(pduDevicesConfig);


                const rpiIds = [...Object.keys(allCells), ...Object.keys(testTiles)];
                const midspanIds = Object.keys(midspanConfig || {});
                const pduIds = Object.keys(pduDevicesConfig || {});

                console.log("[preload] rpiIds:", rpiIds);
                console.log("[preload] midspanIds:", midspanIds);
                console.log("[preload] apiBase:", apiBaseStr);
                //window.__isRefreshing = true;

                await preloadEverythingFromDb({
                    rpiIds,
                    midspanIds,
                    pduIds,
                    portCounts: midspanPortCounts,     
                    poePortCount: 24,                                    
                    pduPortCount: 8,
                    apiBase: apiBaseStr
                });
                setPreloadComplete(true);
            })
            .catch((error) => console.error("Failed to load hosts.yaml:", error));
    }, []);


    useEffect(() => {
        if (visibleItems.length === 0) {
            const newItems = viewMode === "walls" ? Object.keys(walls) : Object.keys(segments);
            setVisibleItems(newItems);
        }
    }, [viewMode, walls, segments]);

    // Tile update functions
    const updateTile = (tileId, updates) => {
        dispatchTiles({
            type: 'UPDATE_TILE',
            payload: { tileId, updates }
        });

    };

    const bulkUpdateTiles = (updates) => {
        dispatchTiles({
            type: 'BULK_UPDATE_TILES',
            payload: updates
        });
        message.success(`Bulk updated ${updates.length} tiles`);
    };

    const resetTile = (tileId) => {
        dispatchTiles({
            type: 'RESET_TILE',
            payload: { tileId }
        });
        message.info(`Reset tile ${tileId}`);
    };

    const togglePort = () => {
        //todo add toggleport logic
    }

    // Midspan update functions
    const updateMidspan = (midspanId, updates) => {
        dispatchMidspan({
            type: 'UPDATE_MIDSPAN',
            payload: { midspanId, updates }
        });
    };

    const updatePduPort = (pduId, portId, updates) => {
        dispatchPduPorts({
            type: 'UPDATE_PDU_PORT',
            payload: { pduId, portId, updates }
        });
    };

    // POE Port update functions
    const updatePoePort = (midspanId, portId, updates) => {
        dispatchPoePorts({
            type: 'UPDATE_POE_PORT',
            payload: { midspanId, portId, updates }
        });
    };

    // PDU update functions
    const updatePdu = (pduId, updates) => {
        dispatchPdu({
            type: 'UPDATE_PDU',
            payload: { pduId, updates }
        });
    };

    // Server update functions
    const updateServer = (updates) => {
        dispatchServer({
            type: 'UPDATE_SERVER',
            payload: { updates }
        });
    };

    





    // Debug functions for testing
    const debugFunctions = {
        reactivateAllTiles: () => {
            const updates = Object.keys(tiles).map(tileId => ({
                tileId,
                updates: { status: "working" }
            }));
            bulkUpdateTiles(updates);
        },
        setAllFaulty: () => {
            const updates = Object.keys(tiles).map(tileId => ({
                tileId,
                updates: { status: "faulty" }
            }));
            bulkUpdateTiles(updates);
        },
        setAllDeactivated: () => {
            const updates = Object.keys(tiles).map(tileId => ({
                tileId,
                updates: { status: "deactivated" }
            }));
            bulkUpdateTiles(updates);
        }
    };

    const isPingingRef = useRef(false);

    const pingAllRpis = async () => {
        if (isPingingRef.current) return;
        isPingingRef.current = true;
        console.log(pduPortData)
        const timestamp = Date.now();
        const tiles = tilesRef.current;

        try {
            const pingResults = await Promise.allSettled(
                Object.keys(tiles).map(async (id) => {
                    const hostname = `rpi-${id}.local`;
                    const status = await pingRpi(hostname);
                    console.log(`[PING] Tile ${id} (${hostname}) -> result: ${status}`);
                    updateTile(id, {
                        status: {
                            value: status,
                            timestamp: Date.now()},
                            last_received: Date.now()
                      
                    });
                })
            );

            const failed = pingResults.filter(r => r.status === "rejected");
            if (failed.length) {
                console.warn(`${failed.length} RPis failed to respond`);
            }

        } catch (error) {
            console.error("Unexpected error while pinging RPis:", error);
        } finally {
            isPingingRef.current = false;
        }
    };

    const handleRpiMessage = async (data) => {
        try {
            if (!data || typeof data !== "object") {
                console.warn("Received invalid RPI data:", data);
                return;
            }

            const normalizedId = normalizeTileId(data.id);
            const timestamp = Date.now();
            let metaData = {};

            Object.entries(data).forEach(([dataId, value]) => {
                if (dataId !== "id" && dataId !== "status") {
                    metaData[dataId] = {
                        value,
                        timestamp
                    };
                }
            });

            if (tilesRef.current[normalizedId]) {
                const existingData = tilesRef.current[normalizedId]?.data || {};
                updateTile(normalizedId, {
                    data: {
                        ...existingData,
                        ...metaData,
                        source: { value: "live", timestamp }
                    },
                    last_received: timestamp
                });
            } else {
                console.warn(`No tile found for ID: ${data?.id} (normalized as ${normalizedId})`);
            }
        } catch (error) {
            console.error("Error processing RPI data:", error);
        }
    };

    const handlePDUPortMessage = async (data) => {
        try {
            if (!data || typeof data !== "object") {
                console.warn("Received invalid PDU port data:", data);
                return;
            }

            const pduId = data.id || data.pdu_id;
            const portId = data.port;

            if (!pduId || portId === undefined) {
                console.warn("PDU port message missing required IDs:", data);
                return;
            }

            const timestamp = Date.now();
            let processedData = {};

            Object.entries(data).forEach(([key, value]) => {
                if (!['id', 'pdu_id', 'port'].includes(key)) {
                    processedData[key] = {
                        value,
                        timestamp
                    };
                }
            });

             updatePduPort(pduId, portId, {
                ...processedData,
                source: { value: "live", timestamp }
            });

        } catch (error) {
            console.error("Error processing PDU port data:", error);
        }
    };


    const handleMidspanMessage = async (data) => {
        try {
            if (!data || typeof data !== "object") {
                console.warn("Received invalid midspan data:", data);
                return;
            }

            const midspanId = data.id || data.midspan_id;
            if (!midspanId) {
                console.warn("Midspan message missing ID:", data);
                return;
            }

            const timestamp = Date.now();
            let processedData = {};

            Object.entries(data).forEach(([key, value]) => {
                if (key !== "id" && key !== "midspan_id") {
                    processedData[key] = {
                        value,
                        timestamp
                    };
                }
            });

            updateMidspan(midspanId, {
                data: {
                    ...midspanDataRef.current[midspanId]?.data || {},
                    ...processedData,
                    source: { value: "live", timestamp }
                }
            });

            //console.log(`Updated midspan ${midspanId}:`, processedData);
        } catch (error) {
            console.error("Error processing midspan data:", error);
        }
    };

    const handlePOEPortMessage = async (data) => {
        try {
            if (!data || typeof data !== "object") {
                console.warn("Received invalid POE port data:", data);
                return;
            }

            const midspanId = data.id;
            const portId = data.port;

            if (!midspanId || !portId) {
                console.warn("POE port message missing required IDs:", data);
                return;
            }

            const timestamp = Date.now();
            let processedData = {};

            Object.entries(data).forEach(([key, value]) => {
                if (!['midspan_id', 'midspan', 'port_id', 'port'].includes(key)) {
                    processedData[key] = {
                        value,
                        timestamp
                    };
                }
            });


            updatePoePort(midspanId, portId, {
                ...processedData,
                source: { value: "live", timestamp }
            });

            //console.log(`Updated POE port ${midspanId}:${portId}:`, processedData);
        } catch (error) {
            console.error("Error processing POE port data:", error);
        }
    };


    const handlePOEPortStatusMessage = (data) => {
        if (!data || typeof data !== "object") return;

        const midspanId = data.id;
        const portId = data.port;
        const status = data.status;   // "active" or "inactive"
        const timestamp = Date.now();

        // Direct normalized structure (no wrapping in {value,timestamp} for status)
        const update = {
            status: { value: status, timestamp },
            power: { value: data.power ?? null, timestamp },
            voltage: { value: data.voltage ?? null, timestamp },
            maxPower: { value: data.maxPower ?? null, timestamp },
            class: { value: data.class ?? null, timestamp },
            source: { value: "live", timestamp }
        };

        updatePoePort(midspanId, portId, update);
        console.log(`[LIVE UPDATE] POE ${midspanId}:${portId}`, update);
        const rpiId = getRpiFromHosts(midspanId, portId); // Get the RPI connected to this port
        console.log("Midspan: ", midspanId, ", PoE port: ", portId, " connected to RPI: ", rpiId);

        let rpiStatus = "unknown";

        // ---- GETTING RPI status from CACHE ---
        if (rpiId) {
          try {
              const rpiCacheData = localStorage.getItem("rpiCache");
              let rpiCachedRecent = rpiCacheData ? JSON.parse(rpiCacheData) : { ts: Date.now(), items: [] };

              if (rpiCachedRecent.items) {
                 const rpiEntry = rpiCachedRecent.items.find(e => e.id === rpiId);
                  if (rpiEntry && rpiEntry.status && typeof rpiEntry.status.value === "string") {
                      rpiStatus = rpiEntry.status.value; // Set the RPI's status if found in cache
                      console.warn("[CACHE] Status found in rpiCache: ", rpiStatus);

                  } else {
                      console.warn(`RPI status not found or invalid for ${rpiId}`);
                  }
              } else {
                  console.warn("[CACHE] No items in rpiCache");
              }
          } catch (e) {
              console.error("[CACHE] Failed to retrieve RPI status from cache:", e);
          }
      }

        console.log(`RPI ${rpiId} status: ${rpiStatus}`);

        // ---- PUTTING poeport status in CACHE ---
        try {
            const cachedData = localStorage.getItem("poePortCache");
            let poePortCache = cachedData ? JSON.parse(cachedData) : { ts: Date.now(), items: [] };

            // Remove the old record for this port and add the updated one
            poePortCache.items = poePortCache.items.filter(
                e => !(e.id === midspanId && String(e.port) === String(portId))
            );

            // Add the updated record
            poePortCache.items.push({
                id: midspanId,
                port: portId,
                data: update
            });

            // Save the updated cache
            localStorage.setItem("poePortCache", JSON.stringify(poePortCache));
            console.log("[CACHE] Updated POE port in cache:", midspanId, portId);
        } catch (e) {
            console.error("[CACHE] Failed to update POE port in cache:", e);
        }

        // ---- PINGING the RPI+ PUTTING IN CACHE ---
        if (rpiId) {
                  const pingRpiId = `rpi-${rpiId}.local`;  // Correct the formatting here
                  console.log("Formatted pingRpiId:", pingRpiId);
        
                  let attempt = 0;
                  const maxAttempts = 6; // Maximum attempts (30 seconds: 5, 10, 15, 20, 25, 30 seconds)
        
                  // Recursive function to ping the RPI at intervals (5 seconds)
                  const tryPing = () => {
                      console.log(`Pinging RPI attempt ${attempt + 1}: ${pingRpiId}`);
                      
                      pingRpi(pingRpiId).then((pingStatus) => {
                          console.log(`[PING] Ping result: ${pingStatus}`);
        
                          // If the ping status is different from the current RPI status, update and exit
                          if (pingStatus !== rpiStatus) {
                              message.success(`Ping to ${pingRpiId} successful`);
                              updateTile(rpiId, { status: { value: pingStatus, timestamp: Date.now() } });
        
                              // After successful ping, update the RPI status in the cache
                              try {
                                  const rpiCacheData = localStorage.getItem("rpiCache");
                                  let rpiCache = rpiCacheData ? JSON.parse(rpiCacheData) : { ts: Date.now(), items: [] };
        
                                  rpiCache.items = rpiCache.items.filter(e => e.id !== rpiId); // Remove old record
                                  rpiCache.items.push({
                                      id: rpiId,
                                      status: { value: pingStatus, timestamp: Date.now() },
                                      last_received: Date.now()
                                  });
        
                                  localStorage.setItem("rpiCache", JSON.stringify(rpiCache));
                                  console.log("[CACHE] Updated RPI in cache:", rpiId);
                                  
                                  
                              } catch (e) {
                                  console.error("[CACHE] Failed to update RPI in cache:", e);
                              }

                              const cleanId_mid = midspanId;
                              const cleanId_poe = portId;
                              axios.post(`http://10.128.48.5:5000/control/${cleanId_mid}/${cleanId_poe}/get`)
                                .then(() => {
                                  // Success message
                                  console.log(`Successfully sent 'get' command to ${cleanId_mid} port ${cleanId_poe}`);
                                  message.success(`Sent 'get' command to ${cleanId_mid} port ${cleanId_poe}`);
                                })
                                .catch((error) => {
                                  // Log the error details
                                  console.error(`Failed to send 'get' command to ${cleanId_mid} port ${cleanId_poe}`, error);
                                  message.error(`Failed to send 'get' command to ${cleanId_mid} port ${cleanId_poe}`);
                                });

                              return;  // Exit early if the ping is successful and status has changed
                          } else {
                              attempt++;
                              if (attempt < maxAttempts) {
                                  // Retry after 5 seconds if the ping is not successful
                                  setTimeout(tryPing, 5000);
                              } else {
                                  // If all attempts fail, log and exit
                                  message.error(`Ping to ${pingRpiId} failed after ${maxAttempts * 5} seconds`);
                                  updateTile(rpiId, { status: { value: "faulty", timestamp: Date.now() } });
        
                                  // After 30 seconds and failed attempts, update the RPI status in the cache
                                  try {
                                      const rpiCacheData = localStorage.getItem("rpiCache");
                                      let rpiCache = rpiCacheData ? JSON.parse(rpiCacheData) : { ts: Date.now(), items: [] };
        
                                      rpiCache.items = rpiCache.items.filter(e => e.id !== rpiId); // Remove old record
                                      rpiCache.items.push({
                                          id: rpiId,
                                          status: { value: "faulty", timestamp: Date.now() },
                                          last_received: Date.now()
                                      });
        
                                      localStorage.setItem("rpiCache", JSON.stringify(rpiCache));
                                      console.log("[CACHE] Updated RPI in cache (failed ping):", rpiId);

                                  } catch (e) {
                                      console.error("[CACHE] Failed to update RPI in cache (failed ping):", e);
                                  }

                                  //const cleanId_mid =  tile.id.startsWith("rpi-") ? tile.id.replace(/^rpi-/, ""): tile.id;
                                  //const cleanId_poe =  tile.id.startsWith("rpi-") ? tile.id.replace(/^rpi-/, ""): tile.id;
                                  const cleanId_mid = midspanId;
                                  const cleanId_poe = portId;
                                  axios.post(`http://10.128.48.5:5000/control/${cleanId_mid}/${cleanId_poe}/get`)
                                    .then(() => {
                                      // Success message
                                      console.log(`Successfully sent 'get' command to ${cleanId_mid} port ${cleanId_poe}`);
                                      message.success(`Sent 'get' command to ${cleanId_mid} port ${cleanId_poe}`);
                                    })
                                    .catch((error) => {
                                      // Log the error details
                                      console.error(`Failed to send 'get' command to ${cleanId_mid} port ${cleanId_poe}`, error);
                                      message.error(`Failed to send 'get' command to ${cleanId_mid} port ${cleanId_poe}`);
                                    });
                              }
                          }
                      }).catch((error) => {
                          console.log(`[PING] Error pinging ${pingRpiId}:`, error);
                          message.error(`Ping to ${pingRpiId} failed`);
                      });
                  };
        
                  // Start the recursive ping process
                  tryPing();
              } else {
                  console.log("No RPI found for Midspan:", midspanId, "Port:", portId);
              }
    };


    const handlePDUMessage = async (data) => {
        try {
            if (!data || typeof data !== "object") {
                console.warn("Received invalid PDU data:", data);
                return;
            }

            const pduId = data.id || data.pdu_id;
            if (!pduId) {
                console.warn("PDU message missing ID:", data);
                return;
            }

            const timestamp = Date.now();
            let processedData = {};

            Object.entries(data).forEach(([key, value]) => {
                if (key !== "id" && key !== "pdu_id") {
                    processedData[key] = {
                        value,
                        timestamp
                    };
                }
            });

            updatePdu(pduId, {
                data: {
                    ...pduDataRef.current[pduId]?.data || {},
                    ...processedData,
                    source: { value: "live", timestamp }
                }
            });

            console.log(`Updated PDU ${pduId}:`, processedData);
        } catch (error) {
            console.error("Error processing PDU data:", error);
        }
    };

    const handleServerMessage = async (data) => {
        try {
            if (!data || typeof data !== "object") {
                console.warn("Received invalid data:", data);
                return;
            }
            const timestamp = Date.now();
            let processedData = {};

            Object.entries(data).forEach(([key, value]) => {
                if (!['id', 'server_id', 'hostname'].includes(key)) {
                    processedData[key] = {
                        value,
                        timestamp
                    };
                }
            });
            updateServer( {
                data: {
                    ...serverDataRef.current?.data,
                    ...processedData
                }
            });
            console.log(`Updated server:`, processedData);
        } catch (error) {
            console.error("Error processing server data:", error);
        }
    }

    const handleStatusMessage = async (data) => {
        try {
            setActivity(data?.status === "active");
            setStatusJson(data)
        } catch (error) {
            console.error("Error processing status data:", error);
        }
    };

    const handlePDUPortsMessage = async (data) => {
        try {
            //
        } catch (error) {
            console.error("Error processing status data:", error);
        }
    };

    //useEffect(() => {
    //    if (!preloadComplete) return;
    //    const timer = setTimeout(() => {
    //        pingAllRpis();
    //    }, 1000);

    //    const interval = setInterval(pingAllRpis,600000 );
    //    return () => {
    //        clearTimeout(timer);
    //        clearInterval(interval);
    //    }
    //}, [preloadComplete]);
/*
useEffect(() => {
  if (!preloadComplete) return;

  const doRefresh = async () => {
    const rpiIds = Object.keys(rpiCells || {}); 
    const midspanIds = Object.keys(midspans);
    console.warn("[refresh] fetching", rpiIds.length, "RPIs from DB");

    await preloadEverythingFromDb({
      rpiIds,
      apiBase,
      midspanIds,
      poePortCount: 24
    });
  };

  const interval = setInterval(doRefresh, 30000);
  
return () => clearInterval(interval);

}, [preloadComplete, rpiCells, apiBase]);
*/
useEffect(() => {
  if (!preloadComplete) return;

  let isRefreshing = false;
  let cancelled = false;

  const doRefresh = async () => {

    //if (isRefreshing || cancelled) return;
    //setIsRefreshingGlobal(true);
    //isRefreshing = true;

    try {
      const rpiIds = Object.keys(rpiCells || {});
      const midspanIds = Object.keys(midspans || {});
      //window.__isRefreshing = true;     
      console.log("TEST, this it debug code");
      await preloadEverythingFromDb({
          rpiIds,
          midspanIds,
          portCounts: midspanPortCountsState,
          poePortCount: 24,
          apiBase
      });


    } catch (err) {
      console.error("[refresh] ERROR", err);
    } finally {
      //isRefreshing = false;
      //setIsRefreshingGlobal(false);   // <--- Added
      //window.__isRefreshing = false;
    }
  };

  const interval = setInterval(doRefresh, 30000);
  doRefresh();
  return () => {
    cancelled = true;
    clearInterval(interval);
  };
}, [preloadComplete]);
/*

useEffect(() => {
  if (!preloadComplete) return;

  let isRefreshing = false;
  let cancelled = false;

  const doRefresh = async () => {
    if (isRefreshing || cancelled) return;   // <-- prevents overlap
    isRefreshing = true;

    try {
      const rpiIds = Object.keys(rpiCells || {});
      const midspanIds = Object.keys(midspans || {});

      console.warn("[refresh] START", rpiIds.length, "RPIs");

      await preloadEverythingFromDb({
        rpiIds,
        apiBase,
        midspanIds,
        poePortCount: 24
      });

      console.warn("[refresh] DONE");

    } catch (err) {
      console.error("[refresh] ERROR", err);
    }

    isRefreshing = false;
  };

  const interval = setInterval(doRefresh, 30000);
  doRefresh(); // run once immediately

  return () => {
    cancelled = true;
    clearInterval(interval);
  };
}, [preloadComplete, apiBase]);

*/

    useEffect(() => {
        const cleanup = generateMockData({
            "rpi/data": (data) => {
                Promise.resolve().then(() => handleRpiMessage(data));
            },
            //"midspan/data": (data) => {
            //    Promise.resolve().then(() => handleMidspanMessage(data));
            //},
            //"midspan/poeport": (data) => {
            //    Promise.resolve().then(() => handlePOEPortMessage(data));
            //},

            "midspan/poeport/singlePortData": (data) => {
                Promise.resolve().then(() => handlePOEPortMessage(data));
            },

             "midspan/poeport/state/#": (data) => 
              Promise.resolve().then(() => handlePOEPortStatusMessage(data)),

            "midspan/data": () => {},
            "midspan/poeport": () => {},

            "pdu/data": (data) => {
                Promise.resolve().then(() => handlePDUMessage(data));
            },
            "server/data": (data) => {
                Promise.resolve().then(() => handleServerMessage(data));
            },
            "experiment": (data) => {
                Promise.resolve().then(() => handleStatusMessage(data));
            },
            "pdu/port": (data) => {
                Promise.resolve().then(() => handlePDUPortMessage(data));
            },
        });

        return cleanup;
    }, []);
/*  
return (
    <GraphContext.Provider value={{ showGraphForTile }}>
      <Router>
        <Layout style={{ minHeight: "100vh" }}>
          <Header style={{ background: "#001529", padding: 0 }}>
            <h2 style={{ color: "white", textAlign: "center" }}>Dashboard</h2>
            {// Navigation Links }
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Link to="/" style={{ color: "white", padding: "10px" }}>
                Home
              </Link>
              <Link to="/ceiling" style={{ color: "white", padding: "10px" }}>
                Ceiling
              </Link>
            </div>
          </Header>

          <Content style={{ padding: "20px" }}>
            <Routes>
              {// Full Dashboard Route }
              <Route
                exact
                path="/"
                element={
                  <div>
                    <h3>Full Dashboard View</h3>
                    {// Render all tiles }
                    {Object.entries(tiles).map(([tileId, tileData]) => (
                      <div key={tileId}>
                        <h3>{tileId}</h3>
                        <p>Status: {tileData.status?.value || "Unknown"}</p>
                        <p>Walls: {tileData.walls.join(", ")}</p>
                      </div>
                    ))}
                  </div>
                }
              />

              {// Ceiling Route }
              <Route path="/ceiling" element={<Ceiling tiles={tiles} />} />
            </Routes>
          </Content>
        </Layout>
      </Router>
    </GraphContext.Provider>
  );
};*/
    return (
        <GraphContext.Provider value={{ showGraphForTile }}>

        <Layout style={{minHeight: "100vh", display: "flex"}}>
            <Layout style={{width: open ? "50vw" : "100vw", transition: "width 0.3s ease"}}>
                {(viewMode === "walls" || viewMode === "segments") && (
                 <DashboardHeader
                    setOpen={setOpen}
                    showExtra={showExtra}
                    setShowExtra={setShowExtra}
                    statusJson={statusJson}
                />

                )}
                {showExtra && (
                    <div
                        style={{
                            position: "fixed",
                            top: "70px",
                            left: 0,
                            right: 0,
                            background: "#001529",
                            borderBottom: "1px solid #d9d9d9",
                            zIndex: 999,
                            overflow: "hidden",
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            gap: "16px",
                            padding: showExtra ? "16px" : "0px",
                        }}
                    >
                        <p style={{margin: 0, color: "#FFFFFF" }}>Extra controls</p>
                        <Button
                            onClick={() => pingAllRpis()}
                            style={{ backgroundColor: "lightblue", color: "rgba(1,1,1,1)" }}
                        >
                            Ping All
                        </Button>
                        <Button
                            onClick={() => setShowOnlyFaulty(prev => !prev)}
                            style={{ backgroundColor: "lightblue", color: "rgba(1,1,1,1)" }}
                        >
                            {showOnlyFaulty ? "Show All Tiles" : `Show Only Faulty (${faultyCount})`}
                        </Button>
                        <Button
                            onClick={() => {
                                setSelectedTileId("TECHDASH");
                                setGraphVisible(true);
                            }}
                            style={{ backgroundColor: "lightblue", color: "rgba(1,1,1,1)" }}
                        >
                            show TECHDASH graph
                        </Button>

                    </div>
                )}

                <Content
                    style={{
                        padding: "10px",
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        maxWidth: "99vw",
                        gap: "20px",
                        marginTop: showExtra ? "140px" : "70px"
                    }}
                > 
                  {viewMode === "ceiling" && <Ceiling tiles={tiles} />}
                  {viewMode === "floor" && <Floor tiles={tiles} />}
                  {viewMode === "wallEast" && <WallEast tiles={tiles} />}
                  {viewMode === "wallWest" && <wallWest tiles={tiles} />}
                  {viewMode === "walls" && Object.entries(walls)
                        .filter(([name]) => visibleItems.includes(name) && name !== "tests")
                        .map(([wallName, wallData]) => (
                            <Wall
                                key={wallName}
                                wallName={wallName}
                                wallData={wallData}
                                updateTile={updateTile}
                                faultyCount={Object.values(wallData.tiles).filter(t => t.status.value === "faulty").length}
                                selectedDisplayField={selectedDisplayField}
                            />
                        ))}
                   {viewMode === "segments" && Object.entries(segments)
                        .filter(([name]) => visibleItems.includes(name)&& name !== "tests")
                        .map(([segmentLabel, segmentData]) => (
                            <Segment
                                key={segmentLabel}
                                segmentLabel={segmentLabel}
                                segmentData={segmentData}
                                updateTile={updateTile}
                                faultyCount={Object.values(segmentData.tiles).filter(t => t.status.value === "faulty").length}
                                selectedDisplayField={selectedDisplayField}
                            />
                        ))}


			{ visibleItems.includes("tests") && testWallTiles.length > 0 && (
 				viewMode === "walls" ? (
					<Segment
						segmentLabel="Test RPis"
						segmentData={{tiles: Object.fromEntries(testWallTiles.map(tile => [tile.id,tile]))}}
						updateTile={updateTile}
						faultyCount ={testWallTiles.filter(t => t.status?.value === "faulty").length}
						selectedDisplayField={selectedDisplayField}
					/>
				) : viewMode === "segments" ? (
					<Segment
						segmentLabel="Test RPis"
						segmentData={{tiles: Object.fromEntries(testWallTiles.map(tile => [tile.id, tile])) }}
						updateTile={updateTile}
						faultyCount={testWallTiles.filter(t=>t.status?.value === "faulty").length}
						selectedDisplayField={selectedDisplayField}
					/>
				) : null
			)}

                        {(viewMode === "walls" || viewMode === "segments") && (
                        <>
                        {Object.entries(midspans).map(([midspanId, midspanConfigData]) => {
                            const runtime = midspanData[midspanId];
                            const isMidspanFaulty = runtime?.data?.status?.value !== "active";

                            const allVisibleTileIds = new Set();

                            // Gather visible tile IDs
                            const source = viewMode === "walls" ? walls : segments;
                            visibleItems.forEach(name => {
                                const tileGroup = source[name];
                                if (tileGroup) {
                                    Object.keys(tileGroup.tiles).forEach(tileId => {
                                        allVisibleTileIds.add(tileId);
                                    });
                                }
                            });

                            // Filter ports based on visible tile IDs
                            //const filteredPorts = {};
                            //console.log("[ Render] midspan", midspanId, "ports in poePortsData:", Object.keys(poePortsData[midspanId] || {}), "filteredPorts:", Object.keys(filteredPorts));
 
                            // Filter ports based on visible tile IDs
                            const filteredPorts = {};
                            const ports = poePortsData[midspanId] || {};
                            Object.entries(ports).forEach(([portId, portInfo]) => {
                                // Check if the port is connected to an RPI (i.e., if it has an `rpi` field)
                                if (allVisibleTileIds.has(portInfo.rpi)) {
                                    filteredPorts[portId] = portInfo;  // Show connected ports normally
                                } else {
                                    // Mark unconnected ports as gray and set their status to "unconnected"
                                    filteredPorts[portId] = {
                                        ...portInfo,
                                        status: { value: "unconnected", timestamp: Date.now() },
                                    };
                                }
                            });

                            const total = midspanPortCountsState[midspanId] || 24;
                            for (let p = 1; p <= total; p++) {
                              if (!filteredPorts[p]) {
                                filteredPorts[p] = {
                                  status: { value: "unconnected", timestamp: 0 },
                                  power: null,
                                  voltage: null,
                                  class: null,
                                  rpi: null,
                                };
                              }
                            }



                            // Only render midspan if it has relevant ports
                            if (showOnlyFaulty) {
                                if (!isMidspanFaulty) return null;  // Skip rendering if midspan is not faulty and showOnlyFaulty is enabled
                            }
                            return (
                                <MidspanDevice
                                    key={midspanId}
                                    midspanId={midspanId}
                                    midspanData={midspanConfigData}
                                    midspanRuntimeData={midspanData[midspanId]}
                                    ports={filteredPorts}
                                    //togglePort={togglePort}
                                />
                            );
                        })}

                    {Object.entries(pduData).map(([pduId, deviceData]) => (
                        <PDUDevice
                            key={pduId}
                            PDUId={pduId}
                            PDUData={deviceData}
                            ports={pduPortData[pduId] || {}}
                        />
                    ))}
                   </>
                 )}


                    </Content>
                </Layout>

                <ControlPanel
                    open={open}
                    onClose={() => setOpen(false)}
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    wallNames={walls}
                    segmentNames={segments}
                    visibleItems={visibleItems}
                    setVisibleItems={setVisibleItems}
                    rpi_ip={rpi_ip}
                    activity={activity}
                    tiles={tiles}
                    setSelectedDisplayField={setSelectedDisplayField}
                />


            {serverData?.data && <InfoBar serverData={serverData} />}

            {graphVisible && selectedTileId && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        height: '100vh',
                        width: '100vw',
                        backgroundColor: 'white',
                        zIndex: 9999,
                        padding: '20px',
                        overflow: 'auto'
                    }}>
                        <Button
                            type="primary"
                            danger
                            onClick={() => setGraphVisible(false)}
                            style={{ position: 'absolute', top: 20, right: 20, zIndex: 10000 }}
                        >
                            Close
                        </Button>
                        <GraphPage deviceId={selectedTileId}/>
                    </div>
                )}
            </Layout>
        </GraphContext.Provider>
    );
};

export const GraphContext = createContext({
    showGraphForTile: () => {},
});

export const useGraph = () => useContext(GraphContext);

export default Dashboard;


 