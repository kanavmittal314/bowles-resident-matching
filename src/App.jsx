import React, { useState, useRef } from "react";
import { solveRoommateAssignment } from "./roommateSolver";
import Papa from "papaparse";

function App() {
  // UI state
  const [loading, setLoading] = useState(false);
  const [outputUrl, setOutputUrl] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const filesRef = useRef({});
  // Store parsed CSVs and their column order for preview
  const [parsed, setParsed] = useState({ preferences: null, rooms: null, key: null });
  const [fields, setFields] = useState({ preferences: null, rooms: null, key: null });

  // Utility: Read file as text
  const readFile = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  // Handle file input changes, parse and preview
  const handleFile = async (e, key) => {
    setError("");
    setStatus(`Uploading ${key} file...`);
    filesRef.current[key] = e.target.files[0];
    try {
      const text = await readFile(e.target.files[0]);
      setStatus(`Parsing ${key} file...`);
      const parsedResult = Papa.parse(text, { header: true, skipEmptyLines: true });
      setParsed(prev => ({ ...prev, [key]: parsedResult.data }));
      setFields(prev => ({ ...prev, [key]: parsedResult.meta.fields }));
      setStatus(`${key.charAt(0).toUpperCase() + key.slice(1)} file loaded and parsed.`);
    } catch (err) {
      setError(`Failed to read or parse ${key} file: ${err}`);
      setParsed(prev => ({ ...prev, [key]: null }));
      setFields(prev => ({ ...prev, [key]: null }));
      setStatus("");
    }
  };

  // Render a preview table for a parsed CSV
  function renderTable(data, label, fieldsArr) {
    if (!data || !Array.isArray(data) || data.length === 0) return null;
    const headers = fieldsArr || Object.keys(data[0]);
    return (
      <div style={{ margin: '12px 0', maxHeight: 220, overflow: 'auto', border: '1px solid #ddd', borderRadius: 4 }}>
        <div style={{ fontWeight: 600, background: '#f7f7f7', padding: '4px 8px', borderBottom: '1px solid #eee' }}>{label} Preview</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {headers.map(h => <th key={h} style={{ borderBottom: '1px solid #ccc', background: '#fafafa', padding: '2px 6px', textAlign: 'left' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 20).map((row, i) => (
              <tr key={i} style={{ background: i % 2 ? '#fcfcfc' : '#fff' }}>
                {headers.map(h => <td key={h} style={{ padding: '2px 6px', borderBottom: '1px solid #eee' }}>{row[h]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {data.length > 20 && <div style={{ fontSize: 11, color: '#888', padding: '2px 8px' }}>(showing first 20 rows)</div>}
      </div>
    );
  }

  // Main handler: read files, parse, solve, and prepare output
  const handleRun = async () => {
    setError("");
    setOutputUrl(null);
    setLoading(true);
    setStatus("Validating input files...");
    try {
      // Check all files are uploaded and parsed
      if (!filesRef.current.preferences || !filesRef.current.rooms || !filesRef.current.key) {
        setError("Please upload all three files: preferences, rooms, and key.");
        setStatus("");
        setLoading(false);
        return;
      }
      if (!parsed.preferences || !parsed.rooms || !parsed.key) {
        setError("One or more files failed to parse. Please re-upload.");
        setStatus("");
        setLoading(false);
        return;
      }
      setStatus("Solving roommate assignment (building model)...");
      let result;
      try {
        result = await solveRoommateAssignment(parsed.preferences, parsed.rooms, parsed.key);
      } catch (solverError) {
        setError("Solver error: " + solverError.toString());
        setStatus("No feasible solution found or model error.");
        setLoading(false);
        return;
      }
      setStatus("Building output CSV...");
      // Prepare output CSV
      let csv = "Roommate A,Roommate B,Room\n";
      for (const pair of result.assignments) {
        csv += `${pair.a},${pair.b},${pair.room}\n`;
      }
      if (result.unassigned && result.unassigned.length > 0) {
        for (const name of result.unassigned) {
          csv += `${name},(no roommate),\n`;
        }
      }
      setStatus("Preparing download link...");
      // Download link
      const blob = new Blob([csv], { type: "text/csv" });
      setOutputUrl(URL.createObjectURL(blob));
      setStatus("Done! Download your results below.");
    } catch (e) {
      setError("Unexpected error: " + e.toString());
      setStatus("");
    }
    setLoading(false);
  };

  // --- UI ---
  return (
    <div style={{ maxWidth: 700, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h2>Roommate Assignment Solver (in Browser)</h2>
      <div style={{ marginBottom: 16 }}>
        <label>
          Preferences CSV:
          <input type="file" accept=".csv,.tsv" onChange={e => handleFile(e, "preferences")} />
        </label>
        {renderTable(parsed.preferences, "Preferences", fields.preferences)}
      </div>
      <div style={{ marginBottom: 16 }}>
        <label>
          Rooms CSV:
          <input type="file" accept=".csv,.tsv" onChange={e => handleFile(e, "rooms")} />
        </label>
        {renderTable(parsed.rooms, "Rooms", fields.rooms)}
      </div>
      <div style={{ marginBottom: 16 }}>
        <label>
          Key CSV:
          <input type="file" accept=".csv,.tsv" onChange={e => handleFile(e, "key")} />
        </label>
        {renderTable(parsed.key, "Key", fields.key)}
      </div>
      <button onClick={handleRun} disabled={loading} style={{ padding: "0.5em 1em" }}>
        {loading ? "Running..." : "Run Roommate Assignment"}
      </button>
      {status && <div style={{ marginTop: 16, color: "#555" }}>{status}</div>}
      {error && <div style={{ marginTop: 16, color: "red" }}>Error: {error}</div>}
      {outputUrl && (
        <div style={{ marginTop: 24 }}>
          <a href={outputUrl} download="output.csv" style={{ fontSize: 18, color: "green" }}>
            Download output.csv
          </a>
        </div>
      )}
      <div style={{ marginTop: 32, fontSize: 13, color: '#888' }}>
        <div>All computation runs in your browser. No files are uploaded to a server.</div>
        <div>Powered by React and glpk.js.</div>
      </div>
    </div>
  );
}

export default App;
