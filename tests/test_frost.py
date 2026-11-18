from boran import frost


def test_wind_chill_matches_canadian_table():
    assert round(frost.wind_chill(-20, 20 / 3.6)) == -30
    assert round(frost.wind_chill(-35, 10 / 3.6)) == -45


def test_limits_follow_risk_bands():
    assert frost.limit(-5, 2)[1] is None
    assert frost.limit(-15, 3)[1] is None and frost.limit(-15, 3)[2] == "cold"
    assert frost.limit(-16, 18)[1] == 10
    assert frost.limit(-35, 2)[1] == 5
    assert frost.limit(-45, 8)[1] == 2


def _city():
    from boran import graph
    nodes = [[71.40 + 0.002 * i, 51.10] for i in range(11)]
    edges = []
    for i in range(10):
        edges.append({"u": i, "v": i + 1, "p": [nodes[i], nodes[i + 1]], "len": 140.0, "mask": 0, "warm": False, "hw": "footway", "name": "", "ow": 0})
    data = {"bbox": [51.09, 71.39, 51.11, 71.43], "nodes": nodes, "edges": edges, "buildings": [], "water": {"lines": [], "polys": []},
            "stops": [], "warm": [{"lon": nodes[4][0], "lat": 51.1002, "name": "Кафе", "kind": "cafe"}]}
    return graph.City(data)


def test_route_stops_to_warm_up_when_walk_is_too_long():
    city = _city()
    risks = [0.2] * len(city.edges)
    res = frost.search(city, 0, 10, risks, 0.0, limit_m=840.0)
    assert res is not None
    assert [s["node"] for s in res["warm"]] == [4]
    assert res["edges"] == list(range(10))


def test_route_is_refused_when_no_warm_place_is_close_enough():
    city = _city()
    risks = [0.2] * len(city.edges)
    assert frost.search(city, 0, 10, risks, 0.0, limit_m=420.0) is None
