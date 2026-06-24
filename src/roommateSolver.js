import GLPK from "glpk.js";

const EPSILON = 1e-7;

function createAbortError(message = "Optimization canceled.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function isAbortError(error) {
  return error && error.name === "AbortError";
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function pauseForPaint() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function reportProgress(onProgress, progress, signal) {
  throwIfAborted(signal);
  if (!onProgress) return;
  onProgress(progress);
  await pauseForPaint();
  throwIfAborted(signal);
}

function waitForAbort(signal, glpk) {
  return new Promise((resolve, reject) => {
    if (!signal) return;
    const abort = () => {
      if (glpk && typeof glpk.terminate === "function") {
        glpk.terminate();
      }
      reject(createAbortError());
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function initializeGlpk(signal) {
  throwIfAborted(signal);
  const glpk = await Promise.race([GLPK(), waitForAbort(signal)]);
  throwIfAborted(signal);
  return glpk;
}

async function solveWithCancellation(glpk, lp, options, signal) {
  throwIfAborted(signal);
  try {
    return await Promise.race([Promise.resolve(glpk.solve(lp, options)), waitForAbort(signal, glpk)]);
  } finally {
    if (glpk && typeof glpk.terminate === "function") {
      glpk.terminate();
    }
  }
}

export function cleanValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function isNumericValue(value) {
  if (value === null || value === undefined || cleanValue(value) === "") {
    return false;
  }
  return Number.isFinite(Number(value));
}

export function uniqueValues(rows, column) {
  const seen = new Set();
  rows.forEach((row) => {
    const value = cleanValue(row[column]);
    if (value !== "") seen.add(value);
  });
  return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function buildDefaultPreferenceConfig(rows, columns) {
  const config = {};
  columns.forEach((column) => {
    const values = uniqueValues(rows, column);
    const encodings = {};
    values.forEach((value, index) => {
      encodings[value] = isNumericValue(value) ? Number(value) : index + 1;
    });
    config[column] = {
      weight: 1,
      values: encodings,
    };
  });
  return config;
}

export function encodePreferenceValue(value, columnConfig, columnName) {
  const cleaned = cleanValue(value);
  if (cleaned === "") {
    throw new Error(`Missing preference value for "${columnName}".`);
  }
  if (Object.prototype.hasOwnProperty.call(columnConfig.values, cleaned)) {
    const rawEncoding = columnConfig.values[cleaned];
    if (cleanValue(rawEncoding) === "") {
      throw new Error(`Encoding for "${cleaned}" in "${columnName}" must be numeric.`);
    }
    const encoded = Number(rawEncoding);
    if (Number.isFinite(encoded)) return encoded;
    throw new Error(`Encoding for "${cleaned}" in "${columnName}" must be numeric.`);
  }
  if (isNumericValue(cleaned)) return Number(cleaned);
  throw new Error(`No numeric encoding for "${cleaned}" in "${columnName}".`);
}

export function validatePreferenceConfig(preferenceConfig) {
  Object.entries(preferenceConfig).forEach(([column, config]) => {
    if (cleanValue(config.weight) === "" || !Number.isFinite(Number(config.weight))) {
      throw new Error(`Weight for "${column}" must be numeric.`);
    }
    Object.entries(config.values || {}).forEach(([rawValue, encoded]) => {
      if (cleanValue(encoded) === "" || !Number.isFinite(Number(encoded))) {
        throw new Error(`Encoding for "${rawValue}" in "${column}" must be numeric.`);
      }
    });
  });
}

export function normalizeStudents(rows, columnMap, preferenceConfig) {
  validatePreferenceConfig(preferenceConfig);
  const preferenceColumns = Object.keys(preferenceConfig);
  const nameColumns = Array.isArray(columnMap.name) ? columnMap.name : [columnMap.name].filter(Boolean);
  return rows.map((row, index) => {
    const name = nameColumns.map((column) => cleanValue(row[column])).filter(Boolean).join(" ");
    const gender = cleanValue(row[columnMap.gender]);
    if (!name) throw new Error(`Student row ${index + 1} is missing a name.`);
    if (!gender) throw new Error(`Student row ${index + 1} is missing a gender.`);

    const rawPreferences = {};
    const encodedPreferences = {};
    preferenceColumns.forEach((column) => {
      rawPreferences[column] = cleanValue(row[column]);
      encodedPreferences[column] = encodePreferenceValue(
        row[column],
        preferenceConfig[column],
        column
      );
    });

    return {
      id: `student-${index}`,
      name,
      gender,
      rawPreferences,
      encodedPreferences,
    };
  });
}

export function normalizeRooms(rows, columnMap) {
  const labels = new Set();
  return rows.map((row, index) => {
    const label = cleanValue(row[columnMap.room]);
    const capacity = Number(row[columnMap.capacity]);
    if (!label) throw new Error(`Room row ${index + 1} is missing a room label.`);
    if (labels.has(label)) throw new Error(`Room "${label}" appears more than once.`);
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`Room "${label}" must have a positive whole-number capacity.`);
    }
    labels.add(label);
    return {
      id: `room-${index}`,
      label,
      capacity,
    };
  });
}

export function calculateCompatibility(studentA, studentB, preferenceConfig) {
  return Object.entries(preferenceConfig).reduce((sum, [column, config]) => {
    const weight = Number(config.weight);
    if (!Number.isFinite(weight)) {
      throw new Error(`Weight for "${column}" must be numeric.`);
    }
    const a = studentA.encodedPreferences[column];
    const b = studentB.encodedPreferences[column];
    return sum + weight * Math.abs(a - b);
  }, 0);
}

export function getRoomStudents(roomId, students, assignments) {
  return students.filter((student) => assignments[student.id] === roomId);
}

export function roomHasGenderConflict(students) {
  return new Set(students.map((student) => student.gender)).size > 1;
}

export function findAssignmentIssues(students, rooms, assignments) {
  const issues = [];
  rooms.forEach((room) => {
    const occupants = getRoomStudents(room.id, students, assignments);
    if (occupants.length > room.capacity) {
      issues.push(`${room.label} is over capacity (${occupants.length}/${room.capacity}).`);
    }
    if (occupants.length > 1 && roomHasGenderConflict(occupants)) {
      issues.push(`${room.label} has a gender conflict.`);
    }
  });
  return issues;
}

function variableValue(vars, name) {
  const value = vars[name] || 0;
  return Math.abs(value - 1) < EPSILON ? 1 : value;
}

function resultIsUsable(glpk, status) {
  return status === glpk.GLP_OPT || status === glpk.GLP_FEAS || status === 5 || status === 2;
}

function resultIsProvenInfeasible(glpk, status) {
  return status === glpk.GLP_INFEAS || status === glpk.GLP_NOFEAS || status === 3 || status === 4;
}

function selectRoomsForGenderRun(students, rooms, assignments, gender, studentCount) {
  const candidates = rooms
    .map((room) => {
      const occupants = getRoomStudents(room.id, students, assignments);
      const occupantGenders = new Set(occupants.map((student) => student.gender));
      const isEmpty = occupants.length === 0;
      const isSameGender = occupantGenders.size === 1 && occupantGenders.has(gender);
      return {
        room,
        remainingCapacity: room.capacity - occupants.length,
        isEmpty,
        isSameGender,
      };
    })
    .filter((candidate) => candidate.remainingCapacity > 0 && (candidate.isEmpty || candidate.isSameGender));

  const largestRoomCapacity = Math.max(0, ...candidates.map((candidate) => candidate.remainingCapacity));
  const maxCapacity = studentCount + largestRoomCapacity;
  const sortedCandidates = candidates.sort((a, b) => {
    if (a.isSameGender !== b.isSameGender) return a.isSameGender ? -1 : 1;
    if (a.remainingCapacity !== b.remainingCapacity) return a.remainingCapacity - b.remainingCapacity;
    return a.room.label.localeCompare(b.room.label, undefined, { numeric: true });
  });
  const bestByCapacity = new Map([[0, { rooms: [], count: 0 }]]);

  sortedCandidates.forEach((candidate) => {
    const entries = Array.from(bestByCapacity.entries());
    entries.forEach(([capacity, choice]) => {
      const nextCapacity = capacity + candidate.remainingCapacity;
      if (nextCapacity > maxCapacity) return;
      const current = bestByCapacity.get(nextCapacity);
      const nextChoice = {
        rooms: [...choice.rooms, candidate.room],
        count: choice.count + 1,
      };
      if (!current || nextChoice.count < current.count) {
        bestByCapacity.set(nextCapacity, nextChoice);
      }
    });
  });

  let best = null;
  for (let capacity = studentCount; capacity <= maxCapacity; capacity += 1) {
    const choice = bestByCapacity.get(capacity);
    if (!choice) continue;
    if (!best || capacity < best.capacity || (capacity === best.capacity && choice.count < best.choice.count)) {
      best = { capacity, choice };
    }
  }

  if (!best) {
    const capacity = candidates.reduce((sum, candidate) => sum + candidate.remainingCapacity, 0);
    throw new Error(`Only ${capacity} compatible open bed${capacity === 1 ? "" : "s"} available for ${studentCount} student${studentCount === 1 ? "" : "s"}.`);
  }

  return best.choice.rooms;
}

export async function solveRoomAssignment(students, rooms, preferenceConfig, assignments, options = {}) {
  const { candidateStudentIds, onProgress, signal, timeLimitSeconds } = options;
  const candidateSet = candidateStudentIds ? new Set(candidateStudentIds) : null;
  await reportProgress(onProgress, {
    percent: 5,
    label: "Checking manual assignments",
    detail: "Validating room capacities and gender constraints before building the model.",
  }, signal);

  const manualIssues = findAssignmentIssues(students, rooms, assignments);
  if (manualIssues.length > 0) {
    throw new Error(`Resolve manual assignment issues before optimizing: ${manualIssues.join(" ")}`);
  }

  const unassignedStudents = students.filter(
    (student) => !assignments[student.id] && (!candidateSet || candidateSet.has(student.id))
  );
  if (unassignedStudents.length === 0) {
    await reportProgress(onProgress, {
      percent: 100,
      label: "Already optimized",
      detail: "No unassigned students were available for the solver.",
    }, signal);
    return { assignments: { ...assignments }, objective: 0 };
  }

  const fixedByRoom = new Map();
  rooms.forEach((room) => {
    fixedByRoom.set(room.id, getRoomStudents(room.id, students, assignments));
  });

  const partialRooms = [];
  const emptyRooms = [];
  const emptyDoubleRooms = [];
  rooms.forEach((room) => {
    const fixedStudents = fixedByRoom.get(room.id) || [];
    const remainingCapacity = room.capacity - fixedStudents.length;
    if (remainingCapacity <= 0) return;
    if (fixedStudents.length === 0) {
      emptyRooms.push(room);
      if (room.capacity >= 2) emptyDoubleRooms.push(room);
      return;
    }
    if (remainingCapacity === 1) {
      partialRooms.push({ room, fixedStudent: fixedStudents[0] });
    } else {
      throw new Error(
        `Room "${room.label}" has ${remainingCapacity} open beds. The current optimized solver supports single and double rooms only.`
      );
    }
  });

  const openBedCount = emptyRooms.reduce((sum, room) => sum + room.capacity, 0) + partialRooms.length;
  if (openBedCount < unassignedStudents.length) {
    throw new Error(`Only ${openBedCount} open bed${openBedCount === 1 ? "" : "s"} available for ${unassignedStudents.length} unassigned student${unassignedStudents.length === 1 ? "" : "s"}.`);
  }

  await reportProgress(onProgress, {
    percent: 12,
    label: "Preparing compact pairing model",
    detail: `${unassignedStudents.length} unassigned student${unassignedStudents.length === 1 ? "" : "s"} will be optimized with ${emptyDoubleRooms.length} open double room${emptyDoubleRooms.length === 1 ? "" : "s"}, ${emptyRooms.length} empty room${emptyRooms.length === 1 ? "" : "s"}, and ${partialRooms.length} partially filled double room${partialRooms.length === 1 ? "" : "s"}.`,
  }, signal);

  const glpk = await initializeGlpk(signal);
  const binaries = [];
  const objectiveVars = [];
  const subjectTo = [];
  const pairVars = [];
  const soloVars = [];
  const fillVars = [];
  const varsByStudent = new Map(unassignedStudents.map((student) => [student.id, []]));
  const addStudentVar = (studentId, name, coef = 1) => {
    varsByStudent.get(studentId).push({ name, coef });
  };

  unassignedStudents.forEach((student, studentIndex) => {
    const name = `solo_${studentIndex}`;
    binaries.push(name);
    soloVars.push({ name, student });
    addStudentVar(student.id, name);
  });

  partialRooms.forEach(({ room, fixedStudent }, roomIndex) => {
    unassignedStudents.forEach((student, studentIndex) => {
      if (student.gender !== fixedStudent.gender) return;
      const name = `fill_${studentIndex}_${roomIndex}`;
      binaries.push(name);
      fillVars.push({ name, student, room, fixedStudent });
      addStudentVar(student.id, name);
      objectiveVars.push({
        name,
        coef: calculateCompatibility(student, fixedStudent, preferenceConfig),
      });
    });
  });

  for (let a = 0; a < unassignedStudents.length; a += 1) {
    for (let b = a + 1; b < unassignedStudents.length; b += 1) {
      const studentA = unassignedStudents[a];
      const studentB = unassignedStudents[b];
      if (studentA.gender !== studentB.gender) continue;
      const name = `pair_${a}_${b}`;
      binaries.push(name);
      pairVars.push({ name, students: [studentA, studentB] });
      addStudentVar(studentA.id, name);
      addStudentVar(studentB.id, name);
      objectiveVars.push({
        name,
        coef: calculateCompatibility(studentA, studentB, preferenceConfig),
      });
    }
  }

  await reportProgress(onProgress, {
    percent: 30,
    label: "Created pairing variables",
    detail: `${pairVars.length} same-gender pair choices, ${soloVars.length} solo choices, and ${fillVars.length} locked-room fill choices are feasible.`,
    stats: { variables: binaries.length, constraints: subjectTo.length },
  }, signal);

  unassignedStudents.forEach((student, studentIndex) => {
    const vars = varsByStudent.get(student.id) || [];
    if (vars.length === 0) {
      throw new Error(`No feasible room is available for ${student.name}.`);
    }
    subjectTo.push({
      name: `assign_${studentIndex}`,
      vars,
      bnds: { type: glpk.GLP_FX, lb: 1, ub: 1 },
    });
  });

  await reportProgress(onProgress, {
    percent: 45,
    label: "Added student constraints",
    detail: "Each unassigned student must be chosen exactly once as a solo, fixed-room fill, or pair member.",
    stats: { variables: binaries.length, constraints: subjectTo.length },
  }, signal);

  partialRooms.forEach((roomInfo, roomIndex) => {
    const vars = fillVars
      .filter((variable) => variable.room.id === roomInfo.room.id)
      .map((variable) => ({ name: variable.name, coef: 1 }));
    subjectTo.push({
      name: `fill_capacity_${roomIndex}`,
      vars,
      bnds: { type: glpk.GLP_UP, lb: 0, ub: 1 },
    });
  });

  subjectTo.push({
    name: "empty_double_rooms",
    vars: pairVars.map((variable) => ({ name: variable.name, coef: 1 })),
    bnds: { type: glpk.GLP_UP, lb: 0, ub: emptyDoubleRooms.length },
  });
  subjectTo.push({
    name: "empty_rooms",
    vars: [
      ...pairVars.map((variable) => ({ name: variable.name, coef: 1 })),
      ...soloVars.map((variable) => ({ name: variable.name, coef: 1 })),
    ],
    bnds: { type: glpk.GLP_UP, lb: 0, ub: emptyRooms.length },
  });

  await reportProgress(onProgress, {
    percent: 70,
    label: "Added room inventory constraints",
    detail: "The model now limits selected pairs to open double rooms and selected solos to available empty rooms.",
    stats: { variables: binaries.length, constraints: subjectTo.length },
  }, signal);

  const lp = {
    name: "room-assignment",
    objective: {
      direction: glpk.GLP_MIN,
      name: "compatibility",
      vars: objectiveVars,
    },
    subjectTo,
    binaries,
  };

  await reportProgress(onProgress, {
    percent: 85,
    label: "Running GLPK solver",
    detail: "The browser solver is optimizing the compact pair/single model. You can cancel this GLPK run without changing current assignments.",
    indeterminate: true,
    stats: { variables: binaries.length, constraints: subjectTo.length },
  }, signal);

  const solveOptions = {
    msglev: glpk.GLP_MSG_OFF,
    ...(Number.isFinite(Number(timeLimitSeconds)) && Number(timeLimitSeconds) > 0
      ? { tmlim: Number(timeLimitSeconds) }
      : {}),
  };
  const result = await solveWithCancellation(glpk, lp, solveOptions, signal);
  if (!result.result || !result.result.vars || !resultIsUsable(glpk, result.result.status)) {
    if (
      Number.isFinite(Number(timeLimitSeconds)) &&
      Number(timeLimitSeconds) > 0 &&
      !resultIsProvenInfeasible(glpk, result.result?.status)
    ) {
      throw new Error(
        `GLPK stopped after ${Number(timeLimitSeconds)} second${Number(timeLimitSeconds) === 1 ? "" : "s"} before finding a feasible assignment. The room counts may still be feasible; try increasing max solve time, using one ILP per gender, or manually assigning a few rooms first.`
      );
    }
    throw new Error("No feasible room assignment was found for the unassigned students.");
  }

  const nextAssignments = { ...assignments };
  const usedEmptyRoomIds = new Set();
  fillVars.forEach((variable) => {
    if (variableValue(result.result.vars, variable.name) !== 1) return;
    nextAssignments[variable.student.id] = variable.room.id;
  });

  const availableDoubleRooms = emptyDoubleRooms.filter((room) => !usedEmptyRoomIds.has(room.id));
  pairVars.forEach((variable) => {
    if (variableValue(result.result.vars, variable.name) !== 1) return;
    const room = availableDoubleRooms.shift();
    if (!room) throw new Error("Solver selected more pairs than available double rooms.");
    usedEmptyRoomIds.add(room.id);
    variable.students.forEach((student) => {
      nextAssignments[student.id] = room.id;
    });
  });

  const remainingEmptyRooms = emptyRooms
    .filter((room) => !usedEmptyRoomIds.has(room.id))
    .sort((a, b) => {
      if (a.capacity !== b.capacity) return a.capacity - b.capacity;
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    });
  soloVars.forEach((variable) => {
    if (variableValue(result.result.vars, variable.name) !== 1) return;
    const room = remainingEmptyRooms.shift();
    if (!room) throw new Error("Solver selected more solo assignments than available rooms.");
    usedEmptyRoomIds.add(room.id);
    nextAssignments[variable.student.id] = room.id;
  });

  unassignedStudents.forEach((student) => {
    if (!nextAssignments[student.id]) throw new Error(`Solver did not assign ${student.name}.`);
  });

  await reportProgress(onProgress, {
    percent: 100,
    label: "Optimization complete",
    detail: `Assigned ${unassignedStudents.length} student${unassignedStudents.length === 1 ? "" : "s"} with objective ${Number(result.result.z || 0).toFixed(2)}.`,
    stats: { variables: binaries.length, constraints: subjectTo.length },
  }, signal);

  return {
    assignments: nextAssignments,
    objective: result.result.z,
  };
}

export async function solveRoomAssignmentByGender(students, rooms, preferenceConfig, assignments, options = {}) {
  const { onProgress, signal, timeLimitSeconds } = options;
  const groups = new Map();
  students.forEach((student) => {
    if (assignments[student.id]) return;
    if (!groups.has(student.gender)) groups.set(student.gender, []);
    groups.get(student.gender).push(student);
  });

  const orderedGroups = Array.from(groups.entries()).sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0].localeCompare(b[0], undefined, { numeric: true });
  });

  if (orderedGroups.length === 0) {
    await reportProgress(onProgress, {
      percent: 100,
      label: "Already optimized",
      detail: "No unassigned students were available for the solver.",
    }, signal);
    return { assignments: { ...assignments }, objective: 0, runs: [] };
  }

  let nextAssignments = { ...assignments };
  let objective = 0;
  const runs = [];

  for (let index = 0; index < orderedGroups.length; index += 1) {
    throwIfAborted(signal);
    const [gender, groupStudents] = orderedGroups[index];
    const runStart = (index / orderedGroups.length) * 100;
    const runWidth = 100 / orderedGroups.length;
    const runRooms = selectRoomsForGenderRun(students, rooms, nextAssignments, gender, groupStudents.length);

    try {
      const result = await solveRoomAssignment(students, runRooms, preferenceConfig, nextAssignments, {
        candidateStudentIds: groupStudents.map((student) => student.id),
        signal,
        timeLimitSeconds,
        onProgress: (progress) => {
          if (!onProgress) return;
          onProgress({
            ...progress,
            percent: Math.min(100, runStart + ((progress.percent || 0) * runWidth) / 100),
            label: `Gender ${gender}: ${progress.label}`,
            detail: `${groupStudents.length} student${groupStudents.length === 1 ? "" : "s"} and ${runRooms.length} room${runRooms.length === 1 ? "" : "s"} in this run. ${progress.detail}`,
          });
        },
      });

      nextAssignments = result.assignments;
      objective += Number(result.objective || 0);
      runs.push({
        gender,
        rooms: runRooms.length,
        students: groupStudents.length,
        objective: Number(result.objective || 0),
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new Error(`No feasible assignment was found for gender ${gender}. ${error.message || error}`);
    }
  }

  await reportProgress(onProgress, {
    percent: 100,
    label: "Gender-split optimization complete",
    detail: `Completed ${orderedGroups.length} gender run${orderedGroups.length === 1 ? "" : "s"}.`,
  }, signal);

  return { assignments: nextAssignments, objective, runs };
}
