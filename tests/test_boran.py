import itertools
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from boran import astar, bayes, demo, graph, hmm, mdp, pipeline, weather


def toy_city():
    nodes = [[71.400, 51.100], [71.402, 51.100], [71.404, 51.100], [71.401, 51.1012], [71.403, 51.1012]]
    def edge(u, v, length, mask=0, warm=False):
        return {"u": u, "v": v, "len": length, "mask": mask, "warm": warm, "hw": "footway", "p": [nodes[u], nodes[v]]}
    edges = [edge(0, 1, 140), edge(1, 2, 140), edge(0, 3, 150), edge(3, 4, 140), edge(4, 2, 150)]
    return graph.City({"bbox": [51.09, 71.39, 51.11, 71.41], "nodes": nodes, "edges": edges, "buildings": [], "water": {"lines": [], "polys": []}, "stops": [], "warm": []})


def test_forward_is_distribution():
    for b in hmm.forward([0, 1, 2, 3, 4, 0]):
        assert abs(sum(b) - 1.0) < 1e-9


def test_viterbi_matches_brute_force():
    obs = [3, 2, 0, 0]
    best, best_p = None, -1.0
    for path in itertools.product(range(len(hmm.STATES)), repeat=len(obs)):
        p = hmm.PRIOR[path[0]] * hmm.EMIT[path[0]][obs[0]]
        for k in range(1, len(obs)):
            p *= hmm.TRANS[path[k - 1]][path[k]] * hmm.EMIT[path[k]][obs[k]]
        if p > best_p:
            best, best_p = list(path), p
    path, logp = hmm.viterbi(obs)
    assert path == best
    assert abs(logp - math.log(best_p)) < 1e-9


def test_thaw_then_frost_means_ice():
    res = hmm.run(weather.scenario("thaw_freeze")["past"])
    assert hmm.STATES[res["now"].index(max(res["now"]))] == "ice"


def test_bayes_by_hand():
    feats = {"shade": True, "open": False, "uncleaned": True, "stop": False, "bridge": False}
    ps = 0.5 * 0.55 * 0.50 * 0.70 * 0.75 * 0.90
    pn = 0.5 * 0.30 * 0.65 * 0.40 * 0.90 * 0.97
    assert abs(bayes.posterior(0.5, feats) - ps / (ps + pn)) < 1e-12
    assert bayes.posterior(0.5, feats) > 0.5 > bayes.posterior(0.5, {})


def test_astar_shortest_and_safe_differ():
    city = toy_city()
    risks = [0.9, 0.9, 0.05, 0.05, 0.05]
    short = astar.search(city, 0, 2, risks, 0.0, safe=False)
    safe = astar.search(city, 0, 2, risks, 0.0, safe=True)
    assert short["nodes"] == [0, 1, 2] and abs(short["cost"] - 280) < 1e-9
    assert safe["nodes"] == [0, 3, 4, 2]
    assert abs(safe["cost"] - 440 * (1 + 4.0 * 0.05)) < 1e-9


def test_cost_never_below_length():
    for risk in (0.0, 0.5, 1.0):
        for warm in (False, True):
            ed = {"len": 100.0, "mask": 2, "warm": warm}
            assert astar.edge_cost(ed, risk, 1.0) >= 100.0


def test_mdp_prefers_walking_short_trip_in_calm():
    inp = {"walk_min": 8.0, "walk_risk": 0.01, "ride_min": 2.0, "access_min": 6.0, "access_risk": 0.003, "cold_factor": 0.1}
    res = mdp.solve(inp, "calm", "steady")
    assert res["best"] == "go"
    assert abs(res["q"]["go"] - (-(8.0 + 60 * 0.01 + 8.0 * 0.1))) < 0.06


def test_mdp_waits_when_blizzard_eases():
    inp = {"walk_min": 30.0, "walk_risk": 0.027, "ride_min": 6.0, "access_min": 6.0, "access_risk": 0.007, "cold_factor": 0.5}
    assert mdp.solve(inp, "blizzard", "ease")["best"] == "wait"


def test_weather_parse():
    times = [f"2026-11-12T{h:02d}:00" for h in range(24)]
    js = {
        "current": {"time": "2026-11-12T13:15", "temperature_2m": -7.5, "apparent_temperature": -13.0, "precipitation": 0.0, "snowfall": 0.0,
                    "wind_speed_10m": 5.0, "wind_direction_10m": 240, "relative_humidity_2m": 80, "is_day": 1},
        "hourly": {"time": times, "temperature_2m": [-float(h) for h in range(24)], "apparent_temperature": [-5.0] * 24, "precipitation": [0.0] * 24,
                   "snowfall": [None] * 24, "wind_speed_10m": [4.0] * 24, "wind_direction_10m": [200] * 24, "relative_humidity_2m": [80] * 24},
    }
    w = weather.parse(js)
    assert len(w["past"]) == 12 and len(w["ahead"]) == 6
    assert w["past"][-1]["time"] == "13:00" and w["past"][-1]["temp"] == -7.5
    assert w["ahead"][0]["time"] == "14:00" and w["night"] is False


def test_full_pipeline_on_demo_city():
    city = graph.City(graph.build(demo.raw(), demo=True))
    wx = weather.scenario("blizzard")
    an = pipeline.analyse(city, wx)
    assert len(an["risks"]) == len(city.edges) and all(0 <= r <= 1 for r in an["risks"])
    far = pipeline.route(city, an, wx, (71.417377, 51.089187), (71.490789, 51.121652))
    assert far["mode"] == "transit" and far["mdp"]["best"] in mdp.ACTIONS
    near = pipeline.route(city, an, wx, (71.417377, 51.089187), (71.4305, 51.1003))
    assert near["mode"] == "walk" and near["safe"]["length"] >= near["short"]["length"]
    assert near["safe"]["fall"] <= near["short"]["fall"] + 1e-9
