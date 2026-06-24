import {
  buildDefaultPreferenceConfig,
  calculateCompatibility,
  normalizeRooms,
  normalizeStudents,
  solveRoomAssignment,
  solveRoomAssignmentByGender,
} from "./roommateSolver";

const preferenceRows = [
  { Name: "Avery", Gender: "F", Sleep: "Early" },
  { Name: "Blair", Gender: "F", Sleep: "Late" },
  { Name: "Casey", Gender: "M", Sleep: "Early" },
  { Name: "Devon", Gender: "M", Sleep: "Late" },
];

const preferenceConfig = {
  Sleep: {
    weight: 2,
    values: {
      Early: 1,
      Late: 3,
    },
  },
};

function baseStudents() {
  return normalizeStudents(preferenceRows, { name: "Name", gender: "Gender" }, preferenceConfig);
}

function roomOccupants(students, assignments, roomId) {
  return students.filter((student) => assignments[student.id] === roomId);
}

function generatedRooms(singleCount, doubleCount) {
  return [
    ...Array.from({ length: singleCount }, (_, index) => ({ Room: `Single ${index + 1}`, Capacity: "1" })),
    ...Array.from({ length: doubleCount }, (_, index) => ({ Room: `Double ${index + 1}`, Capacity: "2" })),
  ];
}

test("builds default text encodings and calculates weighted compatibility", () => {
  const config = buildDefaultPreferenceConfig(preferenceRows, ["Sleep"]);
  expect(config.Sleep.values).toEqual({ Early: 1, Late: 2 });

  const students = baseStudents();
  expect(calculateCompatibility(students[0], students[1], preferenceConfig)).toBe(4);
});

test("rejects missing numeric preference encodings", () => {
  expect(() =>
    normalizeStudents(
      preferenceRows,
      { name: "Name", gender: "Gender" },
      { Sleep: { weight: 1, values: { Early: "", Late: 2 } } }
    )
  ).toThrow(/encoding for "early"/i);
});

test("normalizes names from multiple mapped columns", () => {
  const students = normalizeStudents(
    [
      { First: "Avery", Last: "Stone", Gender: "F", Sleep: "Early" },
      { First: "Blair", Last: "Patel", Gender: "F", Sleep: "Late" },
    ],
    { name: ["First", "Last"], gender: "Gender" },
    preferenceConfig
  );

  expect(students.map((student) => student.name)).toEqual(["Avery Stone", "Blair Patel"]);
});

test("normalizes rooms and rejects invalid capacities", () => {
  expect(normalizeRooms([{ Room: "101", Capacity: "2" }], { room: "Room", capacity: "Capacity" })).toEqual([
    { id: "room-0", label: "101", capacity: 2 },
  ]);

  expect(() =>
    normalizeRooms([{ Room: "102", Capacity: "0" }], { room: "Room", capacity: "Capacity" })
  ).toThrow(/positive whole-number capacity/i);
});

test("solver respects locked manual assignments and fills remaining capacity", async () => {
  const students = baseStudents();
  const rooms = normalizeRooms(
    [
      { Room: "101", Capacity: "2" },
      { Room: "102", Capacity: "2" },
    ],
    { room: "Room", capacity: "Capacity" }
  );
  const assignments = {
    [students[0].id]: rooms[0].id,
  };

  const result = await solveRoomAssignment(students, rooms, preferenceConfig, assignments);

  expect(result.assignments[students[0].id]).toBe(rooms[0].id);
  expect(result.assignments[students[1].id]).toBe(rooms[0].id);
  expect(result.assignments[students[2].id]).toBe(rooms[1].id);
  expect(result.assignments[students[3].id]).toBe(rooms[1].id);
});

test("solver handles large odd/even gender inventory with singles and doubles", async () => {
  const rows = [
    ...Array.from({ length: 51 }, (_, index) => ({
      Name: `Female ${index + 1}`,
      Gender: "Female",
      Sleep: index % 2 === 0 ? "Early" : "Late",
    })),
    ...Array.from({ length: 34 }, (_, index) => ({
      Name: `Male ${index + 1}`,
      Gender: "Male",
      Sleep: index % 2 === 0 ? "Early" : "Late",
    })),
  ];
  const students = normalizeStudents(rows, { name: "Name", gender: "Gender" }, preferenceConfig);
  const rooms = normalizeRooms(generatedRooms(5, 40), { room: "Room", capacity: "Capacity" });

  const result = await solveRoomAssignment(students, rooms, preferenceConfig, {}, { timeLimitSeconds: 10 });
  const roomSizes = rooms.map((room) => roomOccupants(students, result.assignments, room.id).length);
  const mixedGenderRooms = rooms.filter((room) => {
    const genders = new Set(roomOccupants(students, result.assignments, room.id).map((student) => student.gender));
    return genders.size > 1;
  });

  expect(Object.keys(result.assignments)).toHaveLength(85);
  expect(roomSizes.filter((size) => size === 1)).toHaveLength(5);
  expect(roomSizes.filter((size) => size === 2)).toHaveLength(40);
  expect(mixedGenderRooms).toHaveLength(0);
});

test("gender-split solver preserves enough rooms for later genders", async () => {
  const rows = [
    ...Array.from({ length: 51 }, (_, index) => ({
      Name: `Female ${index + 1}`,
      Gender: "Female",
      Sleep: index % 2 === 0 ? "Early" : "Late",
    })),
    ...Array.from({ length: 34 }, (_, index) => ({
      Name: `Male ${index + 1}`,
      Gender: "Male",
      Sleep: index % 2 === 0 ? "Early" : "Late",
    })),
  ];
  const students = normalizeStudents(rows, { name: "Name", gender: "Gender" }, preferenceConfig);
  const rooms = normalizeRooms(generatedRooms(5, 40), { room: "Room", capacity: "Capacity" });

  const result = await solveRoomAssignmentByGender(students, rooms, preferenceConfig, {}, { timeLimitSeconds: 10 });
  const femaleRooms = new Set(students.filter((student) => student.gender === "Female").map((student) => result.assignments[student.id]));
  const maleRooms = new Set(students.filter((student) => student.gender === "Male").map((student) => result.assignments[student.id]));

  expect(Object.keys(result.assignments)).toHaveLength(85);
  expect(result.runs.map((run) => run.gender)).toEqual(["Female", "Male"]);
  expect(femaleRooms.size).toBe(26);
  expect(maleRooms.size).toBe(19);
});

test("solver can fill a locked partial double with the same gender", async () => {
  const students = baseStudents();
  const rooms = normalizeRooms(
    [
      { Room: "Locked Double", Capacity: "2" },
      { Room: "Open Double", Capacity: "2" },
      { Room: "Single", Capacity: "1" },
    ],
    { room: "Room", capacity: "Capacity" }
  );
  const assignments = {
    [students[0].id]: rooms[0].id,
  };

  const result = await solveRoomAssignment(students, rooms, preferenceConfig, assignments);

  expect(result.assignments[students[0].id]).toBe(rooms[0].id);
  expect(result.assignments[students[1].id]).toBe(rooms[0].id);
  expect(roomOccupants(students, result.assignments, rooms[0].id).map((student) => student.gender)).toEqual(["F", "F"]);
});

test("solver reports transparent optimization progress", async () => {
  const students = baseStudents().slice(0, 2);
  const rooms = normalizeRooms([{ Room: "101", Capacity: "2" }], { room: "Room", capacity: "Capacity" });
  const events = [];

  await solveRoomAssignment(students, rooms, preferenceConfig, {}, { onProgress: (event) => events.push(event) });

  expect(events[0].label).toMatch(/checking manual assignments/i);
  expect(events.some((event) => event.label.match(/running glpk solver/i))).toBe(true);
  expect(events[events.length - 1].percent).toBe(100);
  expect(events[events.length - 1].stats.variables).toBeGreaterThan(0);
});

test("solver can be canceled before assignments are applied", async () => {
  const students = baseStudents().slice(0, 2);
  const rooms = normalizeRooms([{ Room: "101", Capacity: "2" }], { room: "Room", capacity: "Capacity" });
  const controller = new AbortController();

  await expect(
    solveRoomAssignment(students, rooms, preferenceConfig, {}, {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    })
  ).rejects.toMatchObject({ name: "AbortError" });
});

test("solver optimizes total group pairwise compatibility", async () => {
  const rows = [
    { Name: "One", Gender: "F", Cleanliness: "1" },
    { Name: "Two", Gender: "F", Cleanliness: "2" },
    { Name: "Ten", Gender: "F", Cleanliness: "10" },
  ];
  const config = buildDefaultPreferenceConfig(rows, ["Cleanliness"]);
  const students = normalizeStudents(rows, { name: "Name", gender: "Gender" }, config);
  const rooms = normalizeRooms(
    [
      { Room: "Small", Capacity: "1" },
      { Room: "Double", Capacity: "2" },
    ],
    { room: "Room", capacity: "Capacity" }
  );

  const result = await solveRoomAssignment(students, rooms, config, {});

  expect(result.assignments[students[0].id]).toBe(result.assignments[students[1].id]);
  expect(result.assignments[students[2].id]).not.toBe(result.assignments[students[0].id]);
});

test("solver rejects infeasible same-gender room assignments", async () => {
  const students = baseStudents();
  const rooms = normalizeRooms([{ Room: "Only", Capacity: "4" }], { room: "Room", capacity: "Capacity" });

  await expect(solveRoomAssignment(students, rooms, preferenceConfig, {})).rejects.toThrow(/no feasible/i);
});

test("solver can run separate optimizations by gender", async () => {
  const students = baseStudents();
  const rooms = normalizeRooms(
    [
      { Room: "101", Capacity: "2" },
      { Room: "102", Capacity: "2" },
    ],
    { room: "Room", capacity: "Capacity" }
  );

  const result = await solveRoomAssignmentByGender(students, rooms, preferenceConfig, {});
  const femaleRooms = new Set(students.filter((student) => student.gender === "F").map((student) => result.assignments[student.id]));
  const maleRooms = new Set(students.filter((student) => student.gender === "M").map((student) => result.assignments[student.id]));

  expect(result.runs).toHaveLength(2);
  expect(femaleRooms.size).toBe(1);
  expect(maleRooms.size).toBe(1);
  expect([...femaleRooms][0]).not.toBe([...maleRooms][0]);
});

test("gender values are treated as categorical strings, not numeric encodings", async () => {
  const rows = [
    { Name: "Avery", Gender: "Woman", Sleep: "Early" },
    { Name: "Blair", Gender: "Woman", Sleep: "Late" },
    { Name: "Casey", Gender: "Man", Sleep: "Early" },
    { Name: "Devon", Gender: "Man", Sleep: "Late" },
  ];
  const students = normalizeStudents(rows, { name: "Name", gender: "Gender" }, preferenceConfig);
  const rooms = normalizeRooms(
    [
      { Room: "101", Capacity: "2" },
      { Room: "102", Capacity: "2" },
    ],
    { room: "Room", capacity: "Capacity" }
  );

  const result = await solveRoomAssignmentByGender(students, rooms, preferenceConfig, {});
  const womenRooms = new Set(students.filter((student) => student.gender === "Woman").map((student) => result.assignments[student.id]));
  const menRooms = new Set(students.filter((student) => student.gender === "Man").map((student) => result.assignments[student.id]));

  expect(result.runs.map((run) => run.gender).sort()).toEqual(["Man", "Woman"]);
  expect(womenRooms.size).toBe(1);
  expect(menRooms.size).toBe(1);
  expect([...womenRooms][0]).not.toBe([...menRooms][0]);
});
