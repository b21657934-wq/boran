from . import astar, bayes, config, hmm, mdp, nav, search
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


ROADS = {"primary", "secondary", "tertiary", "unclassified", "residential", "living_street"}
ROAD_W = {"primary": 1.0, "secondary": 1.1, "tertiary": 1.35, "unclassified": 1.8, "residential": 2.2, "living_street": 3.0}


def _bus_path(city, an, a, b):
    for allowed in (lambda ed: ed["hw"] in ROADS, None):
        res = astar.search(city, a, b, an["risks"], an["wind_k"], safe=False, allow=allowed, weight=lambda ed: ROAD_W.get(ed["hw"], 3.0))
        if res is not None:
            line = astar.describe(city, res, an["risks"], an["wind_k"])
            return line["line"], line["length"]
    return None, None


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
    transit = None
    if direct > config.TRANSIT_THRESHOLD_M and city.stops:
        best = None
        for sa in city.stops_near(*src, k=4):
            na = city.nearest_node(city.stops[sa]["lon"], city.stops[sa]["lat"])
            ra, da = _leg(city, a, na, an, True)
            if da is None:
                continue
            for sb in city.stops_near(*dst, k=4):
                if sa == sb:
                    continue
                nb = city.nearest_node(city.stops[sb]["lon"], city.stops[sb]["lat"])
                rb, db = _leg(city, nb, b, an, True)
                if db is None:
                    continue
                score = ra["cost"] + rb["cost"]
                if best is None or score < best[0]:
                    best = (score, sa, sb, ra, da, rb, db, na, nb)
        if best:
            _, sa, sb, ra, da, rb, db, na, nb = best
            A, B = city.stops[sa], city.stops[sb]
            ride_line, ride_m = _bus_path(city, an, na, nb)
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
                "nav": {"legs": [nav.leg(city, ra), nav.leg(city, rb)], "ride_stops": nav.ride_stops(city, ride_line, A, B)},
                "expanded": da["expanded"] + db["expanded"],
            }
    out["mode"] = "transit" if transit else "walk"
    out["safe"] = safe
    out["short"] = short
    out["transit"] = transit
    out["wave"] = _wave(city, safe_res)
    out["nav"] = nav.leg(city, safe_res)
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
           "access_risk": arisk, "cold_factor": cf, "transit_ok": 1 if transit else 0}
    out["mdp"] = mdp.solve(inp, mdp.level(sev), trend)
    return out


def compare(city, an, src, dst):
    a = city.nearest_node(*src)
    b = city.nearest_node(*dst)
    return {"src": list(src), "dst": list(dst), "results": search.compare(city, an, a, b)}
