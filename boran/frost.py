import heapq
import math

from . import astar, config
from .geo import haversine

BANDS = ((-10.0, None, "low"), (-28.0, None, "cold"), (-40.0, 10, "high"), (-48.0, 5, "very_high"), (-1e9, 2, "severe"))
STOP_MIN = 3.0
WARM_RADIUS = 70.0


def wind_chill(t, wind_ms):
    v = max(wind_ms * 3.6, 4.8)
    if t > 10.0:
        return t
    k = v ** 0.16
    return 13.12 + 0.6215 * t - 11.37 * k + 0.3965 * t * k


def limit(t, wind_ms):
    w = wind_chill(t, wind_ms)
    for edge, minutes, band in BANDS:
        if w > edge:
            return round(w, 1), minutes, band
    return round(w, 1), 2, "severe"


def warm_nodes(city):
    cached = getattr(city, "_warm_nodes", None)
    if cached is not None:
        return cached
    best = {}
    for i, w in enumerate(city.data.get("warm") or []):
        x, y = city.proj.xy(w["lon"], w["lat"])
        for d2, n in city.ngrid.near(x, y, WARM_RADIUS):
            if n not in best or d2 < best[n][0]:
                best[n] = (d2, i)
    city._warm_nodes = {n: i for n, (_, i) in best.items()}
    return city._warm_nodes


def search(city, start, goal, risks, wind_k, limit_m, stop_min=STOP_MIN):
    warm = warm_nodes(city)
    nodes = city.nodes
    glon, glat = nodes[goal]
    h = lambda n: haversine(nodes[n][0], nodes[n][1], glon, glat)
    stop_cost = stop_min * 60.0 * config.WALK_SPEED
    labels = {}
    parent = []
    dead = set()
    heap = []
    order, seen = [], set()

    def add(n, g, b, par, via):
        lst = labels.setdefault(n, [])
        for g2, b2, _ in lst:
            if g2 <= g + 1e-9 and b2 <= b + 1e-9:
                return
        keep = []
        for g2, b2, lid2 in lst:
            if g <= g2 + 1e-9 and b <= b2 + 1e-9:
                dead.add(lid2)
            else:
                keep.append((g2, b2, lid2))
        lid = len(parent)
        parent.append((n, g, b, par, via))
        keep.append((g, b, lid))
        labels[n] = keep
        heapq.heappush(heap, (g + h(n), lid))

    add(start, 0.0, 0.0, None, None)
    found = None
    while heap:
        _, lid = heapq.heappop(heap)
        if lid in dead:
            continue
        n, g, b, _, _ = parent[lid]
        if n not in seen:
            seen.add(n)
            order.append(n)
        if n == goal:
            found = lid
            break
        if b > 0 and n in warm:
            add(n, g + stop_cost, 0.0, lid, "warm")
        for v, ei in city.adj[n]:
            ed = city.edges[ei]
            nb = b + ed["len"]
            if nb > limit_m:
                continue
            add(v, g + astar.edge_cost(ed, risks[ei], wind_k), nb, lid, ei)
    if found is None:
        return None
    chain = []
    lid = found
    while lid is not None:
        chain.append(parent[lid])
        lid = parent[lid][3]
    chain.reverse()
    path_nodes, path_edges, stops = [chain[0][0]], [], []
    walked = 0.0
    for n, g, b, par, via in chain[1:]:
        if via == "warm":
            w = city.data["warm"][warm[n]]
            stops.append({"node": n, "d": round(walked, 1), "name": w.get("name") or "", "kind": w.get("kind", "cafe"),
                          "lon": w["lon"], "lat": w["lat"], "min": stop_min})
        else:
            path_edges.append(via)
            path_nodes.append(n)
            walked += city.edges[via]["len"]
    return {"nodes": path_nodes, "edges": path_edges, "cost": chain[-1][1], "order": order, "warm": stops}


def stretches(city, res):
    cuts = [0.0] + [s["d"] for s in res.get("warm", [])]
    total = sum(city.edges[ei]["len"] for ei in res["edges"])
    cuts.append(total)
    return max((b - a for a, b in zip(cuts, cuts[1:])), default=0.0)


def minutes(m):
    return m / config.WALK_SPEED / 60.0
