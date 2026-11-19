import heapq
import math
import random

from . import astar, bayes, hmm, nav, weather

ROADS = {"trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street"}
RANK = {"trunk": 0, "primary": 1, "secondary": 2, "tertiary": 3}
START_H = 20
HOURS = 13
DEPLOY_MIN = 4 * 60
END_MIN = 11 * 60
MORNING = 11
DRIVE = 500.0
SAND = 330.0
P_SAND = 0.10
STROKE_MAX = 700.0
NEAR = 22.0
TARGET_INJURIES = 300.0
CROWD = 5000
CROWD_PATHS = 1400
HOME_HW = {"residential", "living_street", "service", "footway", "pedestrian", "path"}
DEPOTS = [(71.420, 51.100), (71.405, 51.082), (71.430, 51.168), (71.500, 51.158), (71.455, 51.192), (71.495, 51.118)]


def clock(m):
    h = (START_H + int(m) // 60) % 24
    return "%02d:%02d" % (h, int(m) % 60)


def night_tables(scenario="thaw_freeze"):
    w = weather.scenario(scenario)
    hours = (w["past"] + w["ahead"])[:HOURS]
    beliefs = hmm.forward(hmm.observe(hours))
    tables = []
    for b in beliefs:
        t = bayes.risk_table(bayes.prior_from_hmm(b))
        tables.append([t[m] for m in range(32)])
    return [h["time"] for h in hours], [h["temp"] for h in hours], tables, beliefs


def _seg_dist(px, py, pts):
    best = 1e18
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        u = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / L2)) if L2 > 0 else 0.0
        best = min(best, math.hypot(px - x1 - u * dx, py - y1 - u * dy))
    return best


def _passable(ed, u):
    ow = ed.get("ow", 0)
    if ow == 1:
        return ed["u"] == u
    if ow == -1:
        return ed["v"] == u
    return True


def strokes(city):
    road = [i for i, ed in enumerate(city.edges) if ed["hw"] in ROADS]
    by_node = {}
    for i in road:
        ed = city.edges[i]
        by_node.setdefault(ed["u"], []).append(i)
        by_node.setdefault(ed["v"], []).append(i)
    name = {i: nav._name(city, city.edges[i]) for i in road}
    xy = {}

    def head(i, at):
        ed = city.edges[i]
        p = ed["p"] if ed["u"] == at else ed["p"][::-1]
        a = city.proj.xy(*p[0])
        b = city.proj.xy(*p[min(len(p) - 1, 1)])
        return math.atan2(b[0] - a[0], b[1] - a[1])

    used = set()
    out = []
    for i in sorted(road, key=lambda k: (RANK.get(city.edges[k]["hw"], 9), -city.edges[k]["len"])):
        if i in used:
            continue
        used.add(i)
        ed = city.edges[i]
        chain = [(i, ed["u"], ed["v"])]
        length = ed["len"]
        for forward in (True, False):
            while length < STROKE_MAX:
                e0, a0, b0 = chain[-1] if forward else chain[0]
                at = b0 if forward else a0
                came = head(e0, at) + math.pi
                best = None
                for j in by_node.get(at, ()):
                    if j in used or name[j] != name[i] or city.edges[j]["hw"] != ed["hw"]:
                        continue
                    turn = abs((head(j, at) - came + math.pi) % (2 * math.pi) - math.pi)
                    if turn < math.radians(40) and (best is None or turn < best[0]):
                        best = (turn, j)
                if best is None:
                    break
                j = best[1]
                used.add(j)
                ej = city.edges[j]
                other = ej["v"] if ej["u"] == at else ej["u"]
                length += ej["len"]
                if forward:
                    chain.append((j, at, other))
                else:
                    chain.insert(0, (j, other, at))
        fwd = all(_passable(city.edges[e], a) for e, a, b in chain)
        back = all(_passable(city.edges[e], b) for e, a, b in chain)
        if not (fwd or back):
            continue
        out.append({"edges": [e for e, _, _ in chain], "nodes": [chain[0][1]] + [b for _, _, b in chain],
                    "len": length, "hw": ed["hw"], "name": name[i], "fwd": fwd, "back": back})
    for k, s in enumerate(out):
        s["id"] = k
    return out


def affected(city, stroke):
    hit = set(stroke["edges"])
    for e in stroke["edges"]:
        pts = [city.proj.xy(*p) for p in city.edges[e]["p"]]
        mx, my = pts[len(pts) // 2]
        reach = city.edges[e]["len"] / 2.0 + NEAR + 20.0
        for _, f in city.egrid.near(mx, my, reach):
            if f in hit or city.edges[f]["hw"] in ROADS:
                continue
            q = city.edges[f]["p"]
            fx, fy = city.proj.xy(*q[len(q) // 2])
            if _seg_dist(fx, fy, pts) <= NEAR:
                hit.add(f)
    return sorted(hit)


class Drive:
    def __init__(self, city):
        self.city = city
        self.adj = {}
        for i, ed in enumerate(city.edges):
            if ed["hw"] not in ROADS:
                continue
            for a, b in ((ed["u"], ed["v"]), (ed["v"], ed["u"])):
                if _passable(ed, a):
                    self.adj.setdefault(a, []).append((b, i))

    def core(self):
        order, seen = [], set()
        for root in self.adj:
            if root in seen:
                continue
            seen.add(root)
            stack = [(root, iter(self.adj.get(root, ())))]
            while stack:
                u, it = stack[-1]
                nxt = next(it, None)
                if nxt is None:
                    stack.pop()
                    order.append(u)
                    continue
                v = nxt[0]
                if v not in seen:
                    seen.add(v)
                    stack.append((v, iter(self.adj.get(v, ()))))
        radj = {}
        for u, lst in self.adj.items():
            for v, _ in lst:
                radj.setdefault(v, []).append(u)
        comp, best = {}, []
        for root in reversed(order):
            if root in comp:
                continue
            group, stack = [root], [root]
            comp[root] = root
            while stack:
                u = stack.pop()
                for v in radj.get(u, ()):
                    if v not in comp:
                        comp[v] = root
                        group.append(v)
                        stack.append(v)
            if len(group) > len(best):
                best = group
        return set(best)

    def tree(self, src):
        dist = {src: 0.0}
        came = {}
        heap = [(0.0, src)]
        while heap:
            d, u = heapq.heappop(heap)
            if d > dist[u]:
                continue
            for v, ei in self.adj.get(u, ()):
                nd = d + self.city.edges[ei]["len"] / DRIVE
                if nd < dist.get(v, 1e18):
                    dist[v] = nd
                    came[v] = (u, ei)
                    heapq.heappush(heap, (nd, v))
        return dist, came

    def nearest(self, lon, lat):
        x, y = self.city.proj.xy(lon, lat)
        for r in (200.0, 600.0, 2000.0):
            best = None
            for d2, n in self.city.ngrid.near(x, y, r):
                if n in self.adj and (best is None or d2 < best[0]):
                    best = (d2, n)
            if best:
                return best[1]
        return next(iter(self.adj))


def _walk(city, nodes, edges, t0, speed):
    pts, t = [], t0
    for (a, ei) in zip(nodes, edges):
        ed = city.edges[ei]
        p = ed["p"] if ed["u"] == a else ed["p"][::-1]
        step = ed["len"] / max(1, len(p) - 1) / speed
        for k, q in enumerate(p):
            if pts and k == 0:
                continue
            pts.append([q[0], q[1], round(t + (k * step if k else 0.0), 2)])
        t += ed["len"] / speed
    return pts, t


def _thin(pts, keep=12.0):
    if len(pts) < 3:
        return pts
    out = [pts[0]]
    for q in pts[1:-1]:
        a = out[-1]
        if abs(q[0] - a[0]) * 69000 + abs(q[1] - a[1]) * 111000 >= keep:
            out.append(q)
    out.append(pts[-1])
    return [[round(q[0], 5), round(q[1], 5), q[2]] for q in out]


def walk_paths(city, n_paths=CROWD_PATHS, seed=11):
    rnd = random.Random(seed)
    homes = sorted({n for ed in city.edges if ed["hw"] in HOME_HW for n in (ed["u"], ed["v"])})
    dests = [(s["lon"], s["lat"]) for s in city.stops]
    dests += [(w["lon"], w["lat"]) for w in city.data.get("warm") or [] if w.get("kind") in ("mall", "shop")]
    dnodes = [city.nearest_node(lon, lat) for lon, lat in dests]
    dxy = [city.proj.xy(*city.nodes[n]) for n in dnodes]
    zero = [0.0] * len(city.edges)
    paths, tries = [], 0
    while len(paths) < n_paths and tries < n_paths * 30 and homes and dnodes:
        tries += 1
        a = rnd.choice(homes)
        ax, ay = city.proj.xy(*city.nodes[a])
        k = rnd.randrange(len(dnodes))
        d = math.hypot(dxy[k][0] - ax, dxy[k][1] - ay)
        if not 250.0 < d < 1600.0:
            continue
        res = astar.search(city, a, dnodes[k], zero, 0.0, safe=False)
        if res is None or not res["edges"]:
            continue
        pts, cum, cur = [list(city.nodes[a])], [0.0], a
        for ei in res["edges"]:
            ed = city.edges[ei]
            p = ed["p"] if ed["u"] == cur else ed["p"][::-1]
            pts.extend(list(q) for q in p[1:])
            cum.append(cum[-1] + ed["len"])
            cur = ed["v"] if ed["u"] == cur else ed["u"]
        paths.append({"edges": res["edges"], "cum": cum, "pts": pts})
    return paths


def path_flow(city, paths):
    used = [0] * len(city.edges)
    for P in paths:
        for e in P["edges"]:
            used[e] += 1
    return used


class Night:
    def __init__(self, city, flow=None, scenario="thaw_freeze", trucks=6, n_paths=CROWD_PATHS):
        self.city = city
        self.paths = None
        if flow is None:
            self.paths = walk_paths(city, n_paths)
            flow = path_flow(city, self.paths)
        self.times, self.temps, self.tables, self.beliefs = night_tables(scenario)
        self.p_morning = [self.tables[MORNING][ed["mask"] & 31] for ed in city.edges]
        self.flow = flow
        self.drive = Drive(city)
        main = self.drive.core()
        self.drive.adj = {u: [(v, e) for v, e in lst if v in main] for u, lst in self.drive.adj.items() if u in main}
        self.strokes = [s for s in strokes(city) if all(n in main for n in s["nodes"])]
        self.by_edge = {}
        for k, s in enumerate(self.strokes):
            s["id"] = k
            s["hit"] = affected(city, s)
            for e in s["hit"]:
                self.by_edge.setdefault(e, []).append(k)
        raw = sum(flow[e] * city.edges[e]["len"] / 1000.0 * self.p_morning[e] for e in range(len(city.edges)))
        self.k = TARGET_INJURIES / raw if raw > 0 else 0.0
        self.depots = [self.drive.nearest(lon, lat) for lon, lat in DEPOTS[:trucks]]

    def harm(self, e, sanded):
        p = P_SAND if e in sanded else self.p_morning[e]
        return self.flow[e] * self.city.edges[e]["len"] / 1000.0 * p * self.k

    def total(self, sanded):
        return sum(self.harm(e, sanded) for e in range(len(self.city.edges)) if self.flow[e])

    def gain(self, s, sanded):
        return sum(self.harm(e, ()) - self.harm(e, {e}) for e in s["hit"] if e not in sanded and self.flow[e])

    def run(self, policy):
        city = self.city
        sanded = set()
        done_strokes = set()
        claimed = set()
        base = self.total(sanded)
        level = base
        curve = [[0, round(base, 1)]]
        paths = [[] for _ in self.depots]
        sand_lines = []
        firsts = []
        queue = [(DEPLOY_MIN, k, n) for k, n in enumerate(self.depots)]
        heapq.heapify(queue)
        for k, n in enumerate(self.depots):
            lon, lat = city.nodes[n]
            paths[k].append([round(lon, 5), round(lat, 5), DEPLOY_MIN])
        gains = {s["id"]: self.gain(s, sanded) for s in self.strokes}
        while queue:
            t, k, at = heapq.heappop(queue)
            if t >= END_MIN:
                continue
            dist, came = self.drive.tree(at)
            best = None
            for s in self.strokes:
                if s["id"] in done_strokes or s["id"] in claimed:
                    continue
                ends = ([(s["nodes"][0], False)] if s["fwd"] else []) + ([(s["nodes"][-1], True)] if s["back"] else [])
                ends = [(dist[n], n, rev) for n, rev in ends if n in dist]
                if not ends:
                    continue
                go, entry, rev = min(ends)
                work = s["len"] / SAND
                if t + go + work > END_MIN:
                    continue
                if policy == "ai":
                    g = gains[s["id"]]
                    if g <= 1e-6:
                        continue
                    key = -g / (go + work + 1.0)
                else:
                    if s["hw"] not in RANK or s["len"] < 150.0:
                        continue
                    key = go + 4.0 * RANK[s["hw"]]
                if best is None or key < best[0]:
                    best = (key, s, entry, rev, go, work)
            if best is None:
                continue
            _, s, entry, rev, go, work = best
            claimed.add(s["id"])
            nodes, edges, cur = [], [], entry
            while cur != at:
                u, ei = came[cur]
                nodes.append(u)
                edges.append(ei)
                cur = u
            nodes.reverse()
            edges.reverse()
            pts, t1 = _walk(city, nodes, edges, t, DRIVE)
            snodes = s["nodes"][::-1] if rev else s["nodes"]
            sedges = s["edges"][::-1] if rev else s["edges"]
            spts, t2 = _walk(city, snodes[:-1], sedges, t1, SAND)
            paths[k].extend(_thin(pts)[1:] if paths[k] else _thin(pts))
            paths[k].extend(_thin(spts))
            claimed.discard(s["id"])
            done_strokes.add(s["id"])
            gained = gains[s["id"]]
            sanded.update(s["hit"])
            touched = {o for e in s["hit"] for o in self.by_edge.get(e, ()) if o not in done_strokes}
            for o in touched:
                gains[o] = self.gain(self.strokes[o], sanded)
            level -= gained
            curve.append([round(t2, 1), round(level, 1)])
            sand_lines.append({"t": round(t2, 1), "t0": round(t1, 1), "line": [[round(q[0], 5), round(q[1], 5)] for q in _thin(spts, 8.0)], "name": s["name"], "hw": s["hw"]})
            if len(firsts) < 8:
                firsts.append({"name": s["name"], "hw": s["hw"], "t": clock(t2), "saved": round(gained, 1), "len": round(s["len"])})
            heapq.heappush(queue, (t2, k, snodes[-1]))
        final = self.total(sanded)
        return {"trucks": paths, "sand": sand_lines, "curve": curve, "base": round(base, 1), "final": round(final, 1),
                "km": round(sum(self.strokes[i]["len"] for i in done_strokes) / 1000.0, 1), "n": len(done_strokes), "firsts": firsts,
                "sanded_set": sanded}

    def crowd(self, sets, agents=CROWD, n_paths=CROWD_PATHS, seed=11):
        city = self.city
        rnd = random.Random(seed + 1)
        paths = self.paths or walk_paths(city, n_paths, seed)
        weight = lambda e, s: (P_SAND if e in sets.get(s, ()) else self.p_morning[e]) * city.edges[e]["len"]
        picks = [rnd.randrange(len(paths)) for _ in range(agents)]
        raw = sum(weight(e, "none") for k in picks for e in paths[k]["edges"])
        c = TARGET_INJURIES / raw if raw > 0 else 0.0
        rows, falls = [], {"none": 0, "now": 0, "ai": 0}
        for k in picks:
            P = paths[k]
            dep = rnd.uniform(0.0, 60.0)
            speed = min(1.7, max(0.9, rnd.gauss(1.3, 0.15)))
            us = [(rnd.random(), rnd.random()) for _ in P["edges"]]
            row = [k, int(round(dep * 10)), int(round(speed * 100))]
            for s in ("now", "ai", "none"):
                f = -1
                for i, e in enumerate(P["edges"]):
                    if us[i][0] < min(0.6, c * weight(e, s)):
                        f = int(round((P["cum"][i] + us[i][1] * city.edges[e]["len"]) / P["cum"][-1] * 1000))
                        falls[s] += 1
                        break
                row.append(f)
            rows.append(row)
        enc = []
        for P in paths:
            out, px, py = [], 0, 0
            kept = [P["pts"][0]]
            for q in P["pts"][1:-1]:
                if abs(q[0] - kept[-1][0]) * 69000 + abs(q[1] - kept[-1][1]) * 111000 >= 6.0:
                    kept.append(q)
            kept.append(P["pts"][-1])
            for i, (lon, lat) in enumerate(kept):
                x, y = int(round(lon * 1e5)), int(round(lat * 1e5))
                out += [x, y] if i == 0 else [x - px, y - py]
                px, py = x, y
            enc.append(out)
        return {"start": MORNING * 60, "dur": 90, "paths": enc, "agents": rows, "falls": falls}

    def export(self, agents=CROWD):
        now, ai = self.run("now"), self.run("ai")
        crowd = self.crowd({"now": now.pop("sanded_set"), "ai": ai.pop("sanded_set")}, agents=agents)
        return {"times": self.times, "temps": self.temps, "tables": [[int(round(v * 100)) for v in tb] for tb in self.tables],
                "ice": [round(b[4], 3) for b in self.beliefs], "start": START_H, "deploy": DEPLOY_MIN, "end": END_MIN,
                "depots": [list(self.city.nodes[n]) for n in self.depots],
                "now": now, "ai": ai, "morning": crowd}
