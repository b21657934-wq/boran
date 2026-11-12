import heapq

from . import config
from .geo import haversine


def edge_cost(ed, risk, wind_k, alpha=config.ALPHA_RISK, beta=config.BETA_WIND):
    penalty = alpha * risk + (beta * wind_k if ed["mask"] & 2 else 0.0)
    if ed["warm"]:
        penalty *= 1.0 - config.WARM_RELIEF
    return ed["len"] * (1.0 + penalty)


def search(city, start, goal, risks, wind_k, safe=True):
    nodes = city.nodes
    glon, glat = nodes[goal]
    h = lambda n: haversine(nodes[n][0], nodes[n][1], glon, glat)
    g = {start: 0.0}
    came = {}
    closed = set()
    order = []
    heap = [(h(start), 0, start)]
    tie = 0
    while heap:
        _, _, u = heapq.heappop(heap)
        if u in closed:
            continue
        closed.add(u)
        order.append(u)
        if u == goal:
            break
        for v, ei in city.adj[u]:
            if v in closed:
                continue
            ed = city.edges[ei]
            c = edge_cost(ed, risks[ei], wind_k) if safe else ed["len"]
            ng = g[u] + c
            if ng < g.get(v, float("inf")):
                g[v] = ng
                came[v] = (u, ei)
                tie += 1
                heapq.heappush(heap, (ng + h(v), tie, v))
    if goal not in closed:
        return None
    path_nodes, path_edges = [goal], []
    while path_nodes[-1] != start:
        u, ei = came[path_nodes[-1]]
        path_nodes.append(u)
        path_edges.append(ei)
    path_nodes.reverse()
    path_edges.reverse()
    return {"nodes": path_nodes, "edges": path_edges, "cost": g[goal], "order": order}


def describe(city, res, risks, wind_k):
    line = []
    length = 0.0
    seconds = 0.0
    no_slip = 1.0
    warm = 0
    prev_warm = False
    exposed = 0.0
    cur = res["nodes"][0]
    for ei in res["edges"]:
        ed = city.edges[ei]
        pts = ed["p"] if ed["u"] == cur else ed["p"][::-1]
        cur = ed["v"] if ed["u"] == cur else ed["u"]
        line.extend(pts if not line else pts[1:])
        r = risks[ei]
        length += ed["len"]
        seconds += ed["len"] / config.WALK_SPEED * (1.0 + 0.3 * r)
        no_slip *= (1.0 - 0.005 * r) ** (ed["len"] / 100.0)
        if ed["mask"] & 2:
            exposed += ed["len"]
        if ed["warm"] and not prev_warm:
            warm += 1
        prev_warm = ed["warm"]
    if not line:
        line = [city.nodes[cur], city.nodes[cur]]
    avg = sum(risks[ei] * city.edges[ei]["len"] for ei in res["edges"]) / length if length else 0.0
    return {
        "line": line,
        "length": round(length),
        "minutes": round(seconds / 60.0, 1),
        "fall": round(1.0 - no_slip, 4),
        "avg_risk": round(avg, 3),
        "warm": warm,
        "exposed": round(exposed),
        "expanded": len(res["order"]),
        "cost": round(res["cost"], 1),
    }
