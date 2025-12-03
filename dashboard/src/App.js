import React, { useState } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Dashboard from "./Dashboard";

const App = () => {
  const [viewMode, setViewMode] = useState("walls");

  return (
    <Router>
      <Routes>
        {/* Default route */}
        <Route
          path="/"
          element={<Dashboard viewMode={viewMode} setViewMode={setViewMode} />}
        />

        {/* Specific routes for each viewMode */}
        <Route
          path="/ceiling"
          element={<Dashboard viewMode="ceiling" setViewMode={setViewMode} />}
        />
        <Route
          path="/floor"
          element={<Dashboard viewMode="floor" setViewMode={setViewMode} />}
        />
        <Route
          path="/wallEast"
          element={<Dashboard viewMode="wallEast" setViewMode={setViewMode} />}
        />
        <Route
          path="/wallWest"
          element={<Dashboard viewMode="wallWest" setViewMode={setViewMode} />}
        />
      </Routes>
    </Router>
  );
};

export default App;
