import math
from . import astar, bayes, config, frost, hmm, mdp, nav, search
from .geo import haversine


def analyse(city, weather):
    h = hmm.run(weather["past"])
    prior = bayes.prior_from_hmm(h["now"])
    table = bayes.risk_table(prior)
    risks = [table[ed["mask"] & 31] for ed in city.edges]
    wind_k = min(1.0, weather["now"]["wind"] / 15.0)
    return {"hmm": h, "prior": prior, "risks": risks, "wind_k": wind_k, "table": [table[m] for m in range(32)]}


def _leg(city, a, b, an, safe=True):
    res = astar.search(city, a, b, an["risks"], an["wind_k"], safe=safe)
    if res is None:
        return None, None
    return res, astar.describe(city, res, an["risks"], an["wind_k"])


ROADS = {"trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street"}
ROAD_W = {"trunk": 1.0, "primary": 1.0, "secondary": 1.1, "tertiary": 1.35, "unclassified": 1.8, "residential": 2.2, "living_street": 3.0}


BIG_ROADS = {"trunk", "primary", "secondary", "tertiary"}


def _road_node(city, lon, lat, fallback, r=160.0):
    x, y = city.proj.xy(lon, lat)
    near = sorted(city.ngrid.near(x, y, r), key=lambda t: t[0])
    for kinds in (BIG_ROADS, ROADS):
        for dd, n in near:
            if any(city.edges[ei]["hw"] in kinds for _, ei in city.adj[n]):
                return n
    return fallback


def _with_flow(ed, u):
    ow = ed.get("ow", 0)
    return not ow or (ow == 1 and ed["u"] == u) or (ow == -1 and ed["v"] == u)


def _stop_side(proj, line, stop, at_end):
    pts = [proj.xy(p[0], p[1]) for p in (line[::-1] if at_end else line)]
    if len(pts) < 2:
        return 0.0
    x0, y0 = pts[0]
    acc, far = 0.0, pts[1]
    for i in range(1, len(pts)):
        acc += math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
        far = pts[i]
        if acc > 25:
            break
    dx, dy = far[0] - x0, far[1] - y0
    if at_end:
        dx, dy = -dx, -dy
    sx, sy = proj.xy(stop["lon"], stop["lat"])
    d = math.hypot(dx, dy) or 1.0
    return ((sx - x0) * dy - (sy - y0) * dx) / d


def _fit_ride(proj, line, segs, A, B, reach=40.0):
    pts = [proj.xy(p[0], p[1]) for p in line]
    if len(pts) < 2:
        return None
    cum = [0.0]
    for i in range(1, len(pts)):
        cum.append(cum[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    total = cum[-1]

    def passes(stop, lo, hi):
        sx, sy = proj.xy(stop["lon"], stop["lat"])
        best = None
        for i in range(len(pts) - 1):
            if cum[i + 1] < lo or cum[i] > hi:
                continue
            (x1, y1), (x2, y2) = pts[i], pts[i + 1]
            dx, dy = x2 - x1, y2 - y1
            L = math.hypot(dx, dy)
            if L < 1e-6:
                continue
            t = ((sx - x1) * dx + (sy - y1) * dy) / L
            u = max(0.0, min(1.0, t / L))
            s = cum[i] + u * L
            side = ((sx - x1) * dy - (sy - y1) * dx) / L
            if s < lo or s > hi or abs(t - u * L) > 6.0 or side < -1.5 or side > reach:
                continue
            if best is None or abs(side) < best[0]:
                best = (abs(side), s, i, u)
        return best

    st = passes(A, 0.0, total * 0.6)
    if st is None:
        return None
    en = passes(B, max(st[1] + 50.0, total * 0.4), total)
    if en is None:
        return None
    _, s0, i0, u0 = st
    _, s1, i1, u1 = en

    def at(i, u):
        a, b = line[i], line[i + 1]
        return [round(a[0] + (b[0] - a[0]) * u, 7), round(a[1] + (b[1] - a[1]) * u, 7)]

    new = []
    for q in [at(i0, u0)] + [list(p) for p in line[i0 + 1:i1 + 1]] + [at(i1, u1)]:
        if not new or abs(q[0] - new[-1][0]) + abs(q[1] - new[-1][1]) > 1e-7:
            new.append(q)
    k = 0
    for j, sg in enumerate(segs):
        if sg[0] <= s0 + 1e-6:
            k = j
    out = []
    for j in range(k, len(segs)):
        if segs[j][0] >= s1:
            break
        out.append([round(max(0.0, segs[j][0] - s0), 1)] + list(segs[j][1:]))
    return new, out, s1 - s0


def _stop_edges(city, stop, reach=30.0, k=3):
    sx, sy = city.proj.xy(stop["lon"], stop["lat"])
    seen, out = set(), []
    for _, n in city.ngrid.near(sx, sy, 260.0):
        for _, ei in city.adj[n]:
            if ei in seen:
                continue
            seen.add(ei)
            ed = city.edges[ei]
            if ed["hw"] not in ROADS and ed["hw"] != "service":
                continue
            pts = [city.proj.xy(p[0], p[1]) for p in ed["p"]]
            best = None
            for i in range(len(pts) - 1):
                (x1, y1), (x2, y2) = pts[i], pts[i + 1]
                dx, dy = x2 - x1, y2 - y1
                L = math.hypot(dx, dy)
                if L < 1e-6:
                    continue
                t = ((sx - x1) * dx + (sy - y1) * dy) / L
                side = ((sx - x1) * dy - (sy - y1) * dx) / L
                if -3.0 <= t <= L + 3.0 and (best is None or abs(side) < abs(best[0])):
                    best = (side, i, max(0.0, min(1.0, t / L)))
            if best is None or abs(best[0]) > reach:
                continue
            side, i, u = best
            ow = ed.get("ow", 0)
            pen = abs(side) + (0.0 if ed["hw"] in BIG_ROADS else 6.0) + (15.0 if ed["hw"] == "service" else 0.0)
            for rev in (False, True):
                if ow == (1 if rev else -1):
                    continue
                if abs(side) >= 2.0 and (side > 0) == rev:
                    continue
                out.append((pen, ei, rev, i, u))
    out.sort(key=lambda c: c[0])
    return out[:k]


def _part(city, ei, rev, i, u, head):
    ed = city.edges[ei]
    p = ed["p"]
    a, b = p[i], p[i + 1]
    at = [round(a[0] + (b[0] - a[0]) * u, 7), round(a[1] + (b[1] - a[1]) * u, 7)]
    if head:
        pts = [at] + ([list(q) for q in p[i::-1]] if rev else [list(q) for q in p[i + 1:]])
        node = ed["u"] if rev else ed["v"]
    else:
        pts = ([list(q) for q in p[:i:-1]] if rev else [list(q) for q in p[:i + 1]]) + [at]
        node = ed["v"] if rev else ed["u"]
    xy = [city.proj.xy(q[0], q[1]) for q in pts]
    length = sum(math.hypot(xy[j][0] - xy[j - 1][0], xy[j][1] - xy[j - 1][1]) for j in range(1, len(xy)))
    return pts, node, length, [ed["hw"], nav._name(city, ed), 1 if ed.get("ow") else 0]


def _uturns(proj, line, span=80.0):
    pts = [proj.xy(p[0], p[1]) for p in line]
    hs, acc = [], 0.0
    for i in range(len(pts) - 1):
        L = math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        if L > 3.0:
            hs.append((acc, math.atan2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])))
        acc += L
    n, j = 0, 0
    while j < len(hs):
        hit = None
        for k in range(j + 1, len(hs)):
            if hs[k][0] - hs[j][0] > span:
                break
            if abs((math.degrees(hs[k][1] - hs[j][1]) + 180.0) % 360.0 - 180.0) > 150.0:
                hit = k
                break
        if hit is None:
            j += 1
        else:
            n += 1
            j = hit
    return n


KERB = {"footway", "path", "pedestrian", "cycleway", "steps"}


def _kerb_node(city, line, stop, at_end, fallback, r=60.0):
    pts = [city.proj.xy(p[0], p[1]) for p in (line[::-1] if at_end else line)]
    if len(pts) < 2:
        return fallback
    x0, y0 = pts[0]
    far = next((q for q in pts[1:] if math.hypot(q[0] - x0, q[1] - y0) > 8.0), pts[-1])
    dx, dy = far[0] - x0, far[1] - y0
    if at_end:
        dx, dy = -dx, -dy
    L = math.hypot(dx, dy) or 1.0
    rx, ry = dy / L, -dx / L
    sx, sy = city.proj.xy(stop["lon"], stop["lat"])
    best = None
    for d, n in city.ngrid.near(sx, sy, r):
        if not any(city.edges[ei]["hw"] in KERB for _, ei in city.adj[n]):
            continue
        nx, ny = city.proj.xy(*city.nodes[n])
        if (nx - x0) * rx + (ny - y0) * ry < 3.0:
            continue
        if best is None or d < best[0]:
            best = (d, n)
    return best[1] if best else fallback


def _bus_ride(city, an, A, B):
    best, memo = None, {}
    for ca in _stop_edges(city, A):
        pa, na, la, ia = _part(city, ca[1], ca[2], ca[3], ca[4], True)
        for cb in _stop_edges(city, B):
            if cb[1] == ca[1]:
                continue
            pb, nb, lb, ib = _part(city, cb[1], cb[2], cb[3], cb[4], False)
            if na == nb:
                mid, mlen, msegs, svc = [], 0.0, [], 0.0
            else:
                if (na, nb) not in memo:
                    res = None
                    for allowed in (lambda ed: ed["hw"] in ROADS, lambda ed: ed["hw"] in ROADS or ed["hw"] == "service"):
                        res = astar.search(city, na, nb, an["risks"], an["wind_k"], safe=False, allow=allowed, weight=lambda ed: ROAD_W.get(ed["hw"], 3.0), allow_dir=_with_flow)
                        if res is not None:
                            break
                    if res is None:
                        memo[(na, nb)] = None
                    else:
                        d = astar.describe(city, res, an["risks"], an["wind_k"])
                        memo[(na, nb)] = (d["line"], d["length"], nav.leg(city, res)["segs"],
                                          sum(city.edges[ei]["len"] for ei in res["edges"] if city.edges[ei]["hw"] == "service"))
                if memo[(na, nb)] is None:
                    continue
                mid, mlen, msegs, svc = memo[(na, nb)]
            svc += (la if ia[0] == "service" else 0.0) + (lb if ib[0] == "service" else 0.0)
            total = la + mlen + lb
            line = []
            for q in pa + mid + pb:
                if not line or abs(q[0] - line[-1][0]) + abs(q[1] - line[-1][1]) > 1e-7:
                    line.append(list(q))
            if len(line) < 2 or _stop_side(city.proj, line, A, False) < -1.5 or _stop_side(city.proj, line, B, True) < -1.5:
                continue
            score = total + 4.0 * svc + 900.0 * _uturns(city.proj, line)
            if best is not None and score >= best[0]:
                continue
            segs = [[0.0] + ia] + [[round(la + sg[0], 1)] + list(sg[1:]) for sg in msegs] + [[round(la + mlen, 1)] + ib]
            best = (score, line, total, segs)
    return best


def _bus_path(city, an, a, b):
    for allowed, flow in ((lambda ed: ed["hw"] in ROADS or ed["hw"] == "service", _with_flow), (lambda ed: ed["hw"] in ROADS, None), (None, None)):
        res = astar.search(city, a, b, an["risks"], an["wind_k"], safe=False, allow=allowed, weight=lambda ed: ROAD_W.get(ed["hw"], 3.0), allow_dir=flow)
        if res is not None:
            line = astar.describe(city, res, an["risks"], an["wind_k"])
            return line["line"], line["length"], nav.leg(city, res)["segs"]
    return None, None, []


def _wave(city, res, cap=900):
    order = res["order"]
    step = max(1, len(order) // cap)
    return [city.nodes[n] for n in order[::step]]


def _merge(parts):
    keys = ["length", "minutes", "warm", "exposed", "expanded"]
    out = {k: round(sum(p[k] for p in parts), 1) for k in keys}
    no = 1.0
    for p in parts:
        no *= 1.0 - p["fall"]
    out["fall"] = round(1.0 - no, 4)
    total = sum(p["length"] for p in parts) or 1
    out["avg_risk"] = round(sum(p["avg_risk"] * p["length"] for p in parts) / total, 3)
    return out


def _edge_feats(ed):
    return {f: bool(ed["mask"] & bit) for f, bit in zip(bayes.FEATURES, (1, 2, 4, 8, 16))}


def route(city, an, weather, src, dst):
    a = city.nearest_node(*src)
    b = city.nearest_node(*dst)
    direct = haversine(src[0], src[1], dst[0], dst[1])
    out = {"direct": round(direct), "src": list(src), "dst": list(dst)}
    safe_res, safe = _leg(city, a, b, an, True)
    short_res, short = _leg(city, a, b, an, False)
    if safe is None:
        return None
    wci, lim, band = frost.limit(weather["now"]["temp"], weather["now"]["wind"])
    fz = {"wci": wci, "limit": lim, "band": band, "need": False, "ok": True, "stops": [], "pen": 0.0}
    if lim is not None:
        lim_m = lim * 60.0 * config.WALK_SPEED
        fz["need"] = safe["length"] > lim_m
        if fz["need"]:
            wr = frost.search(city, a, b, an["risks"], an["wind_k"], lim_m)
            wlen = sum(city.edges[ei]["len"] for ei in wr["edges"]) if wr else 0.0
            if wr and wlen <= max(1.3 * safe["length"], safe["length"] + 800.0):
                safe_res = wr
                safe = astar.describe(city, wr, an["risks"], an["wind_k"])
                safe["minutes"] = round(safe["minutes"] + sum(st["min"] for st in wr["warm"]), 1)
                fz["stops"] = [{k: st[k] for k in ("d", "name", "kind", "lon", "lat", "min")} for st in wr["warm"]]
            else:
                fz["ok"] = False
                fz["pen"] = round(4.0 * (frost.minutes(safe["length"]) - lim), 1)
        fz["max_out"] = round(frost.minutes(frost.stretches(city, safe_res if fz["ok"] else {"edges": safe_res["edges"]})), 1)
    transit = None
    if direct > config.TRANSIT_THRESHOLD_M and city.stops:
        cands = []
        on_road = lambda sid: _road_node(city, city.stops[sid]["lon"], city.stops[sid]["lat"], None, 90.0) is not None
        for sa in [i for i in city.stops_near(*src, k=8) if on_road(i)][:4]:
            na = city.nearest_node(city.stops[sa]["lon"], city.stops[sa]["lat"])
            ra, da = _leg(city, a, na, an, True)
            if da is None:
                continue
            for sb in [i for i in city.stops_near(*dst, k=8) if on_road(i)][:4]:
                if sa == sb:
                    continue
                nb = city.nearest_node(city.stops[sb]["lon"], city.stops[sb]["lat"])
                rb, db = _leg(city, nb, b, an, True)
                if db is None:
                    continue
                cands.append((ra["cost"] + rb["cost"], sa, sb, ra, da, rb, db, na, nb))
        cands.sort(key=lambda c: c[0])
        best, fitted = None, None
        for cand in cands[:6]:
            _, sa, sb, ra, da, rb, db, na, nb = cand
            A0, B0 = city.stops[sa], city.stops[sb]
            ride = _bus_ride(city, an, A0, B0)
            if ride:
                score = da["minutes"] + db["minutes"] + ride[0] / config.TRANSIT_SPEED / 60.0
                if fitted is None or score < fitted[0]:
                    fitted = (score, cand + ride[1:])
                continue
            if fitted is not None:
                continue
            line, m, sg = _bus_path(city, an, _road_node(city, A0["lon"], A0["lat"], na), _road_node(city, B0["lon"], B0["lat"], nb))
            if line is None:
                continue
            fit = _fit_ride(city.proj, line, sg, A0, B0)
            if fit:
                line, sg, m = fit
                best = cand + (line, m, sg)
                break
            if best is None:
                best = cand + (line, m, sg)
        if fitted is not None:
            best = fitted[1]
        if best:
            _, sa, sb, ra, da, rb, db, na, nb, ride_line, ride_m, ride_segs = best
            A, B = city.stops[sa], city.stops[sb]
            ka, kb = _kerb_node(city, ride_line, A, False, na), _kerb_node(city, ride_line, B, True, nb)
            if ka != na:
                r2, d2 = _leg(city, a, ka, an, True)
                if d2 is not None:
                    ra, da, na = r2, d2, ka
            if kb != nb:
                r2, d2 = _leg(city, kb, b, an, True)
                if d2 is not None:
                    rb, db, nb = r2, d2, kb

            def named(stop, near):
                if stop.get("name"):
                    return stop
                rn = _road_node(city, stop["lon"], stop["lat"], near)
                street = next((nav._name(city, city.edges[ei]) for _, ei in city.adj[rn] if nav._name(city, city.edges[ei])), "")
                return dict(stop, name=street)

            A, B = named(A, na), named(B, nb)
            if ride_line is None:
                ride_line = [[A["lon"], A["lat"]], [B["lon"], B["lat"]]]
                ride_m = haversine(A["lon"], A["lat"], B["lon"], B["lat"]) * 1.3
            ride_min = ride_m / config.TRANSIT_SPEED / 60.0
            _, sda = _leg(city, a, na, an, False)
            _, sdb = _leg(city, nb, b, an, False)
            walk = _merge([da, db])
            transit = {
                "legs": [da["line"], db["line"]],
                "short_legs": [sda["line"], sdb["line"]],
                "ride": ride_line,
                "stops": [A, B],
                "walk": walk,
                "short_walk": _merge([sda, sdb]),
                "ride_min": round(ride_min, 1),
                "wait_min": config.TRANSIT_WAIT_MIN,
                "total_min": round(walk["minutes"] + ride_min + config.TRANSIT_WAIT_MIN, 1),
                "wave": _wave(city, ra) + _wave(city, rb),
                "nav": {"legs": [nav.leg(city, ra), nav.leg(city, rb)], "ride_stops": nav.ride_stops(city, ride_line, A, B),
                        "ride_segs": [[sg[0], sg[1], sg[3] if len(sg) > 3 else 0] for sg in ride_segs], "ride_len": round(ride_m or 0, 1),
                        "side": [round(_stop_side(city.proj, ride_line, A, False), 1), round(_stop_side(city.proj, ride_line, B, True), 1)]},
                "expanded": da["expanded"] + db["expanded"],
            }
    out["mode"] = "transit" if transit else "walk"
    out["safe"] = safe
    out["short"] = short
    out["transit"] = transit
    out["wave"] = _wave(city, safe_res)
    out["nav"] = nav.leg(city, safe_res)
    out["nav"]["warm"] = fz["stops"]
    out["frost"] = fz
    out["expanded_short"] = short["expanded"]

    path_edges = safe_res["edges"]
    worst = max(path_edges, key=lambda ei: an["risks"][ei]) if path_edges else city.nearest_edge(*src)
    ed = city.edges[worst]
    out["bayes"] = dict(bayes.explain(an["prior"], _edge_feats(ed)), at=ed["p"][len(ed["p"]) // 2])

    now = weather["now"]
    nxt = weather["ahead"][2] if len(weather["ahead"]) > 2 else (weather["ahead"][-1] if weather["ahead"] else now)
    sev = mdp.severity(now)
    trend = mdp.trend_from_forecast(sev, mdp.severity(nxt))
    cf = mdp.cold_factor(now["apparent"])
    if transit:
        ride, access, arisk = transit["ride_min"], transit["walk"]["minutes"], transit["walk"]["fall"]
    else:
        ride, access, arisk = safe["length"] / config.TRANSIT_SPEED / 60.0, 6.0, safe["fall"] * 0.25
    inp = {"walk_min": safe["minutes"], "walk_risk": safe["fall"], "ride_min": ride, "access_min": access,
           "access_risk": arisk, "cold_factor": cf, "transit_ok": 1 if transit else 0, "frost_pen": fz["pen"]}
    out["mdp"] = mdp.solve(inp, mdp.level(sev), trend)
    return out


def compare(city, an, src, dst):
    a = city.nearest_node(*src)
    b = city.nearest_node(*dst)
    return {"src": list(src), "dst": list(dst), "results": search.compare(city, an, a, b)}
