import io
import pandas as pd
import numpy as np
import pulp

def run(preferences_csv, rooms_csv, key_csv):
    # Read CSVs from strings
    preferences_file = io.StringIO(preferences_csv)
    rooms_file = io.StringIO(rooms_csv)
    key_file = io.StringIO(key_csv)
    # --- Inserted from assign_roommates.py ---
    def read_rooms(rooms_file):
        df = pd.read_csv(rooms_file, index_col=0)
        if 'Capacity' not in df.columns:
            raise ValueError("Rooms file must contain a 'Capacity' column.")
        return df['Capacity'].to_numpy()
    def read_key(key_file):
        key = pd.read_csv(key_file)
        if 'Category' not in key.columns or 'Weighting' not in key.columns:
            raise ValueError("Key file must contain 'Category' and 'Weighting' columns.")
        category_rows = key[key['Weighting'].notnull()]
        weights = category_rows['Weighting'].astype(float).to_numpy()
        mappings = {}
        for _, row in category_rows.iterrows():
            category = row['Category']
            mapping = {}
            for scale in ['1', '2', '3', '4']:
                if scale in row and pd.notnull(row[scale]) and str(row[scale]).strip() != '':
                    mapping[str(row[scale]).strip()] = int(scale)
            mappings[category] = mapping
        return mappings, weights
    def read_preferences(preferences_file, key_file):
        df = pd.read_csv(preferences_file)
        mappings, weights = read_key(key_file)
        for category in mappings:
            if category in df.columns:
                df[category] = df[category].apply(
                    lambda x: mappings[category][str(x).strip()] if not pd.api.types.is_number(x) and str(x).strip() in mappings[category] else x
                )
        if 'Name' not in df.columns or 'Gender' not in df.columns:
            raise ValueError("Preferences file must contain 'Name' and 'Gender' columns.")
        if df['Name'].isnull().any() or df['Gender'].isnull().any():
            raise ValueError("NaN values in 'Name' or 'Gender' columns.")
        preference_cols = [col for col in mappings if col in df.columns]
        for col in preference_cols:
            possible_scales = sorted(mappings[col].values())
            if possible_scales:
                middle_idx = (len(possible_scales) - 1) // 2
                fill_value = possible_scales[middle_idx]
                df[col] = df[col].fillna(fill_value)
        return df[preference_cols].astype(object).to_numpy(), df['Name'].to_numpy(), df['Gender'].to_numpy(), weights
    def calculate_compatibility_array(preferences, weights):
        num_residents = preferences.shape[0]
        diffs = np.abs(preferences[:, None, :] - preferences[None, :, :])
        compatibilities = np.tensordot(diffs, weights, axes=([2],[0]))
        np.fill_diagonal(compatibilities, 1000)
        return compatibilities
    def add_constraints(problem, x, genders, num_residents, num_rooms, room_capacities):
        for resident_a in range(num_residents):
            sum_expr = sum([
                sum([
                    x[(resident_a, resident_b, room_idx)]
                    for room_idx in range(num_rooms)])
                for resident_b in range(num_residents)])
            problem += (sum_expr == 1)
        for room_idx in range(num_rooms):
            sum_expr = sum([
                sum([
                    x[(resident_a, resident_b, room_idx)]
                    for resident_a in range(num_residents)])
                for resident_b in range(num_residents)])
            problem += (sum_expr <= room_capacities[room_idx])
        for room_idx in range(num_rooms):
            for resident_a in range(num_residents):
                for resident_b in range(resident_a + 1, num_residents):
                    problem += (x[(resident_a, resident_b, room_idx)] == x[(resident_b, resident_a, room_idx)])
        for room_idx in range(num_rooms):
            for resident_a in range(num_residents):
                for resident_b in range(resident_a + 1, num_residents):
                    if str(genders[resident_a]) != str(genders[resident_b]):
                        problem += (x[(resident_a, resident_b, room_idx)] == 0)
                        problem += (x[(resident_b, resident_a, room_idx)] == 0)
        for resident_a in range(num_residents):
            for room_idx in range(num_rooms):
                problem += (x[(resident_a, resident_a, room_idx)] == 0)
    def solve(preferences, rooms, genders, num_residents, num_rooms, weights, time_limit=180):
        problem = pulp.LpProblem('lpsolver', pulp.LpMinimize)
        x = pulp.LpVariable.dicts(
            'x',
            ((resident_a, resident_b, room_idx)
             for resident_a in range(num_residents)
             for resident_b in range(num_residents)
             for room_idx in range(num_rooms)),
            lowBound=0, upBound=1, cat='Integer')
        compatibility_array = calculate_compatibility_array(preferences, weights)
        problem += (
            sum([
                sum([
                    compatibility_array[resident_a][resident_b] * x[(resident_a, resident_b, room_idx)]
                    for resident_a in range(num_residents)
                    for resident_b in range(resident_a + 1, num_residents)
                ])
                for room_idx in range(num_rooms)
            ])
        )
        add_constraints(problem, x, genders, num_residents, num_rooms, rooms)
        problem.solve(pulp.PULP_CBC_CMD(timeLimit=time_limit))
        x_values = np.zeros((num_residents, num_residents, num_rooms))
        for resident_a in range(num_residents):
            for resident_b in range(num_residents):
                for room_idx in range(num_rooms):
                    x_values[resident_a, resident_b, room_idx] = x[(resident_a, resident_b, room_idx)].value()
        return x_values
    def write_output(assignments, names, num_residents, num_rooms):
        import pandas as pd
        resident_a, resident_b, room_idx = np.where((assignments == 1.0) & (np.arange(num_residents)[:, None, None] < np.arange(num_residents)[None, :, None]))
        matchings = [(names[a], names[b], r) for a, b, r in zip(resident_a, resident_b, room_idx)]
        df = pd.DataFrame(matchings, columns=["Roommate A", "Roommate B", "Room"])
        return df.to_csv(index=False)
    # --- End inserted code ---
    preferences, names, genders, weights = read_preferences(preferences_file, key_file)
    room_capacities = read_rooms(rooms_file)
    num_residents = preferences.shape[0]
    num_rooms = room_capacities.shape[0]
    assignments = solve(preferences, room_capacities, genders, num_residents, num_rooms, weights, 180)
    output_csv = write_output(assignments, names, num_residents, num_rooms)
    return output_csv