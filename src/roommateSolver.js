// roommateSolver.js
// Contains the LP model formulation and solving logic for roommate assignment
import GLPK from 'glpk.js';

/**
 * Build and solve the roommate assignment problem using GLPK.
 * @param {Array<Object>} preferences - Array of resident preference objects.
 * @param {Array<Object>} rooms - Array of room objects.
 * @param {Array<Object>} key - Array of key objects for mapping and weights.
 * @returns {Promise<{assignments: Array<{a: string, b: string, room: string}>, unassigned: Array<string>}>}
 */
export async function solveRoommateAssignment(preferences, rooms, key) {
  // Extract categories and weights from key
  const categories = key.filter(k => k.Weighting && k.Category).map(k => k.Category);
  const weights = key.filter(k => k.Weighting && k.Category).map(k => parseFloat(k.Weighting));
  const nameList = preferences.map(p => p.Name);
  const genderList = preferences.map(p => p.Gender);

  // Build mappings for categorical values
  const mappings = {};
  key.forEach(k => {
    if (k.Category) {
      mappings[k.Category] = {};
      [1,2,3,4].forEach(scale => {
        if (k[scale]) mappings[k.Category][k[scale]] = scale;
      });
    }
  });

  // Convert preferences to numeric matrix
  const prefMatrix = preferences.map(p =>
    categories.map(cat => {
      const val = p[cat];
      if (!isNaN(val)) return Number(val);
      if (mappings[cat] && mappings[cat][val]) return Number(mappings[cat][val]);
      return 2; // fallback
    })
  );

  // Compatibility function: sum weighted abs diff
  function compatibility(i, j) {
    let sum = 0;
    for (let k = 0; k < categories.length; ++k) {
      sum += weights[k] * Math.abs(prefMatrix[i][k] - prefMatrix[j][k]);
    }
    return sum;
  }

  // Build GLPK model
  const glpk = await GLPK();
  const binaries = [];
  const vars = [];
  const subjectTo = [];
  const roomCaps = rooms.map(r => Number(r.Capacity));
  let varNames = [];

  // For each possible pair (i<j), for each room, create a variable x_i_j_r
  for (let r = 0; r < roomCaps.length; ++r) {
    for (let i = 0; i < nameList.length; ++i) {
      for (let j = i+1; j < nameList.length; ++j) {
        if (genderList[i] !== genderList[j]) continue; // skip mixed gender
        const v = `x_${i}_${j}_${r}`;
        varNames.push(v);
        binaries.push(v);
        vars.push({ name: v, coef: compatibility(i, j) });
      }
    }
  }

  // Each resident in exactly one pair/room
  for (let i = 0; i < nameList.length; ++i) {
    let resVars = [];
    for (let r = 0; r < roomCaps.length; ++r) {
      for (let j = 0; j < nameList.length; ++j) {
        if (i === j) continue;
        const v = i < j ? `x_${i}_${j}_${r}` : `x_${j}_${i}_${r}`;
        if (varNames.includes(v)) {
          resVars.push({ name: v, coef: 1 });
        }
      }
    }
    subjectTo.push({
      name: `res_${i}`,
      vars: resVars,
      bnds: { type: glpk.GLP_FX, ub: 1, lb: 1 }
    });
  }

  // Room capacity constraints
  for (let r = 0; r < roomCaps.length; ++r) {
    let roomVars = [];
    for (let i = 0; i < nameList.length; ++i) {
      for (let j = i+1; j < nameList.length; ++j) {
        const v = `x_${i}_${j}_${r}`;
        if (varNames.includes(v)) {
          roomVars.push({ name: v, coef: 2 });
        }
      }
    }
    subjectTo.push({
      name: `room_${r}`,
      vars: roomVars,
      bnds: { type: glpk.GLP_UP, ub: roomCaps[r], lb: 0 }
    });
  }

  // Build LP object
  const lp = {
    name: 'roommate-matching',
    objective: {
      direction: glpk.GLP_MIN,
      name: 'obj',
      vars: vars
    },
    subjectTo: subjectTo,
    binaries: binaries
  };

  // Solve
  const result = await glpk.solve(lp, glpk.GLP_MSG_OFF);
  if (!result.result || !result.result.vars) {
    throw new Error("GLPK failed to find a solution. Status: " + (result.result ? result.result.status : "unknown"));
  }

  // Parse assignments
  let assignments = [];
  let assigned = new Set();
  for (let v of varNames) {
    if (result.result.vars[v] === 1) {
      const [/*x*/, i, j, r] = v.split('_');
      assignments.push({ a: nameList[i], b: nameList[j], room: rooms[r].Room || r });
      assigned.add(Number(i));
      assigned.add(Number(j));
    }
  }
  // Unassigned (if odd number)
  let unassigned = [];
  if (assigned.size < nameList.length) {
    for (let i = 0; i < nameList.length; ++i) {
      if (!assigned.has(i)) {
        unassigned.push(nameList[i]);
      }
    }
  }
  return { assignments, unassigned };
}
