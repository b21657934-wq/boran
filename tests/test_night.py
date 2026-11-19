from boran import demo, graph, night, reports


def _night():
    city = graph.City(graph.build(demo.raw(), demo=True))
    pts = [tuple(city.nodes[i]) for i in range(0, len(city.nodes), max(1, len(city.nodes) // 60))]
    flow = reports.foot_traffic(city, pts, 200)
    return city, night.Night(city, flow, trucks=2)


def test_ice_builds_up_overnight():
    times, temps, tables, beliefs = night.night_tables()
    assert times[0] == "20:00" and len(tables) == night.HOURS
    assert beliefs[night.MORNING][4] > beliefs[1][4] + 0.3


def test_strokes_follow_one_street():
    city, n = _night()
    assert n.strokes
    for s in n.strokes:
        assert len(s["nodes"]) == len(s["edges"]) + 1
        assert len({city.edges[e]["hw"] for e in s["edges"]}) == 1


def test_ai_plan_prevents_more_falls_than_nearest_main_road():
    city, n = _night()
    now, ai = n.run("now"), n.run("ai")
    assert ai["base"] == now["base"] > 0
    assert ai["final"] <= now["final"] + 1e-6
    assert ai["final"] < ai["base"]
    assert all(t[2] <= night.END_MIN + 1 for p in ai["trucks"] for t in p)


def test_morning_crowd_falls_less_with_ai():
    city, n = _night()
    now, ai = n.run("now"), n.run("ai")
    m = n.crowd({"now": now["sanded_set"], "ai": ai["sanded_set"]}, agents=400, n_paths=60)
    assert len(m["agents"]) == 400 and m["paths"]
    assert m["falls"]["ai"] <= m["falls"]["none"] and m["falls"]["now"] <= m["falls"]["none"]
    for row in m["agents"]:
        assert 0 <= row[0] < len(m["paths"]) and all(f == -1 or 0 <= f <= 1000 for f in row[3:])
