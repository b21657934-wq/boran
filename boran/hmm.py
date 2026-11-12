import math

STATES = ["dry", "wet", "snow", "packed", "ice"]
OBS = ["frost_dry", "frost_snow", "zero_cross", "thaw_wet", "thaw_dry"]

PRIOR = [0.40, 0.05, 0.20, 0.25, 0.10]

TRANS = [
    [0.82, 0.06, 0.09, 0.01, 0.02],
    [0.18, 0.45, 0.05, 0.02, 0.30],
    [0.03, 0.07, 0.52, 0.30, 0.08],
    [0.04, 0.06, 0.10, 0.68, 0.12],
    [0.04, 0.06, 0.06, 0.04, 0.80],
]

EMIT = [
    [0.45, 0.04, 0.08, 0.03, 0.40],
    [0.01, 0.01, 0.18, 0.55, 0.25],
    [0.15, 0.65, 0.10, 0.08, 0.02],
    [0.50, 0.30, 0.12, 0.04, 0.04],
    [0.42, 0.17, 0.36, 0.02, 0.03],
]


def observe(hours):
    out = []
    prev_t = None
    for h in hours:
        t = h["temp"]
        wet = h.get("precip", 0.0) >= 0.1 or h.get("snow", 0.0) >= 0.1
        crossed = prev_t is not None and ((prev_t > 0.5 and t <= 0.5) or (prev_t < -0.5 and t >= -0.5))
        if -1.0 <= t <= 1.0 or crossed:
            o = 2
        elif t < -1.0:
            o = 1 if wet else 0
        else:
            o = 3 if wet else 4
        out.append(o)
        prev_t = t
    return out


def forward(obs, prior=PRIOR, trans=TRANS, emit=EMIT):
    n = len(prior)
    beliefs = []
    b = prior[:]
    for k, o in enumerate(obs):
        if k > 0:
            b = [sum(b[i] * trans[i][j] for i in range(n)) for j in range(n)]
        b = [b[j] * emit[j][o] for j in range(n)]
        z = sum(b)
        b = [x / z for x in b]
        beliefs.append(b)
    return beliefs


def viterbi(obs, prior=PRIOR, trans=TRANS, emit=EMIT):
    n = len(prior)
    lg = lambda x: math.log(x) if x > 0 else -1e18
    delta = [lg(prior[j]) + lg(emit[j][obs[0]]) for j in range(n)]
    back = []
    for o in obs[1:]:
        nd, ptr = [], []
        for j in range(n):
            best_i = max(range(n), key=lambda i: delta[i] + lg(trans[i][j]))
            nd.append(delta[best_i] + lg(trans[best_i][j]) + lg(emit[j][o]))
            ptr.append(best_i)
        delta = nd
        back.append(ptr)
    last = max(range(n), key=lambda j: delta[j])
    path = [last]
    for ptr in reversed(back):
        path.append(ptr[path[-1]])
    path.reverse()
    return path, max(delta)


def run(hours):
    obs = observe(hours)
    beliefs = forward(obs)
    path, logp = viterbi(obs)
    return {
        "states": STATES,
        "obs_names": OBS,
        "obs": obs,
        "beliefs": [[round(x, 4) for x in b] for b in beliefs],
        "now": [round(x, 4) for x in beliefs[-1]],
        "viterbi": path,
        "logp": round(logp, 3),
        "times": [h["time"] for h in hours],
        "temps": [h["temp"] for h in hours],
    }
