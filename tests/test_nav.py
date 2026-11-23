import math
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from boran import nav
from boran.geo import Projector

LAT0, LON0 = 51.13, 71.43


class FakeCity:
    def __init__(self, pts, ways):
        self.proj = Projector(LAT0, LON0)
        self.nodes = [self.ll(x, y) for x, y in pts]
        self.edges = []
        self.adj = [[] for _ in pts]
        self.data = {"names": []}
        for u, v, hw, ow in ways:
            p = [self.nodes[u], self.nodes[v]]
            (x0, y0), (x1, y1) = pts[u], pts[v]
            ed = {"u": u, "v": v, "hw": hw, "len": ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5, "p": p}
            if ow:
                ed["ow"] = ow
            self.adj[u].append((v, len(self.edges)))
            self.adj[v].append((u, len(self.edges)))
            self.edges.append(ed)

    def ll(self, x, y):
        return [LON0 + x / self.proj.kx, LAT0 + y / self.proj.ky]


def divided():
    pts = [(-10, -200), (-10, 0), (-10, 200), (10, -200), (10, 0), (10, 200), (-120, 0), (120, 0)]
    ways = [(2, 1, "secondary", 1), (1, 0, "secondary", 1),
            (3, 4, "secondary", 1), (4, 5, "secondary", 1),
            (6, 1, "residential", 0), (1, 4, "residential", 0), (4, 7, "residential", 0)]
    return FakeCity(pts, ways)


def test_traffic_direction_flag():
    assert nav._traffic(1, True) == 1
    assert nav._traffic(1, False) == -1
    assert nav._traffic(-1, True) == -1
    assert nav._traffic(-1, False) == 1
    assert nav._traffic(0, True) == 0


def test_against_traffic_walks_on_the_outer_side():
    city = divided()
    side = nav.sides(city, [0, 1, 2], [1, 0])[0]
    assert side == [-1, -1]
    side = nav.sides(city, [3, 4, 5], [2, 3])[0]
    assert side == [1, 1]


def test_two_way_road_gets_a_side_and_oneway_keeps_its_outer_side():
    city = divided()
    side = nav.sides(city, [6, 1, 0], [4, 1])[0]
    assert side[0] in (1, -1) and side[1] == 1


def rays_plus(half=3.5):
    return [{"e": i, "b": b, "d": d, "half": half, "hw": "tertiary", "ow": False}
            for i, (b, d) in enumerate([(0.0, (0.0, 1.0)), (90.0, (1.0, 0.0)), (180.0, (0.0, -1.0)), (270.0, (-1.0, 0.0))])]


def test_right_turn_from_the_right_sidewalk_needs_no_crossing():
    cost, crossed, pts = nav.junction(rays_plus(), nav.arrive(180.0, 1), nav.leave(90.0, 1))
    assert cost == 0 and not crossed


def test_left_turn_crosses_once_and_uses_kerb_corners():
    cost, crossed, pts = nav.junction(rays_plus(), nav.arrive(180.0, 1), nav.leave(270.0, -1))
    assert [r["b"] for r in crossed] == [180.0]
    (x0, y0), (x1, y1) = pts
    assert x0 == pytest.approx(5.5) and y0 == pytest.approx(-5.5)
    assert x1 == pytest.approx(-5.5) and y1 == pytest.approx(-5.5)


def test_leg_reports_side_and_junction_waypoints():
    city = divided()
    out = nav.leg(city, {"nodes": [6, 1, 0], "edges": [4, 1]})
    assert [s[4] for s in out["segs"]] == [out["segs"][0][4], 1]
    for v in out["via"]:
        assert len(v["pts"]) >= 2


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_walk_path_keeps_to_the_outer_sidewalk(tmp_path):
    city = divided()
    plan = nav.leg(city, {"nodes": [0, 1, 2], "edges": [1, 0]})
    line = [city.nodes[0], city.nodes[1], city.nodes[2]]
    src = Path(__file__).resolve().parent.parent / "boran" / "frontend" / "nav.js"
    script = tmp_path / "walk.js"
    script.write_text(
        "global.window = {};\n"
        f"eval(require('fs').readFileSync({json.dumps(str(src))}, 'utf8'));\n"
        "const { Frame, buildWalk } = window.BoranNav._test;\n"
        f"const line = {json.dumps(line)}, plan = {json.dumps(plan)};\n"
        f"const F = new Frame({LON0}, {LAT0});\n"
        "const w = buildWalk(F, line, plan, 0, 0);\n"
        "const xs = [];\n"
        "for (let s = 5; s < w.path.len - 5; s += 5) xs.push(w.path.pos(s)[0]);\n"
        "console.log(JSON.stringify(xs));\n")
    xs = json.loads(subprocess.run(["node", str(script)], capture_output=True, text=True, check=True).stdout)
    assert xs and all(x < -10 - 3.5 - 1.0 for x in xs)


def test_walk_to_a_stop_ends_on_the_stop_kerb():
    city = divided()
    same = nav.leg(city, {"nodes": [2, 1], "edges": [0]}, a_end=300.0)
    other = nav.leg(city, {"nodes": [2, 1], "edges": [0]}, a_end=135.0)
    assert same["segs"][0][4] == 1 and not same["via"]
    assert other["via"] and other["via"][-1]["d"] == other["length"] and len(other["via"][-1]["pts"]) == 3


def test_merge_divided_uses_lateral_gap_and_keeps_both_zebras():
    lat = 51.0
    k = 111320.0 * math.cos(math.radians(lat))
    a = {"d": 100.0, "road": 0.0, "half": 5.25, "lanes": 2, "sig": False, "at": [71.0, lat], "name": "X"}
    b = {"d": 130.0, "road": 180.0, "half": 5.25, "lanes": 2, "sig": True, "at": [71.0 + 18.0 / k, lat + 12.0 / 110540.0], "name": ""}
    out = nav._merge_divided([a, b])
    assert len(out) == 1
    m = out[0]
    assert abs(m["median"] - (9.0 - 5.25)) < 0.15
    assert abs(m["half"] - (m["median"] + 2 * 5.25)) < 0.15
    assert m["parts"] == [a["at"], b["at"]] and m["one"] == 5.25 and m["sig"]
