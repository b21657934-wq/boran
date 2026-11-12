LEVELS = ["calm", "snow", "blizzard"]
ACTIONS = ["go", "wait", "transit"]
MULT = {"calm": 1.0, "snow": 1.5, "blizzard": 3.0}
SLOW = {"calm": 1.0, "snow": 1.1, "blizzard": 1.3}
BUS_WAIT = {"calm": 7.0, "snow": 10.0, "blizzard": 18.0}
TREND_P = {
    "ease": {"calm": [0.90, 0.10, 0.00], "snow": [0.45, 0.50, 0.05], "blizzard": [0.15, 0.50, 0.35]},
    "steady": {"calm": [0.85, 0.13, 0.02], "snow": [0.15, 0.70, 0.15], "blizzard": [0.05, 0.25, 0.70]},
    "grow": {"calm": [0.60, 0.33, 0.07], "snow": [0.05, 0.55, 0.40], "blizzard": [0.02, 0.13, 0.85]},
}
GAMMA = 0.95
WAIT_MIN = 20.0
MAX_WAITS = 3
FALL_COST = 60.0
TRANSIT_FEE = 8.0


def cold_factor(apparent):
    return max(0.0, min(1.2, (-apparent - 10.0) / 25.0)) * 0.6


def severity(hour):
    return min(1.0, hour.get("wind", 0.0) / 18.0) * 0.6 + min(1.0, hour.get("snow", 0.0) / 2.0) * 0.4


def level(sev):
    return "calm" if sev < 0.25 else "snow" if sev < 0.6 else "blizzard"


def trend_from_forecast(now_sev, next_sev):
    d = next_sev - now_sev
    return "grow" if d > 0.12 else "ease" if d < -0.12 else "steady"


def terminal(action, s, inp):
    m, cf = MULT[s], inp["cold_factor"]
    if action == "go":
        return -(inp["walk_min"] * SLOW[s] + (FALL_COST * inp["walk_risk"] + inp["walk_min"] * cf) * m)
    out = inp["access_min"] + BUS_WAIT[s]
    return -(inp["ride_min"] + BUS_WAIT[s] + inp["access_min"] * SLOW[s] + (FALL_COST * inp["access_risk"] + out * cf) * m + TRANSIT_FEE)


def solve(inp, level_now, trend):
    P = TREND_P[trend]
    V = {(s, k): 0.0 for s in LEVELS for k in range(MAX_WAITS + 1)}
    Q = {}
    sweeps = 0
    while True:
        sweeps += 1
        diff = 0.0
        for k in range(MAX_WAITS, -1, -1):
            for s in LEVELS:
                q = {"go": terminal("go", s, inp), "transit": terminal("transit", s, inp)}
                if k < MAX_WAITS:
                    q["wait"] = -WAIT_MIN + GAMMA * sum(p * V[(s2, k + 1)] for p, s2 in zip(P[s], LEVELS))
                Q[(s, k)] = q
                v = max(q.values())
                diff = max(diff, abs(v - V[(s, k)]))
                V[(s, k)] = v
        if diff < 1e-9 or sweeps > 50:
            break
    q0 = Q[(level_now, 0)]
    return {
        "level": level_now,
        "trend": trend,
        "q": {a: round(q0[a], 1) for a in q0},
        "best": max(q0, key=q0.get),
        "table": {s: {a: round(Q[(s, 0)][a], 1) for a in Q[(s, 0)]} for s in LEVELS},
        "policy": {s: max(Q[(s, 0)], key=Q[(s, 0)].get) for s in LEVELS},
        "trans": P[level_now],
        "sweeps": sweeps,
        "inputs": {k: round(v, 3) for k, v in inp.items()},
        "gamma": GAMMA,
    }
