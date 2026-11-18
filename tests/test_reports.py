import math

from boran import reports


def test_ice_mark_raises_and_dry_mark_lowers_belief():
    now = 1_000_000.0
    p0 = 0.3
    up = reports.belief(p0, [(now, "ice")], now)
    down = reports.belief(p0, [(now, "dry")], now)
    assert up > 0.7
    assert down < 0.1


def test_more_marks_mean_more_certainty():
    now = 1_000_000.0
    one = reports.belief(0.3, [(now, "ice")], now)
    three = reports.belief(0.3, [(now - 120, "ice"), (now - 60, "ice"), (now, "ice")], now)
    assert three > one


def test_belief_fades_back_to_prior():
    now = 1_000_000.0
    fresh = reports.belief(0.2, [(now, "ice")], now)
    old = reports.belief(0.2, [(now - 6 * 3600, "ice")], now)
    assert fresh > old > 0.2
    assert abs(reports.belief(0.2, [(now - 40 * 3600, "ice")], now) - 0.2) < 0.01


def test_sanded_after_ice_wins():
    now = 1_000_000.0
    p = reports.belief(0.5, [(now - 1800, "ice"), (now - 1800, "ice"), (now, "dry")], now)
    q = reports.belief(0.5, [(now - 1800, "ice"), (now - 1800, "ice")], now)
    assert p < q


def test_likelihoods_sum_to_one():
    for state in (0, 1):
        assert math.isclose(sum(v[state] for v in reports.LIK.values()), 1.0)


def _store(tmp_seed=False):
    from boran import demo, graph
    city = graph.City(graph.build(demo.raw(), demo=True))
    pts = [tuple(city.nodes[i]) for i in range(0, len(city.nodes), max(1, len(city.nodes) // 40))]
    return city, reports.Store(city, pts, runs=120, seed=tmp_seed)


def test_store_dedups_and_overlays_risk():
    city, st = _store()
    ed = city.edges[len(city.edges) // 2]
    lon, lat = ed["p"][len(ed["p"]) // 2]
    now = 2_000_000.0
    assert st.add("a1", "ice", lon, lat, t=now)
    assert not st.add("a1", "ice", lon, lat, t=now)
    e = st.items[0]["e"]
    base = [0.2] * len(city.edges)
    out = st.overlay(base, now)
    assert out[e] > 0.6 and base[e] == 0.2


def test_store_export_and_publish(tmp_path):
    city, st = _store(tmp_seed=True)
    import time, json
    now = time.time()
    base = [0.45] * len(city.edges)
    data = st.export(base, now)
    assert data["reports"] and data["segs"] and data["top"]
    assert all(set(("name", "p", "flow", "lon", "lat")) <= set(t) for t in data["top"])
    assert st.publish(str(tmp_path), base, now)
    assert not st.publish(str(tmp_path), base, now)
    assert json.load(open(tmp_path / "reports.json"))["v"] == st.version


def test_city_sanding_covers_whole_row():
    city, st = _store()
    import time
    now = time.time()
    e1, e2 = len(city.edges) // 2, len(city.edges) // 3
    for i, e in enumerate((e1, e2)):
        lon, lat = city.edges[e]["p"][0]
        st.add("i%d" % i, "ice", lon, lat, t=now - 60)
    lon, lat = city.edges[e1]["p"][0]
    st.add("c1", "dry", lon, lat, by_city=True, t=now, edges=[e1, e2])
    out = st.overlay([0.3] * len(city.edges), now)
    assert out[e2] < 0.3 and out[e1] < 0.3
