import json
import os
import random
import statistics
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from boran import astar, bayes, config, graph, hmm, mdp, pipeline, search, weather  # noqa: E402
from boran.geo import haversine  # noqa: E402

OUT = os.path.join(ROOT, "docs", "results")
SCENARIOS = ["thaw_freeze", "blizzard", "clear_frost", "snow_after_thaw", "freezing_rain"]
STREETS = {
    "shaded courtyard, not cleaned": {"shade": True, "open": False, "uncleaned": True, "stop": False, "bridge": False},
    "bus stop on open avenue": {"shade": False, "open": True, "uncleaned": False, "stop": True, "bridge": False},
    "bridge over the Ishim": {"shade": False, "open": True, "uncleaned": False, "stop": False, "bridge": True},
    "cleaned main avenue": {"shade": False, "open": True, "uncleaned": False, "stop": False, "bridge": False},
}


def hmm_bayes():
    rows = []
    for name in SCENARIOS:
        wx = weather.scenario(name)
        h = hmm.run(wx["past"])
        now = h["now"]
        prior = bayes.prior_from_hmm(now)
        rows.append({
            "scenario": name,
            "observations": [hmm.OBS[o] for o in h["obs"]],
            "viterbi_last6": [hmm.STATES[i] for i in h["viterbi"][-6:]],
            "now": dict(zip(hmm.STATES, now)),
            "most_likely": hmm.STATES[max(range(5), key=lambda i: now[i])],
            "prior_slip": round(prior, 3),
            "streets": {k: round(bayes.posterior(prior, f), 3) for k, f in STREETS.items()},
        })
    return rows


def pick_pairs(city, n, seed=7):
    pts = [(p["lon"], p["lat"]) for p in config.PLACES] + [(s["lon"], s["lat"]) for s in city.stops]
    rnd = random.Random(seed)
    pairs = []
    tries = 0
    while len(pairs) < n and tries < 20000:
        tries += 1
        a, b = rnd.sample(pts, 2)
        d = haversine(a[0], a[1], b[0], b[1])
        if 1000 <= d <= 4500:
            pairs.append((a, b, d))
    return pairs


def search_eval(city, n_pairs):
    wx = weather.scenario("thaw_freeze")
    an = pipeline.analyse(city, wx)
    per = {a: [] for a in search.ALGOS}
    safety = []
    for a, b, d in pick_pairs(city, n_pairs):
        s, g = city.nearest_node(*a), city.nearest_node(*b)
        for name in search.ALGOS:
            t0 = time.perf_counter()
            res = search.RUN[name](city, s, g, an["risks"], an["wind_k"])
            ms = (time.perf_counter() - t0) * 1000.0
            if res is None:
                continue
            desc = astar.describe(city, res, an["risks"], an["wind_k"])
            per[name].append({"expanded": len(res["order"]), "length": desc["length"], "fall": desc["fall"], "cost": res["cost"], "ms": ms})
        short = astar.search(city, s, g, an["risks"], an["wind_k"], safe=False)
        safe = astar.search(city, s, g, an["risks"], an["wind_k"], safe=True)
        if short and safe:
            ds = astar.describe(city, short, an["risks"], an["wind_k"])
            dz = astar.describe(city, safe, an["risks"], an["wind_k"])
            safety.append({"crow_m": round(d), "short_m": ds["length"], "safe_m": dz["length"], "short_fall": ds["fall"], "safe_fall": dz["fall"],
                           "short_risk": ds["avg_risk"], "safe_risk": dz["avg_risk"]})
    opt = {}
    for i in range(len(per["ucs"])):
        opt[i] = per["ucs"][i]["cost"]
    summary = {}
    for name, rows in per.items():
        if not rows:
            continue
        gaps = [(r["cost"] / opt[i] - 1.0) * 100.0 for i, r in enumerate(rows) if i in opt and opt[i] > 0]
        summary[name] = {
            "runs": len(rows),
            "expanded_median": int(statistics.median(r["expanded"] for r in rows)),
            "length_median_m": int(statistics.median(r["length"] for r in rows)),
            "cost_gap_vs_optimal_pct_mean": round(statistics.mean(gaps), 1),
            "optimal_runs": sum(1 for gp in gaps if gp < 1e-6),
            "fall_pct_mean": round(100 * statistics.mean(r["fall"] for r in rows), 3),
            "ms_median": round(statistics.median(r["ms"] for r in rows), 1),
        }
    ucs_e = [r["expanded"] for r in per["ucs"]]
    ast_e = [r["expanded"] for r in per["astar"]]
    saved = statistics.mean(1 - a / u for a, u in zip(ast_e, ucs_e) if u)
    det = [s["safe_m"] / s["short_m"] - 1 for s in safety if s["short_m"]]
    red = [1 - s["safe_fall"] / s["short_fall"] for s in safety if s["short_fall"] > 0]
    return {
        "pairs": n_pairs,
        "scenario": "thaw_freeze",
        "algorithms": summary,
        "astar_vs_ucs_fewer_expansions_pct": round(100 * saved, 1),
        "safe_vs_short": {
            "pairs": len(safety),
            "detour_pct_median": round(100 * statistics.median(det), 1),
            "fall_risk_reduction_pct_median": round(100 * statistics.median(red), 1),
            "fall_short_pct_mean": round(100 * statistics.mean(s["short_fall"] for s in safety), 3),
            "fall_safe_pct_mean": round(100 * statistics.mean(s["safe_fall"] for s in safety), 3),
            "rows": safety[:10],
        },
    }


def mdp_eval():
    rows = []
    for walk in (8.0, 20.0, 35.0):
        for lvl in mdp.LEVELS:
            for trend in ("ease", "steady", "grow"):
                inp = {"walk_min": walk, "walk_risk": 0.0009 * walk * {"calm": 1.0, "snow": 1.6, "blizzard": 2.6}[lvl], "ride_min": walk / 3.5, "access_min": 5.0, "access_risk": 0.004,
                       "cold_factor": mdp.cold_factor(-18.0 if lvl != "calm" else -8.0)}
                r = mdp.solve(inp, lvl, trend)
                nb = mdp.solve(dict(inp, transit_ok=0), lvl, trend)
                rows.append({"walk_min": walk, "level": lvl, "trend": trend, "best": r["best"], "q": r["q"], "best_no_bus": nb["best"], "q_no_bus": nb["q"], "sweeps": r["sweeps"]})
    return rows


def parking_eval():
    js = os.path.join(ROOT, "tools", "parking_eval.mjs")
    try:
        out = subprocess.run(["node", js], capture_output=True, text=True, timeout=60, check=True).stdout
        return json.loads(out)
    except (OSError, subprocess.SubprocessError, ValueError) as err:
        return {"error": str(err)}


def write_md(res):
    L = ["# BORAN — evaluation results", "", "Generated by `python tools/evaluate.py`. All numbers come from the code in this repository.", ""]
    L += ["## 1. HMM + Naive Bayes by weather scenario", "",
          "| Scenario | Most likely surface now | P(ice) | Prior P(slippery) | Shaded courtyard | Bus stop | Bridge | Cleaned avenue |",
          "|---|---|---|---|---|---|---|---|"]
    for r in res["hmm_bayes"]:
        s = r["streets"]
        L.append(f"| {r['scenario']} | {r['most_likely']} | {r['now']['ice']:.2f} | {r['prior_slip']:.2f} | {s['shaded courtyard, not cleaned']:.2f} | {s['bus stop on open avenue']:.2f} | {s['bridge over the Ishim']:.2f} | {s['cleaned main avenue']:.2f} |")
    se = res["search"]
    L += ["", f"## 2. Search on the real Astana street graph ({se['pairs']} random origin–destination pairs, 1–4.5 km, scenario {se['scenario']})", "",
          "| Algorithm | Median nodes expanded | Median path length, m | Optimal cost (runs) | Mean cost gap vs optimum | Mean fall risk | Median time, ms |",
          "|---|---|---|---|---|---|---|"]
    for name in search.ALGOS:
        a = se["algorithms"].get(name)
        if a:
            label = "A\\*" if name == "astar" else name.upper()
            L.append(f"| {label} | {a['expanded_median']} | {a['length_median_m']} | {a['optimal_runs']}/{a['runs']} | {a['cost_gap_vs_optimal_pct_mean']}% | {a['fall_pct_mean']}% | {a['ms_median']} |")
    sv = se["safe_vs_short"]
    L += ["", f"A\\* expands on average **{se['astar_vs_ucs_fewer_expansions_pct']}% fewer nodes** than UCS and returns the same optimal cost.", "",
          f"Safe route vs shortest route ({sv['pairs']} pairs): median detour **+{sv['detour_pct_median']}%**, median reduction of the probability to slip **−{sv['fall_risk_reduction_pct_median']}%** "
          f"(mean {sv['fall_short_pct_mean']}% → {sv['fall_safe_pct_mean']}%).", ""]
    L += ["## 3. MDP decisions (value iteration, γ = 0.95)", "", "| Walk, min | Weather now | Trend | Q(go) | Q(wait 20 min) | Q(transit) | Best | Best if no bus nearby |", "|---|---|---|---|---|---|---|---|"]
    for r in res["mdp"]:
        q = r["q"]
        L.append(f"| {r['walk_min']:.0f} | {r['level']} | {r['trend']} | {q.get('go')} | {q.get('wait')} | {q.get('transit')} | **{r['best']}** | **{r['best_no_bus']}** |")
    pk = res["parking"]
    if "runs" in pk:
        L += ["", "## 4. Parking game: search for the only free bay (A-20)", "", "| Start | Algorithm | Nodes expanded | Bays checked | Path, m |", "|---|---|---|---|---|"]
        for run in pk["runs"]:
            for a in run["algos"]:
                L.append(f"| {run['start']} | {a['algo']} | {a['expanded']} | {a['scanned']} | {a['cost']} |")
    L += ["", f"## 5. Unit tests", "", f"`pytest -q`: {res['tests']['python']}  ", f"`node --test tests/js/parking_ai.test.mjs`: {res['tests']['js']}", ""]
    return "\n".join(L)


def run_tests():
    py = subprocess.run([sys.executable, "-m", "pytest", "-q"], cwd=ROOT, capture_output=True, text=True)
    js = subprocess.run(["node", "--test", "tests/js/parking_ai.test.mjs"], cwd=ROOT, capture_output=True, text=True)
    pyl = [l for l in py.stdout.strip().splitlines() if l.strip()]
    jsl = [l for l in js.stdout.splitlines() if l.startswith("# pass") or l.startswith("# fail")]
    return {"python": pyl[-1] if pyl else "?", "js": ", ".join(x.replace("# ", "") for x in jsl) or "?"}


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 25
    os.makedirs(OUT, exist_ok=True)
    city = graph.get_city()
    res = {"hmm_bayes": hmm_bayes(), "search": search_eval(city, n), "mdp": mdp_eval(), "parking": parking_eval(), "tests": run_tests()}
    with open(os.path.join(OUT, "results.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUT, "RESULTS.md"), "w", encoding="utf-8") as f:
        f.write(write_md(res))
    print(write_md(res))


if __name__ == "__main__":
    main()
