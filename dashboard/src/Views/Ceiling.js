import React from 'react';

// Function to determine the background color based on tile status
function getBackgroundColor(status) {
  switch (status) {
    case "working":
      return "#dfffd6"; // Green for working
    case "faulty":
      return "#ffd6d6"; // Red for faulty
    case "deactivated":
      return "#f0f0f0"; // Grey for deactivated
    default:
      return "#f0f0f0"; // Default to grey
  }
}

const Ceiling = ({ tiles }) => {
  // Filter the tiles to get only those associated with "ceiling"
  const ceilingTiles = Object.entries(tiles).filter(([tileId, tileData]) =>
    tileData.walls && tileData.walls.includes("ceiling")
  );

  const rows = [];
  const columns = [];

  // Dynamically extract rows and columns based on ceiling tiles
  ceilingTiles.forEach(([tileId]) => {
    const column = tileId.charAt(0);  // Get the column letter (A, B, C, etc.)
    const row = tileId.slice(1);      // Get the row number (5, 6, 7, etc.)

    if (!columns.includes(column)) {
      columns.push(column);  // Add column if not already added
    }
    if (!rows.includes(row)) {
      rows.push(row);  // Add row if not already added
    }
  });

  // Sort rows and columns to ensure proper ordering
  rows.sort((a, b) => a - b);  // Sort rows numerically (5, 6, 7, etc.)
  columns.sort();  // Sort columns alphabetically (A, B, C, etc.)

  // Function to generate the grid of tiles
  const generateGrid = () => {
    const grid = [];
    rows.forEach(row => {
      columns.forEach(col => {
        const tileId = `${col}${row}`;  // Dynamically create tile ID like A5, B6, etc.
        const tileData = tiles[tileId] || {}; // Get tile data for this tileId

        grid.push(
          <div
            key={tileId}
            style={{
              backgroundColor: getBackgroundColor(tileData.status?.value),  // Get background color based on tile status
              padding: "10px",
              borderRadius: "5px",
              textAlign: "center",
              margin: "5px",  // Space between tiles
            }}
          >
            <h3>{tileId}</h3> { }
            <p>{`${tileId} (${tileData.temperature}°C)`}</p> { }
            <p><strong>CPU Load:</strong> {tileData.cpuLoad || "N/A"}%</p> {}
            <p><strong>RAM:</strong> {tileData.ram || "N/A"} GB</p> {}
            <p><strong>Disk Usage:</strong> {tileData.diskUsage || "N/A"} GB</p> {}
          </div>
        );
      });
    });
    return grid;
  };

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'center', overflow: 'hidden', padding: 0, }}>

       <div 
        style={{
          width: '100%', 
          backgroundColor: '#001529',  // Blue background color (same as the dashboard header)
          color: 'white',  // White text color
          textAlign: 'center',
          padding: '10px 0',
          fontSize: '20px',
          fontWeight: 'bold',
          marginBottom: '20px',  // Space between the header and the grid
        }}
      >
        Ceiling View
      </div>

       <div
        style={{
          display: "grid",
          gridTemplateColumns: `40px repeat(${columns.length}, 1fr)`,  // Grid with fixed width for row numbers and flexible columns
          gap: "5px",  // Space between tiles
          width: '100%',
          flewGrow: 1,
          overflow: "auto",
          paddingRight: "20px",
        }}
      >


        {}
        <div style={{ width: '40px', fontWeight: 'bold' }}></div> {}
        {columns.map((column) => (
          <div key={column} style={{ textAlign: "center", fontWeight: "bold" }}>
            {column}
          </div>
        ))}

        {}
        {rows.map((row) => (
          <>
            <div key={row} style={{ textAlign: "center", fontWeight: "bold" }}>
              {row}
            </div>
            {columns.map((column) => {
              const tileId = `${column}${row}`;  // Tile ID like A5, B6, etc.
              const tileData = tiles[tileId] || {};  // Get tile data for this tileId

              return (
                <div
                  key={tileId}
                  style={{
                    backgroundColor: getBackgroundColor(tileData.status?.value),  // Get background color based on tile status
                    padding: "10px",
                    borderRadius: "5px",
                    textAlign: "center",
                  }}
                >
                  <h3>{tileId}</h3> {}
                  <p>{`${tileId} (${tileData.temperature}°C)`}</p> {}
                  <p><strong>CPU Load:</strong> {tileData.cpuLoad || "N/A"}%</p> {}
                  <p><strong>RAM:</strong> {tileData.ram || "N/A"} GB</p> {}
                  <p><strong>Disk Usage:</strong> {tileData.diskUsage || "N/A"} GB</p> {}
                </div>
              );
            })}
          </>
        ))}
      </div>
    </div>
  );
};

export default Ceiling;

