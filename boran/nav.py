import math

from .geo import Grid

CARS = {"primary": 2, "secondary": 2, "tertiary": 1, "trunk": 3}
HALF = {"trunk": 11.0, "primary": 7.5, "secondary": 7.0, "tertiary": 4.0, "unclassified": 3.5, "residential": 3.5,
        "living_street": 3.0, "service": 2.5}
RANK = {"trunk": 4, "primary": 3, "secondary": 2, "tertiary": 1}


def _xy(city, p):
    return city.proj.xy(p[0], p[1])


def _unit(dx, dy):
    d = math.hypot(dx, dy)
    return (dx / d, dy / d) if d > 1e-9 else (0.0, 0.0)


def _bearing(dx, dy):
    return (math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0


def _away(city, node, ei, reach=12.0):
    ed = city.edges[ei]
    pts = ed["p"] if ed["u"] == node else ed["p"][::-1]
    x0, y0 = _xy(city, pts[0])
    far = pts[-1]
    acc = 0.0
    px, py = x0, y0
    for p in pts[1:]:
        x, y = _xy(city, p)
        acc += math.hypot(x - px, y - py)
        px, py = x, y
        far = p
        if acc >= reach:
            break
    x1, y1 = _xy(city, far)
    return _unit(x1 - x0, y1 - y0)


class Signals:
    def __init__(self, city):
        self.nodes = set(city.data.get("sig", []))
        self.grid = Grid(60.0)
        for lon, lat in city.data.get("sig_pts", []):
            self.grid.add(*city.proj.xy(lon, lat), 1)
        self.zebra = set(city.data.get("zeb", []))
        self.known = bool(city.data.get("sig_pts"))

    def near(self, x, y, r=35.0):
        return any(True for _ in self.grid.near(x, y, r))


def signals(city):
    sg = getattr(city, "_signals", None)
    if sg is None:
        sg = city._signals = Signals(city)
    return sg


def _name(city, ed):
    names = city.data.get("names") or []
    n = ed.get("n", -1)
    return names[n] if 0 <= n < len(names) else ""


def _crossing(city, v, e_in, e_out, sg):
    roads = [ei for _, ei in city.adj[v] if ei not in (e_in, e_out) and city.edges[ei]["hw"] in CARS]
    if len(roads) < 2:
        return None
    best = None
    for i in range(len(roads)):
        for j in range(i + 1, len(roads)):
            a, b = roads[i], roads[j]
            da, db = _away(city, v, a), _away(city, v, b)
            if da[0] * db[0] + da[1] * db[1] > -0.5:
                continue
            rank = max(RANK[city.edges[a]["hw"]], RANK[city.edges[b]["hw"]])
            if best is None or rank > best[0]:
                best = (rank, a, b, da, db)
    if best is None:
        return None
    _, a, b, da, db = best
    road = _unit(db[0] - da[0], db[1] - da[1])
    vin, vout = _away(city, v, e_in), _away(city, v, e_out)
    side_in = road[0] * vin[1] - road[1] * vin[0]
    side_out = road[0] * vout[1] - road[1] * vout[0]
    if side_in * side_out >= 0 or min(abs(side_in), abs(side_out)) < 0.35:
        return None
    hw = city.edges[a]["hw"] if RANK[city.edges[a]["hw"]] >= RANK[city.edges[b]["hw"]] else city.edges[b]["hw"]
    x, y = _xy(city, city.nodes[v])
    signal = (v in sg.nodes or sg.near(x, y)) if sg.known else hw in ("trunk", "primary", "secondary")
    return {"at": city.nodes[v], "road": round(_bearing(*road), 1), "hw": hw, "lanes": CARS[hw], "half": HALF[hw],
            "sig": bool(signal), "zebra": v in sg.zebra, "name": _name(city, city.edges[a]) or _name(city, city.edges[b])}


def _turn(delta):
    a = abs(delta)
    if a < 35:
        return None
    side = "right" if delta > 0 else "left"
    if a > 150:
        return "uturn"
    return ("slight_" + side) if a < 60 else side


def leg(city, res):
    if res is None or not res.get("edges"):
        return {"segs": [], "cross": [], "turns": [], "length": 0}
    sg = signals(city)
    nodes = res["nodes"]
    edges = res["edges"]
    segs, cross, turns = [], [], []
    dist = 0.0
    cur = nodes[0]
    for k, ei in enumerate(edges):
        ed = city.edges[ei]
        nxt = ed["v"] if ed["u"] == cur else ed["u"]
        segs.append([round(dist, 1), ed["hw"], _name(city, ed)])
        dist += ed["len"]
        if k < len(edges) - 1:
            e2 = edges[k + 1]
            c = _crossing(city, nxt, ei, e2, sg)
            if c:
                c["d"] = round(dist, 1)
                cross.append(c)
            din = _away(city, nxt, ei, 15.0)
            dout = _away(city, nxt, e2, 15.0)
            hin = _bearing(-din[0], -din[1])
            hout = _bearing(*dout)
            delta = (hout - hin + 540.0) % 360.0 - 180.0
            kind = _turn(delta)
            if kind and city.edges[e2]["len"] >= 8:
                onto = _name(city, city.edges[e2])
                if turns and dist - turns[-1]["d"] < 18:
                    turns[-1] = {"d": round(dist, 1), "turn": kind, "onto": onto, "at": city.nodes[nxt]}
                else:
                    turns.append({"d": round(dist, 1), "turn": kind, "onto": onto, "at": city.nodes[nxt]})
        cur = nxt
    return {"segs": segs, "cross": _merge_divided(cross), "turns": turns, "length": round(dist, 1)}


def _merge_divided(cross):
    out = []
    for c in cross:
        c.setdefault("median", 0.0)
        if out:
            p = out[-1]
            gap = c["d"] - p["d"]
            diff = abs((c["road"] - p["road"] + 540.0) % 360.0 - 180.0)
            if gap < 40 and (diff < 25 or diff > 155) and p["median"] == 0.0:
                lanes = max(p["lanes"], c["lanes"])
                median = max(1.0, gap / 2.0 - 3.5 * lanes / 2.0)
                out[-1] = dict(p, d=round((p["d"] + c["d"]) / 2.0, 1), median=round(median, 1), lanes=lanes,
                               half=round(median + 3.5 * lanes + 0.6, 1), sig=p["sig"] or c["sig"],
                               at=[round((p["at"][0] + c["at"][0]) / 2, 6), round((p["at"][1] + c["at"][1]) / 2, 6)],
                               name=p["name"] or c["name"])
                continue
        out.append(c)
    return out


def ride_stops(city, line, src_stop, dst_stop, r=30.0):
    if not line or len(line) < 2:
        return []
    pts = [_xy(city, p) for p in line]
    cum = [0.0]
    for i in range(1, len(pts)):
        cum.append(cum[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    out, seen = [], set()
    for i in range(1, len(pts)):
        (x0, y0), (x1, y1) = pts[i - 1], pts[i]
        L = cum[i] - cum[i - 1]
        if L < 1e-6:
            continue
        for sid in set(j for _, j in city.sgrid.near((x0 + x1) / 2, (y0 + y1) / 2, L / 2 + r)):
            if sid in seen:
                continue
            st = city.stops[sid]
            sx, sy = _xy(city, (st["lon"], st["lat"]))
            t = max(0.0, min(1.0, ((sx - x0) * (x1 - x0) + (sy - y0) * (y1 - y0)) / (L * L)))
            px, py = x0 + t * (x1 - x0), y0 + t * (y1 - y0)
            if math.hypot(sx - px, sy - py) <= r:
                seen.add(sid)
                d = cum[i - 1] + t * L
                if 60 < d < cum[-1] - 60 and st.get("name"):
                    out.append({"d": round(d), "name": st["name"]})
    out.sort(key=lambda s: s["d"])
    merged = []
    for s in out:
        if merged and (s["d"] - merged[-1]["d"] < 120 or s["name"] == merged[-1]["name"]):
            continue
        merged.append(s)
    return merged
