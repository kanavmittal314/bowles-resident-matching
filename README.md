# Bowles Resident Matching

Browser-only resident matching workspace for assigning singles and doubles with a mixed manual and ILP-assisted workflow.

Deploy as a React app. The current hosted version is:
https://kanavmittal314.github.io/bowles-resident-matching/

## Workflow

1. Upload a preferences CSV or TSV by clicking the file control or dragging a file onto the upload zone.
2. Enter how many single rooms and double rooms are available.
3. Preview the file and map each column to a role: ignore this column, name, gender, preference, or extra information.
4. Encode discovered preference values numerically and set a weight for each preference type.
5. Drag students into rooms manually, or run the optimizer for students still unassigned.
6. Set a max GLPK solve time if you want the browser solver to stop early and use the best feasible assignment found so far.
7. Cancel a running GLPK optimization if needed; current assignments are left unchanged.
8. Download a final CSV with each student and their assigned room.

All computation runs locally in the browser. No files are uploaded to a server.

## Input Files

### Preferences CSV/TSV

The app lets you map columns after upload, so exact header names are flexible. The file must contain:

- Student name
- Gender. This is treated as a categorical value, so it can be text like `Woman`/`Man`, letters like `F`/`M`, or already-encoded values like `1`/`2`.
- One or more preference columns to encode and weight
- Optional extra information columns. These are visible on expanded student cards but are not used by the optimizer.

Columns marked as `Ignore this column` are ignored.

Example:

```csv
Name,Gender,Sleep,Cleanliness,Guests
Avery,F,Early,Very tidy,Often
Blair,F,Late,Relaxed,Rarely
Casey,M,Early,Tidy,Sometimes
```

## Matching Model

The active solver is implemented with `glpk.js` in `src/roommateSolver.js`.

- The UI currently generates room slots from entered single-room and double-room counts instead of accepting a room file.
- Manual assignments are locked when the optimizer runs.
- The optimizer assigns only students who are still unassigned.
- A max solve time can stop GLPK early. If GLPK has found a feasible incumbent by then, the app uses it even if optimality is not proven.
- A running browser GLPK solve can be canceled from the progress panel.
- Gender is a hard same-gender constraint for optimized assignments. The solver compares the mapped gender values as categories and does not require numeric gender encoding.
- For the current single/double-room workflow, the ILP chooses same-gender pairs, solo placements, and fills for manually locked partial double rooms. Room labels are assigned after GLPK selects the pair/solo structure.
- The objective minimizes total weighted pairwise incompatibility among paired students and students added to manually locked partial doubles.
- Optimization can run as one combined ILP or as one sequential ILP per gender. The gender-split mode is usually faster; it now selects a tight room subset for each gender before solving so it does not waste beds needed by later gender groups.

Compatibility between two students is:

```text
sum(weight[column] * abs(encodedA[column] - encodedB[column]))
```

Lower scores mean closer compatibility. Rooms with manual over-capacity or gender conflicts are flagged in the UI and must be fixed before optimization.

See `TODO.md` for the planned return of variable-capacity room support.

## Available Scripts

### `npm start`

Runs the app in development mode at http://localhost:3000.

### `npm test -- --watchAll=false`

Runs the test suite once.

### `npm run build`

Builds the production app into the `build` folder.

### `npm run deploy`

Builds and deploys the app to GitHub Pages using `gh-pages`.
