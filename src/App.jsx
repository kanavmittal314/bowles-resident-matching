import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Paper,
  ThemeProvider,
  Tooltip,
  Toolbar,
  Typography,
  createTheme,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import DownloadIcon from "@mui/icons-material/Download";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import "./App.css";
import {
  buildDefaultPreferenceConfig,
  calculateCompatibility,
  cleanValue,
  findAssignmentIssues,
  getRoomStudents,
  isAbortError,
  normalizeStudents,
  solveRoomAssignment,
  solveRoomAssignmentByGender,
  uniqueValues,
} from "./roommateSolver";

const EMPTY_PARSED = { preferences: [] };
const EMPTY_FIELDS = { preferences: [] };
const EMPTY_COLUMN_MAP = { name: [], gender: "" };
const UNMAPPED_ROLE = "";
const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#176b87",
      dark: "#123f4f",
    },
    secondary: {
      main: "#2f6f4e",
    },
    background: {
      default: "#f5f7f8",
      paper: "#ffffff",
    },
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: {
      fontSize: "1.9rem",
      fontWeight: 800,
      letterSpacing: 0,
    },
    h2: {
      fontWeight: 800,
      letterSpacing: 0,
    },
    button: {
      fontWeight: 800,
      textTransform: "none",
    },
  },
  components: {
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
    },
    MuiPaper: {
      styleOverrides: {
        rounded: {
          borderRadius: 8,
        },
      },
    },
  },
});
const STAGES = [
  {
    id: "files",
    label: "Files",
    title: "Upload files",
    description: "Add the preferences file and enter the available single and double rooms.",
  },
  {
    id: "mapping",
    label: "Columns",
    title: "Map columns",
    description: "Assign each uploaded column to the role it should play in matching.",
  },
  {
    id: "key",
    label: "Preference key",
    title: "Encode preferences",
    description: "Set the numeric meaning and weight for each selected preference column.",
  },
  {
    id: "assign",
    label: "Assign",
    title: "Build assignments",
    description: "Drag students into rooms, run the optimizer for the rest, and export the final sheet.",
  },
];

function buildGeneratedRooms(singleRoomCount, doubleRoomCount) {
  const singles = Array.from({ length: singleRoomCount }, (_, index) => ({
    id: `single-${index}`,
    label: `Single ${index + 1}`,
    capacity: 1,
  }));
  const doubles = Array.from({ length: doubleRoomCount }, (_, index) => ({
    id: `double-${index}`,
    label: `Double ${index + 1}`,
    capacity: 2,
  }));
  return [...singles, ...doubles];
}

function App() {
  const [parsed, setParsed] = useState(EMPTY_PARSED);
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [singleRoomCount, setSingleRoomCount] = useState(0);
  const [doubleRoomCount, setDoubleRoomCount] = useState(0);
  const [columnMap, setColumnMap] = useState(EMPTY_COLUMN_MAP);
  const [preferenceColumns, setPreferenceColumns] = useState([]);
  const [miscColumns, setMiscColumns] = useState([]);
  const [preferenceConfig, setPreferenceConfig] = useState({});
  const [assignments, setAssignments] = useState({});
  const [draggedStudentId, setDraggedStudentId] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedPairId, setSelectedPairId] = useState("");
  const [expandedStudentIds, setExpandedStudentIds] = useState([]);
  const [expandedPairIds, setExpandedPairIds] = useState([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isSolving, setIsSolving] = useState(false);
  const [optimizationProgress, setOptimizationProgress] = useState(null);
  const [fileDragTarget, setFileDragTarget] = useState("");
  const [optimizationMode, setOptimizationMode] = useState("byGender");
  const [maxSolveTimeSeconds, setMaxSolveTimeSeconds] = useState("10");
  const [stage, setStage] = useState("files");
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const abortControllerRef = useRef(null);

  async function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  async function loadCsvFile(file, type) {
    if (!file) return;
    setError("");
    setOptimizationProgress(null);
    setStatus(`Loading ${type} file...`);
    try {
      const text = await readFile(file);
      const result = Papa.parse(text, { header: true, skipEmptyLines: true });
      if (result.errors.length > 0) {
        throw new Error(result.errors[0].message);
      }
      const rows = result.data;
      const fileFields = result.meta.fields || [];
      setParsed((prev) => ({ ...prev, [type]: rows }));
      setFields((prev) => ({ ...prev, [type]: fileFields }));

      setColumnMap(EMPTY_COLUMN_MAP);
      setPreferenceColumns([]);
      setMiscColumns([]);
      setPreferenceConfig({});

      setStatus("Preferences file loaded.");
    } catch (fileError) {
      setError(`Could not read ${type} file: ${fileError.message || fileError}`);
      setParsed((prev) => ({ ...prev, [type]: [] }));
      setFields((prev) => ({ ...prev, [type]: [] }));
      setStatus("");
    }
  }

  async function handleFile(event, type) {
    await loadCsvFile(event.target.files[0], type);
    event.target.value = "";
  }

  function handleFileDragOver(event, type) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setFileDragTarget(type);
  }

  function handleFileDragLeave(event, type) {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setFileDragTarget((current) => (current === type ? "" : current));
  }

  async function handleFileDrop(event, type) {
    event.preventDefault();
    event.stopPropagation();
    setFileDragTarget("");
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    await loadCsvFile(file, type);
  }

  function mergePreferenceConfig(columns, currentConfig) {
    const defaults = buildDefaultPreferenceConfig(parsed.preferences, columns);
    const merged = {};
    columns.forEach((item) => {
      merged[item] = currentConfig[item]
        ? {
            weight: currentConfig[item].weight,
            values: { ...defaults[item].values, ...currentConfig[item].values },
          }
        : defaults[item];
    });
    return merged;
  }

  function getColumnRole(field) {
    if ((Array.isArray(columnMap.name) ? columnMap.name : [columnMap.name]).includes(field)) return "name";
    if (columnMap.gender === field) return "gender";
    if (preferenceColumns.includes(field)) return "preference";
    if (miscColumns.includes(field)) return "misc";
    return UNMAPPED_ROLE;
  }

  function setColumnRole(field, role) {
    setColumnMap((prev) => {
      const currentNameColumns = Array.isArray(prev.name) ? prev.name : [prev.name].filter(Boolean);
      const next = {
        ...prev,
        name: currentNameColumns.filter((column) => column !== field),
      };
      if (next.gender === field) next.gender = "";
      if (role === "name") next.name = [...next.name, field];
      if (role === "gender") next.gender = field;
      return next;
    });

    setPreferenceColumns((prev) => {
      const withoutField = prev.filter((column) => column !== field);
      const next = role === "preference" ? [...withoutField, field] : withoutField;
      setPreferenceConfig((current) => mergePreferenceConfig(next, current));
      return next;
    });
    setMiscColumns((prev) => {
      const withoutField = prev.filter((column) => column !== field);
      return role === "misc" ? [...withoutField, field] : withoutField;
    });
  }

  function updateWeight(column, value) {
    setPreferenceConfig((prev) => ({
      ...prev,
      [column]: {
        ...prev[column],
        weight: value,
      },
    }));
  }

  function updateEncoding(column, rawValue, value) {
    setPreferenceConfig((prev) => ({
      ...prev,
      [column]: {
        ...prev[column],
        values: {
          ...prev[column].values,
          [rawValue]: value,
        },
      },
    }));
  }

  const normalized = useMemo(() => {
    const hasMappings =
      (Array.isArray(columnMap.name) ? columnMap.name.length > 0 : Boolean(columnMap.name)) &&
      columnMap.gender &&
      preferenceColumns.length > 0;
    if (!hasMappings || parsed.preferences.length === 0) {
      return { students: [], rooms: [], error: "" };
    }
    try {
      const normalizedStudents = normalizeStudents(parsed.preferences, columnMap, preferenceConfig);
      return {
        students: normalizedStudents,
        rooms: buildGeneratedRooms(singleRoomCount, doubleRoomCount),
        error: "",
      };
    } catch (normalizationError) {
      return { students: [], rooms: [], error: normalizationError.message };
    }
  }, [columnMap, doubleRoomCount, parsed.preferences, preferenceColumns.length, preferenceConfig, singleRoomCount]);

  const students = normalized.students;
  const rooms = normalized.rooms;
  const assignmentIssues = useMemo(
    () => (students.length && rooms.length ? findAssignmentIssues(students, rooms, assignments) : []),
    [students, rooms, assignments]
  );
  const unassignedStudents = students.filter((student) => !assignments[student.id]);
  const unassignedGroups = useMemo(() => {
    const groups = new Map();
    unassignedStudents.forEach((student) => {
      if (!groups.has(student.gender)) groups.set(student.gender, []);
      groups.get(student.gender).push(student);
    });
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [unassignedStudents]);
  const selectedStudent = students.find((student) => student.id === selectedStudentId) || null;
  const sortedPreferenceColumns = useMemo(
    () =>
      [...preferenceColumns].sort((a, b) => {
        const weightDiff = Number(preferenceConfig[b]?.weight || 0) - Number(preferenceConfig[a]?.weight || 0);
        if (weightDiff !== 0) return weightDiff;
        return preferenceColumns.indexOf(a) - preferenceColumns.indexOf(b);
      }),
    [preferenceColumns, preferenceConfig]
  );
  const canConfigure =
    parsed.preferences.length > 0 &&
    (Array.isArray(columnMap.name) ? columnMap.name.length > 0 : Boolean(columnMap.name)) &&
    columnMap.gender;
  const canUseBoard = canConfigure && preferenceColumns.length > 0 && !normalized.error;
  const displayError = normalized.error || error;
  const stageIndex = Math.max(
    0,
    STAGES.findIndex((item) => item.id === stage)
  );
  const currentStage = STAGES[stageIndex];
  const totalRoomCount = singleRoomCount + doubleRoomCount;
  const totalCapacity = singleRoomCount + doubleRoomCount * 2;
  const hasEnoughBeds = parsed.preferences.length > 0 && totalCapacity >= parsed.preferences.length;
  const bedShortfall = Math.max(0, parsed.preferences.length - totalCapacity);
  const filesReady = parsed.preferences.length > 0 && totalRoomCount > 0 && hasEnoughBeds;
  const mappingReady = Boolean(canConfigure && preferenceColumns.length > 0);
  const keyReady = Boolean(canUseBoard);
  const canAdvance =
    stage === "files" ? filesReady : stage === "mapping" ? mappingReady : stage === "key" ? keyReady : false;

  useEffect(() => {
    setAssignments((prev) => {
      const validStudentIds = new Set(students.map((student) => student.id));
      const validRoomIds = new Set(rooms.map((room) => room.id));
      const next = {};
      students.forEach((student) => {
        const currentRoom = prev[student.id];
        next[student.id] = currentRoom && validRoomIds.has(currentRoom) ? currentRoom : "";
      });
      Object.keys(prev).forEach((studentId) => {
        if (!validStudentIds.has(studentId)) delete next[studentId];
      });
      return next;
    });
    setSelectedStudentId((current) => (students.some((student) => student.id === current) ? current : ""));
    setSelectedPairId((current) => (rooms.some((room) => room.id === current) ? current : ""));
    setExpandedStudentIds((current) => current.filter((studentId) => students.some((student) => student.id === studentId)));
    setExpandedPairIds((current) => current.filter((pairId) => rooms.some((room) => room.id === pairId)));
  }, [students, rooms]);

  function assignStudent(studentId, roomId) {
    setAssignments((prev) => ({ ...prev, [studentId]: roomId }));
    if (roomId) setSelectedPairId(roomId);
    setSelectedStudentId(studentId);
    setStatus("");
    setOptimizationProgress(null);
  }

  function handleDragStart(event, studentId) {
    setDraggedStudentId(studentId);
    event.dataTransfer.setData("text/plain", studentId);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleDrop(event, roomId) {
    event.preventDefault();
    const studentId = event.dataTransfer.getData("text/plain") || draggedStudentId;
    if (studentId) assignStudent(studentId, roomId);
    setDraggedStudentId("");
  }

  function handlePairClick(pairId) {
    if (selectedStudentId) {
      assignStudent(selectedStudentId, pairId);
      return;
    }
    setSelectedPairId(pairId);
  }

  function clearPair(pairId) {
    setAssignments((prev) => {
      const next = { ...prev };
      Object.entries(next).forEach(([studentId, assignedPairId]) => {
        if (assignedPairId === pairId) next[studentId] = "";
      });
      return next;
    });
    setSelectedPairId(pairId);
    setOptimizationProgress(null);
    setStatus("");
  }

  function getPairScore(pairStudents) {
    if (pairStudents.length < 2) return null;
    return calculateCompatibility(pairStudents[0], pairStudents[1], preferenceConfig);
  }

  function getCompatibilityBreakdown(studentA, studentB) {
    if (!studentA || !studentB) return [];
    return sortedPreferenceColumns.map((column) => {
      const config = preferenceConfig[column] || {};
      const weight = Number(config.weight);
      const a = studentA.encodedPreferences[column];
      const b = studentB.encodedPreferences[column];
      const contribution = Number.isFinite(weight) ? weight * Math.abs(a - b) : 0;
      return {
        column,
        aRaw: studentA.rawPreferences[column],
        bRaw: studentB.rawPreferences[column],
        contribution,
      };
    });
  }

  function toggleExpandedStudent(studentId) {
    setExpandedStudentIds((current) =>
      current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId]
    );
  }

  function toggleExpandedPair(pairId) {
    setExpandedPairIds((current) =>
      current.includes(pairId) ? current.filter((id) => id !== pairId) : [...current, pairId]
    );
  }

  async function optimizeUnassigned() {
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setError("");
    setStatus("");
    setOptimizationProgress({
      percent: 0,
      label: "Starting optimization",
      detail: "Preparing the pairing model.",
    });
    setIsSolving(true);
    try {
      const solver = optimizationMode === "byGender" ? solveRoomAssignmentByGender : solveRoomAssignment;
      const solveTimeLimit = Number(maxSolveTimeSeconds);
      const result = await solver(students, rooms, preferenceConfig, assignments, {
        onProgress: setOptimizationProgress,
        signal: abortController.signal,
        timeLimitSeconds: Number.isFinite(solveTimeLimit) && solveTimeLimit > 0 ? solveTimeLimit : undefined,
      });
      setAssignments(result.assignments);
      setStatus(
        optimizationMode === "byGender" && result.runs
          ? `Optimized ${unassignedStudents.length} unassigned student${unassignedStudents.length === 1 ? "" : "s"} across ${result.runs.length} gender run${result.runs.length === 1 ? "" : "s"}.`
          : `Optimized ${unassignedStudents.length} unassigned student${unassignedStudents.length === 1 ? "" : "s"}.`
      );
    } catch (solveError) {
      if (isAbortError(solveError)) {
        setStatus("Optimization canceled. Existing assignments were left unchanged.");
        setOptimizationProgress((prev) => ({
          ...(prev || {}),
          percent: prev?.percent || 0,
          label: "Optimization canceled",
          detail: "The GLPK run was stopped before applying any new assignments.",
          indeterminate: false,
        }));
      } else {
        setError(solveError.message || String(solveError));
        setOptimizationProgress((prev) => ({
          ...(prev || {}),
          percent: prev?.percent || 0,
          label: "Optimization stopped",
          detail: solveError.message || String(solveError),
          indeterminate: false,
        }));
      }
    } finally {
      setIsSolving(false);
      abortControllerRef.current = null;
    }
  }

  function cancelOptimization() {
    if (!abortControllerRef.current) return;
    abortControllerRef.current.abort();
    setStatus("Canceling optimization...");
    setOptimizationProgress((prev) => ({
      ...(prev || {}),
      label: "Cancel requested",
      detail: "Stopping GLPK and keeping current room assignments unchanged.",
      indeterminate: true,
    }));
  }

  function downloadAssignments() {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const rows = students.map((student) => {
      const room = roomById.get(assignments[student.id]);
      return {
        Name: student.name,
        Gender: student.gender,
        Pair: room ? room.label : "",
      };
    });
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pair_assignments.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function renderPreview(type, label) {
    const rows = parsed[type];
    const headers = fields[type];
    if (!rows.length) return null;
    return (
      <div className="preview" data-testid={`${type}-preview`}>
        <div className="preview__bar">
          <strong>{label} Preview</strong>
          <span>{rows.length} rows</span>
        </div>
        <div className="preview__tableWrap">
          <table>
            <thead>
              <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map((row, rowIndex) => (
                <tr key={`${type}-${rowIndex}`}>
                  {headers.map((header) => <td key={header}>{cleanValue(row[header])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function getRawPreferenceRow(student) {
    const index = Number(student.id.replace("student-", ""));
    return Number.isInteger(index) ? parsed.preferences[index] || {} : {};
  }

  function renderUploadDropzone(type, label) {
    const isActive = fileDragTarget === type;
    return (
      <label
        className={`uploadDropzone${isActive ? " uploadDropzone--active" : ""}`}
        onDragOver={(event) => handleFileDragOver(event, type)}
        onDragEnter={(event) => handleFileDragOver(event, type)}
        onDragLeave={(event) => handleFileDragLeave(event, type)}
        onDrop={(event) => handleFileDrop(event, type)}
      >
        <span>{label}</span>
        <strong>{isActive ? "Drop to upload" : "Drop CSV/TSV here"}</strong>
        <small>or click to choose a file</small>
        <input type="file" accept=".csv,.tsv" onChange={(event) => handleFile(event, type)} />
      </label>
    );
  }

  function renderStudentCard(student, options = {}) {
    const { showRemove = false } = options;
    const rawRow = getRawPreferenceRow(student);
    const isExpanded = expandedStudentIds.includes(student.id);
    const canExpand = sortedPreferenceColumns.length > 0 || miscColumns.length > 0;
    return (
      <article
        className={`studentCard${selectedStudentId === student.id ? " studentCard--selected" : ""}`}
        draggable
        onDragStart={(event) => handleDragStart(event, student.id)}
        onClick={() => setSelectedStudentId(student.id)}
        key={student.id}
      >
        <div className="studentCard__top">
          <strong>{student.name}</strong>
          <span>{student.gender}</span>
        </div>
        {isExpanded && sortedPreferenceColumns.length > 0 && (
          <dl>
            {sortedPreferenceColumns.map((column) => (
              <React.Fragment key={column}>
                <dt>{column}</dt>
                <dd>{student.rawPreferences[column]}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}
        {isExpanded && miscColumns.length > 0 && (
          <div className="studentCard__miscBlock">
            <div className="studentCard__sectionTitle">Extra Information</div>
            <dl className="studentCard__misc">
              {miscColumns.map((column) => (
                <React.Fragment key={column}>
                  <dt>{column}</dt>
                  <dd>{cleanValue(rawRow[column]) || "Blank"}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        )}
        {(canExpand || showRemove) && (
          <div className="studentCard__actions">
            {canExpand && (
              <button
                type="button"
                className="textButton"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleExpandedStudent(student.id);
                }}
              >
                {isExpanded ? "See less" : "See more"}
              </button>
            )}
            {showRemove && (
              <button
                type="button"
                className="textButton"
                onClick={(event) => {
                  event.stopPropagation();
                  assignStudent(student.id, "");
                }}
              >
                Remove
              </button>
            )}
          </div>
        )}
      </article>
    );
  }

  function renderOptimizationProgress() {
    if (!optimizationProgress) return null;
    const percent = Math.max(0, Math.min(100, Number(optimizationProgress.percent || 0)));
    return (
      <Paper className="progressPanel" variant="outlined" aria-label="Optimization progress">
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 2 }}>
          <Box>
            <Typography variant="subtitle1" fontWeight={800}>
              {optimizationProgress.label}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {optimizationProgress.detail}
            </Typography>
          </Box>
          <Typography variant="h6" color="primary" fontWeight={900}>
            {Math.round(percent)}%
          </Typography>
        </Box>
        <LinearProgress
          className={optimizationProgress.indeterminate && isSolving ? "progressTrack--active" : ""}
          variant={optimizationProgress.indeterminate && isSolving ? "indeterminate" : "determinate"}
          value={percent}
          aria-label="Optimization progress"
          sx={{ mt: 1.5, height: 10, borderRadius: 999 }}
        />
        {optimizationProgress.stats && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1.25 }}>
            <Chip size="small" label={`${optimizationProgress.stats.variables} binary variables`} />
            <Chip size="small" label={`${optimizationProgress.stats.constraints} constraints`} />
          </Box>
        )}
      </Paper>
    );
  }

  function renderOptimizationControls() {
    return (
      <section className="optimizerControls" aria-label="Optimization settings">
        <label className="field">
          <span>Optimization mode</span>
          <select
            value={optimizationMode}
            onChange={(event) => {
              setOptimizationMode(event.target.value);
              setOptimizationProgress(null);
            }}
            disabled={isSolving}
          >
            <option value="combined">Combined ILP for all genders</option>
            <option value="byGender">Run one ILP per gender</option>
          </select>
        </label>
        <label className="field">
          <span>Max solve time (seconds)</span>
          <input
            type="number"
            min="0"
            step="1"
            value={maxSolveTimeSeconds}
            onChange={(event) => {
              setMaxSolveTimeSeconds(event.target.value);
              setOptimizationProgress(null);
            }}
            disabled={isSolving}
          />
        </label>
        <p>
          {optimizationMode === "byGender"
            ? "Faster: solves one gender group at a time, largest group first. The time limit applies to each GLPK run; use 0 for no limit."
            : "Most global: solves all unassigned students together with same-gender room constraints. Use 0 for no time limit."}
        </p>
      </section>
    );
  }

  function goBack() {
    setStage(STAGES[Math.max(0, stageIndex - 1)].id);
  }

  function goNext() {
    if (!canAdvance) return;
    setStage(STAGES[Math.min(STAGES.length - 1, stageIndex + 1)].id);
  }

  function renderStepper() {
    return (
      <nav className="workflowSteps" aria-label="Workflow progress">
        {STAGES.map((item, index) => {
          const isReachable = index <= stageIndex || (index === stageIndex + 1 && canAdvance);
          const statusClass =
            index < stageIndex ? " workflowStep--complete" : index === stageIndex ? " workflowStep--active" : "";
          return (
            <button
              type="button"
              className={`workflowStep${statusClass}`}
              key={item.id}
              onClick={() => isReachable && setStage(item.id)}
              disabled={!isReachable || isSolving}
              aria-current={index === stageIndex ? "step" : undefined}
            >
              <span>{index + 1}</span>
              <strong>{item.label}</strong>
            </button>
          );
        })}
      </nav>
    );
  }

  function renderFilesStage() {
    return (
      <div className="stageContent">
        <div className="uploadSetup">
          <div className="uploadGrid">
            {renderUploadDropzone("preferences", "Preferences CSV")}
          </div>
          <section className="roomInventory" aria-label="Room inventory">
            <div>
              <h3>Room inventory</h3>
              <p>Enter how many room spots are available before mapping columns.</p>
            </div>
            <div className="roomInventory__grid">
              <label className="field">
                <span>Single rooms</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={singleRoomCount}
                  onChange={(event) => setSingleRoomCount(Math.max(0, Number(event.target.value) || 0))}
                />
              </label>
              <label className="field">
                <span>Double rooms</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={doubleRoomCount}
                  onChange={(event) => setDoubleRoomCount(Math.max(0, Number(event.target.value) || 0))}
                />
              </label>
            </div>
            <div className={`roomInventory__summary${parsed.preferences.length > 0 && !hasEnoughBeds ? " roomInventory__summary--warning" : ""}`}>
              <strong>{totalCapacity}</strong> beds across <strong>{totalRoomCount}</strong> rooms
              {parsed.preferences.length > 0 && !hasEnoughBeds && (
                <span> Add {parsed.preferences.length - totalCapacity} more bed{parsed.preferences.length - totalCapacity === 1 ? "" : "s"}.</span>
              )}
            </div>
          </section>
        </div>
        {parsed.preferences.length > 0 && !hasEnoughBeds && (
          <Alert severity="warning">
            Not enough beds for the uploaded file. You have {totalCapacity} bed{totalCapacity === 1 ? "" : "s"} for{" "}
            {parsed.preferences.length} student{parsed.preferences.length === 1 ? "" : "s"}; add {bedShortfall} more bed
            {bedShortfall === 1 ? "" : "s"} before continuing.
          </Alert>
        )}
        <div className="previewGrid">
          {renderPreview("preferences", "Preferences")}
        </div>
      </div>
    );
  }

  function renderMappingStage() {
    return (
      <div className="mappingStage">
        <div className="columnRoleList">
          {fields.preferences.map((field) => (
            <label className="columnRoleRow" key={field}>
              <span>{field}</span>
              <select value={getColumnRole(field)} onChange={(event) => setColumnRole(field, event.target.value)}>
                <option value="">Ignore this column</option>
                <option value="name">Name</option>
                <option value="gender">Gender</option>
                <option value="preference">Preference</option>
                <option value="misc">Extra Information</option>
              </select>
            </label>
          ))}
        </div>

        <div className="preferencePicker">
          <div className="panel__heading">
            <h3>Preference columns</h3>
            <span>{preferenceColumns.length} selected</span>
          </div>
          <div className="selectedColumns">
            {preferenceColumns.length > 0 ? preferenceColumns.map((field) => <span key={field}>{field}</span>) : <span>None selected</span>}
          </div>
        </div>
        <div className="preferencePicker">
          <div className="panel__heading">
            <h3>Extra Information columns</h3>
            <span>{miscColumns.length} selected</span>
          </div>
          <div className="selectedColumns selectedColumns--misc">
            {miscColumns.length > 0 ? miscColumns.map((field) => <span key={field}>{field}</span>) : <span>None selected</span>}
          </div>
        </div>
      </div>
    );
  }

  function renderKeyStage() {
    return (
      <div className="keyStage">
        <section className="keySection">
          <div className="keySection__header">
            <div>
              <h3>Preference weights</h3>
              <p>Set how strongly each preference contributes to compatibility.</p>
            </div>
            <span>{preferenceColumns.length} columns</span>
          </div>
          <div className="weightGrid">
            {preferenceColumns.map((column) => (
              <label className="weightCard" key={column}>
                <span>{column}</span>
                <input
                  aria-label={`${column} weight`}
                  type="number"
                  step="0.1"
                  value={preferenceConfig[column]?.weight ?? 1}
                  onChange={(event) => updateWeight(column, event.target.value)}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="keySection">
          <div className="keySection__header">
            <div>
              <h3>Value encodings</h3>
              <p>Convert each raw answer into a number. Closer numbers mean more compatible answers.</p>
            </div>
          </div>
          <div className="keyGrid">
            {preferenceColumns.map((column) => (
              <div className="keyCard" key={column}>
                <div className="keyCard__title">
                  <h4>{column}</h4>
                  <span>{uniqueValues(parsed.preferences, column).length} values</span>
                </div>
                <div className="encodingRows">
                  {uniqueValues(parsed.preferences, column).map((value) => (
                    <label className="encodingRow" key={value}>
                      <span>{value}</span>
                      <input
                        type="number"
                        step="0.1"
                        value={preferenceConfig[column]?.values?.[value] ?? ""}
                        onChange={(event) => updateEncoding(column, value, event.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderRosterPane() {
    return (
      <section className="workspacePane rosterPane" aria-label="Student roster">
        <div className="workspacePane__header">
          <div>
            <h2>Students</h2>
            <span>{unassignedStudents.length} unassigned</span>
          </div>
          {selectedStudent && (
            <button type="button" className="textButton" onClick={() => setSelectedStudentId("")}>
              Clear
            </button>
          )}
        </div>
        <div
          className="unassignedDropTarget"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => handleDrop(event, "")}
        >
          Drop here to unassign
        </div>
        <div className="unassignedGroupGrid">
          {unassignedGroups.map(([gender, groupStudents]) => (
            <div className="unassignedGroup" key={gender}>
              <div className="unassignedGroup__header">
                <strong>{gender}</strong>
                <span>{groupStudents.length}</span>
              </div>
              <div className="studentStack">{groupStudents.map((student) => renderStudentCard(student))}</div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  function renderPairBoard() {
    return (
      <section className="workspacePane pairBoardPane" aria-label="Room assignment board">
        <div className="workspacePane__header">
          <div>
            <h2>Rooms</h2>
            <span>{rooms.length} generated rooms</span>
          </div>
          {selectedStudent && <div className="selectedHint">Click a room to place {selectedStudent.name}</div>}
        </div>

        <div className="pairGroup__grid">
          {rooms.map((room) => {
            const roomStudents = getRoomStudents(room.id, students, assignments);
            const overCapacity = roomStudents.length > room.capacity;
            const genderConflict = roomStudents.length > 1 && new Set(roomStudents.map((student) => student.gender)).size > 1;
            const score = getPairScore(roomStudents);
            const isExpanded = expandedPairIds.includes(room.id);
            const breakdown = roomStudents.length >= 2 ? getCompatibilityBreakdown(roomStudents[0], roomStudents[1]) : [];
            return (
              <div
                className={`pairSlot${selectedPairId === room.id ? " pairSlot--selected" : ""}${overCapacity ? " pairSlot--danger" : ""}${genderConflict ? " pairSlot--warning" : ""}`}
                key={room.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDrop(event, room.id)}
                onClick={() => handlePairClick(room.id)}
              >
                <div className="pairSlot__header">
                  <div>
                    <h3>{room.label}</h3>
                    {score !== null && (
                      <Tooltip title="Lower compatibility scores are better." arrow>
                        <strong className="scoreTooltip" tabIndex={0}>Score {score.toFixed(2)}</strong>
                      </Tooltip>
                    )}
                  </div>
                  <span>{roomStudents.length} / {room.capacity}</span>
                </div>
                <div className="pairSlot__actions">
                  {roomStudents.length > 0 && (
                    <button
                      type="button"
                      className="textButton"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleExpandedPair(room.id);
                      }}
                    >
                      {isExpanded ? "See less" : "See more"}
                    </button>
                  )}
                  {roomStudents.length > 0 && (
                    <button
                      type="button"
                      className="textButton"
                      onClick={(event) => {
                        event.stopPropagation();
                        clearPair(room.id);
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {genderConflict && <div className="roomFlag">Gender conflict</div>}
                {overCapacity && <div className="roomFlag roomFlag--danger">Over capacity</div>}
                <div className="pairSlot__details">
                  {roomStudents.length > 0 ? (
                    <div className="studentStack">{roomStudents.map((student) => renderStudentCard(student, { showRemove: true }))}</div>
                  ) : (
                    <div className="emptyRoom">Empty</div>
                  )}
                  {isExpanded && score !== null && (
                    <div className="pairBreakdown">
                      <strong>Compatibility breakdown</strong>
                      <div className="breakdownList">
                        {breakdown.map((item) => (
                          <div className="breakdownRow" key={item.column}>
                            <div>
                              <strong>{item.column}</strong>
                              <span>{item.aRaw} / {item.bRaw}</span>
                            </div>
                            <b>{item.contribution.toFixed(2)}</b>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  function renderAssignStage() {
    return (
      <div className="assignmentStage">
        <div className="assignmentToolbar">
          {renderOptimizationControls()}
          <div className="assignmentToolbar__actions">
            <Button
              type="button"
              variant="contained"
              onClick={optimizeUnassigned}
              disabled={!canUseBoard || isSolving || unassignedStudents.length === 0}
            >
              {isSolving ? "Optimizing..." : "Optimize Unassigned"}
            </Button>
            {isSolving && (
              <Button type="button" color="error" variant="contained" onClick={cancelOptimization}>
                Cancel GLPK
              </Button>
            )}
            <Button
              type="button"
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={downloadAssignments}
              disabled={!canUseBoard || students.length === 0}
            >
              Download Matches
            </Button>
          </div>
        </div>
        {renderOptimizationProgress()}
        <div className="assignmentWorkspace">
          {renderRosterPane()}
          {renderPairBoard()}
        </div>
      </div>
    );
  }

  function renderStage() {
    if (stage === "files") return renderFilesStage();
    if (stage === "mapping") return renderMappingStage();
    if (stage === "key") return renderKeyStage();
    return renderAssignStage();
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box component="main" className="appShell">
        <AppBar position="static" color="inherit" elevation={0} className="topBar">
          <Toolbar disableGutters className="topBar__toolbar">
            <Box>
              <Typography variant="h1" component="h1">
                Bowles Resident Matching
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Upload preferences files and optimize roommate matches!
              </Typography>
            </Box>
            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <IconButton
                type="button"
                aria-label="Open workflow tutorial"
                color="primary"
                onClick={() => setTutorialOpen(true)}
              >
                <InfoOutlinedIcon />
              </IconButton>
            </Box>
          </Toolbar>
        </AppBar>

        <Dialog open={tutorialOpen} onClose={() => setTutorialOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>How the matching workflow works</DialogTitle>
          <DialogContent dividers>
            <Box sx={{ display: "grid", gap: 1.5 }}>
              <Typography variant="body2">
                1. Upload a preferences CSV or TSV and enter how many single and double rooms are available. The app previews the file locally in your browser.
              </Typography>
              <Typography variant="body2">
                2. Map columns. Choose Ignore this column for unused columns, map one or more columns to Name, choose Gender, and mark matching inputs as Preference or Extra Information.
              </Typography>
              <Typography variant="body2">
                3. Encode preferences. Set a weight for each preference column, then convert each raw answer into a numeric scale.
              </Typography>
              <Typography variant="body2">
                4. Assign rooms. Drag student cards into room cards, click a student then a room, or run the optimizer for students still unassigned. Use Max solve time to let GLPK stop early with the best feasible assignment it has found.
              </Typography>
              <Typography variant="body2">
                5. Review compatibility scores in rooms. Lower scores are better; expand a room to see the score breakdown, then download the final matches.
              </Typography>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setTutorialOpen(false)} variant="contained">
              Got it
            </Button>
          </DialogActions>
        </Dialog>

      {renderStepper()}

      {(displayError || status || assignmentIssues.length > 0) && (
        <Box className="messages">
          {displayError && <Alert severity="error">{displayError}</Alert>}
          {assignmentIssues.map((issue) => (
            <Alert severity="warning" key={issue}>
              {issue}
            </Alert>
          ))}
          {status && <Alert severity="info">{status}</Alert>}
        </Box>
      )}

      <Paper className="stagePanel" variant="outlined">
        <Box className="stagePanel__heading">
          <Box>
            <Typography className="eyebrow" component="p">
              Step {stageIndex + 1} of {STAGES.length}
            </Typography>
            <Typography variant="h5" component="h2" fontWeight={850}>
              {currentStage.title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {currentStage.description}
            </Typography>
          </Box>
          <Box className="stagePanel__summary" aria-label="Workspace summary">
            <Chip label={`${parsed.preferences.length} students`} />
            <Chip label={`${totalRoomCount} rooms`} />
            <Chip label={`${totalCapacity} beds`} />
          </Box>
        </Box>
        {renderStage()}
        <Box className="stageNav">
          <Button
            type="button"
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={goBack}
            disabled={stageIndex === 0 || isSolving}
          >
            Back
          </Button>
          {stage !== "assign" && (
            <Button
              type="button"
              variant="contained"
              endIcon={<ArrowForwardIcon />}
              onClick={goNext}
              disabled={!canAdvance || isSolving}
            >
              Next
            </Button>
          )}
        </Box>
      </Paper>
      </Box>
    </ThemeProvider>
  );
}

export default App;
