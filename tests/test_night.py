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
