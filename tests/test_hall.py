import json
import math

from boran import demo, graph, hall, reports


def _city():
    return graph.City(graph.build(demo.raw(), demo=True))


def _mark(city, fleet, i, k="ice"):
    nodes = sorted(fleet.drive.adj)
    n = nodes[(i * 7919) % len(nodes)]
    lon, lat = city.nodes[n]
    e = city.nearest_edge(lon, lat)
    return {"id": "m%d" % i, "k": k, "lon": lon, "lat": lat, "e": e, "es": [e], "name": "ул. %d" % i, "near": False}


def _forward(fleet, src):
    return fleet.drive.tree(src)[0]


def test_ice_mark_sends_the_earliest_truck():
    city = _city()
    fleet = hall.Fleet(city)
    m = _mark(city, fleet, 3)
    target = fleet.drive.nearest(m["lon"], m["lat"])
    best = min(_forward(fleet, tr["node"]).get(target, 1e9) for tr in fleet.trucks)
    ev = fleet.handle(m, 0.8, 1000.0)
    assert ev["act"] == "go"
    job = fleet.jobs[-1]
    assert abs((job["t1"] - job["t0"]) - best * hall.SEC_PER_MIN) < 0.05
    assert job["t0"] >= 1000.0 + hall.THINK - 1e-6
    assert job["t2"] > job["t1"]


def test_path_follows_drivable_edges():
    city = _city()
    fleet = hall.Fleet(city)
    fleet.handle(_mark(city, fleet, 5), 0.8, 0.0)
    job = fleet.jobs[-1]
    nodes, edges = job["_nodes"], job["_edges"]
    assert len(nodes) == len(edges) + 1
    for a, b, e in zip(nodes, nodes[1:], edges):
        assert (b, e) in fleet.drive.adj[a]
    ts = [p[2] for p in job["path"]]
    assert ts == sorted(ts)


def test_second_mark_nearby_joins_the_running_job():
    city = _city()
    fleet = hall.Fleet(city)
    m = _mark(city, fleet, 4)
    fleet.handle(m, 0.8, 0.0)
    m2 = dict(m, id="m4b", lon=m["lon"] + 0.0003)
    ev = fleet.handle(m2, 0.85, 1.0)
    assert ev["act"] == "join" and len(fleet.jobs) == 1
    assert fleet.jobs[0]["m"] == ["m4", "m4b"]


def test_doubtful_mark_waits_and_dry_mark_clears():
    city = _city()
    fleet = hall.Fleet(city)
    assert fleet.handle(_mark(city, fleet, 6), hall.GO_P - 0.05, 0.0)["act"] == "wait"
    assert fleet.handle(_mark(city, fleet, 7, "dry"), 0.1, 0.0)["act"] == "clear"
    assert not fleet.jobs


def test_busy_fleet_queues_new_work():
    city = _city()
    fleet = hall.Fleet(city, per_depot=1)
    for i in range(len(fleet.trucks) + 3):
        fleet.handle(_mark(city, fleet, 20 + i * 13), 0.9, 0.0)
    by_truck = {}
    for j in fleet.jobs:
        by_truck.setdefault(j["tr"], []).append(j)
    for jobs in by_truck.values():
        for a, b in zip(jobs, jobs[1:]):
            assert b["t0"] >= a["t2"] - 1e-6
            assert b["_nodes"][0] == a["_nodes"][-1]


def test_store_dispatches_only_fresh_people_marks(tmp_path):
    city = _city()
    pts = [tuple(city.nodes[i]) for i in range(0, len(city.nodes), max(1, len(city.nodes) // 40))]
    store = reports.Store(city, pts, runs=100, now=1000.0)
    store.fleet = hall.Fleet(city)
    risks = [0.6] * len(city.edges)
    store.publish(str(tmp_path), risks, 1000.0)
    assert not store.fleet.jobs
    s, w, n, e = city.data["bbox"]
    lon, lat = next(city.nodes[u] for u in sorted(store.fleet.drive.adj) if s < city.nodes[u][1] < n and w < city.nodes[u][0] < e)
    assert store.add("uABC.1", "ice", lon, lat, t=1001.0)
    store.publish(str(tmp_path), risks, 1001.0)
    data = json.loads((tmp_path / "hall.json").read_text())
    assert len(data["jobs"]) == 1 and data["feed"][0]["id"] == "uABC.1" and data["feed"][0]["act"] == "go"
    feed = json.loads((tmp_path / "feed.json").read_text())
    assert feed["feed"][0]["tr"] == data["jobs"][0]["tr"]
    assert math.isfinite(data["jobs"][0]["t2"])


def test_neighbour_confirms_a_waiting_mark():
    city = _city()
    fleet = hall.Fleet(city)
    m = _mark(city, fleet, 9)
    assert fleet.handle(m, 0.2, 0.0)["act"] == "wait"
    ev = fleet.handle(dict(m, id="m9b", lon=m["lon"] + 0.0004, e=-1), 0.2, 5.0)
    assert ev["act"] == "go" and ev["p"] > ev["p0"] and ev["with"] == 1
    assert fleet.status["m9"]["act"] == "go" and fleet.status["m9"]["tr"] == ev["tr"]
    assert fleet.jobs[-1]["m"] == ["m9", "m9b"]


def test_feed_shows_the_bayes_step(tmp_path):
    city = _city()
    pts = [tuple(city.nodes[i]) for i in range(0, len(city.nodes), max(1, len(city.nodes) // 40))]
    store = reports.Store(city, pts, runs=100, seed=False)
    store.fleet = hall.Fleet(city)
    s, w, n, e = city.data["bbox"]
    lon, lat = next(city.nodes[u] for u in sorted(store.fleet.drive.adj) if s < city.nodes[u][1] < n and w < city.nodes[u][0] < e)
    store.add("uA.1", "ice", lon, lat, t=500.0)
    store.publish(str(tmp_path), [0.2] * len(city.edges), 500.0)
    ev = store.fleet.feed[-1]
    assert ev["pr"] == 0.2 and ev["p"] == round(reports.observe(0.2, "ice"), 2)
