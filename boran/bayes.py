FEATURES = ["shade", "open", "uncleaned", "stop", "bridge"]

LIKELIHOOD = {
    "shade": (0.55, 0.30),
    "open": (0.50, 0.35),
    "uncleaned": (0.70, 0.40),
    "stop": (0.25, 0.10),
    "bridge": (0.10, 0.03),
}

PACKED_WEIGHT = 0.4
SNOW_WEIGHT = 0.15
WET_WEIGHT = 0.1


def prior_from_hmm(now):
    p = now[4] + PACKED_WEIGHT * now[3] + SNOW_WEIGHT * now[2] + WET_WEIGHT * now[1]
    return min(0.97, max(0.01, p))


def posterior(prior, feats):
    ps, pn = prior, 1.0 - prior
    for f in FEATURES:
        a, b = LIKELIHOOD[f]
        if feats.get(f):
            ps *= a
            pn *= b
        else:
            ps *= 1.0 - a
            pn *= 1.0 - b
    return ps / (ps + pn)


def explain(prior, feats):
    steps = []
    ps, pn = prior, 1.0 - prior
    for f in FEATURES:
        a, b = LIKELIHOOD[f]
        present = bool(feats.get(f))
        la, lb = (a, b) if present else (1.0 - a, 1.0 - b)
        ps *= la
        pn *= lb
        steps.append({"feature": f, "present": present, "p_slip": la, "p_ok": lb, "after": round(ps / (ps + pn), 4)})
    return {"prior": round(prior, 4), "steps": steps, "posterior": round(ps / (ps + pn), 4)}


def risk_table(prior):
    table = {}
    for mask in range(1 << len(FEATURES)):
        feats = {f: bool(mask >> i & 1) for i, f in enumerate(FEATURES)}
        table[mask] = posterior(prior, feats)
    return table
