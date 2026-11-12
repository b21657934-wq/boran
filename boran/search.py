import heapq
import time
from collections import deque

from . import astar
from .geo import haversine

ALGOS = ["bfs", "dfs", "ucs", "greedy", "astar"]


def _path(came, start, goal):
    nodes, edges = [goal], []
    while nodes[-1] != start:
        u, ei = came[nodes[-1]]
        nodes.append(u)
        edges.append(ei)
    nodes.reverse()
    edges.reverse()
    return nodes, edges


def _result(city, came, start, goal, order, risks, wind_k):
    if goal != start and goal not in came:
        return None
    nodes, edges = _path(came, start, goal) if goal != start else ([start], [])
    cost = sum(astar.edge_cost(city.edges[ei], risks[ei], wind_k) for ei in edges)
    return {"nodes": nodes, "edges": edges, "cost": cost, "order": order}


def bfs(city, start, goal, risks, wind_k):
    came = {start: None}
    order = []
    queue = deque([start])
    while queue:
        u = queue.popleft()
        order.append(u)
        if u == goal:
            break
        for v, ei in city.adj[u]:
            if v not in came:
                came[v] = (u, ei)
                queue.append(v)
    return _result(city, came, start, goal, order, risks, wind_k)


def dfs(city, start, goal, risks, wind_k):
    came = {}
    seen = set()
    order = []
    stack = [(start, None)]
    while stack:
        u, via = stack.pop()
        if u in seen:
            continue
        seen.add(u)
        if via is not None:
            came[u] = via
        order.append(u)
        if u == goal:
            break
        for v, ei in reversed(city.adj[u]):
            if v not in seen:
                stack.append((v, (u, ei)))
    return _result(city, came, start, goal, order, risks, wind_k)


def ucs(city, start, goal, risks, wind_k):
    dist = {start: 0.0}
    came = {}
    closed = set()
    order = []
    heap = [(0.0, 0, start)]
    tie = 0
    while heap:
        d, _, u = heapq.heappop(heap)
        if u in closed:
            continue
        closed.add(u)
        order.append(u)
        if u == goal:
            break
        for v, ei in city.adj[u]:
            if v in closed:
                continue
            nd = d + astar.edge_cost(city.edges[ei], risks[ei], wind_k)
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                came[v] = (u, ei)
                tie += 1
                heapq.heappush(heap, (nd, tie, v))
    return _result(city, came, start, goal, order, risks, wind_k)


def greedy(city, start, goal, risks, wind_k):
    glon, glat = city.nodes[goal]
    h = lambda n: haversine(city.nodes[n][0], city.nodes[n][1], glon, glat)
    came = {start: None}
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
            if v not in came:
                came[v] = (u, ei)
                tie += 1
                heapq.heappush(heap, (h(v), tie, v))
    came.pop(start, None)
    return _result(city, came, start, goal, order, risks, wind_k)


def astar_safe(city, start, goal, risks, wind_k):
    return astar.search(city, start, goal, risks, wind_k, safe=True)


RUN = {"bfs": bfs, "dfs": dfs, "ucs": ucs, "greedy": greedy, "astar": astar_safe}


def _thin(line, cap):
    if len(line) <= cap:
        return line
    step = len(line) / cap
    out = [line[int(i * step)] for i in range(cap)]
    out.append(line[-1])
    return out


def compare(city, an, start, goal, wave_cap=700, line_cap=1600):
    out = []
    for name in ALGOS:
        t0 = time.perf_counter()
        res = RUN[name](city, start, goal, an["risks"], an["wind_k"])
        ms = (time.perf_counter() - t0) * 1000.0
        if res is None:
            out.append({"algo": name, "found": False, "ms": round(ms, 1)})
            continue
        d = astar.describe(city, res, an["risks"], an["wind_k"])
        order = res["order"]
        step = max(1, len(order) // wave_cap)
        out.append({
            "algo": name, "found": True, "ms": round(ms, 1),
            "expanded": len(order), "steps": len(res["edges"]),
            "length": d["length"], "minutes": d["minutes"], "fall": d["fall"], "cost": round(res["cost"], 1),
            "line": _thin(d["line"], line_cap),
            "wave": [city.nodes[n] for n in order[::step]],
        })
    best = min((r for r in out if r["found"]), key=lambda r: r["cost"], default=None)
    for r in out:
        r["best_cost"] = bool(best and r["found"] and abs(r["cost"] - best["cost"]) < 1e-6)
    return out
