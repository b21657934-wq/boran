import hashlib
import json
import os
import shutil

import streamlit as st
import streamlit.components.v1 as components

import importlib
import glob

import boran
from boran import config, graph, pipeline, weather

_BORAN_DIR = os.path.dirname(os.path.abspath(boran.__file__))
_RELOAD_ORDER = ["geo", "config", "hmm", "bayes", "astar", "search", "mdp", "nav", "weather", "demo", "graph", "pipeline"]


def code_signature():
    h = hashlib.md5()
    for path in sorted(glob.glob(os.path.join(_BORAN_DIR, "*.py"))):
        with open(path, "rb") as f:
            h.update(f.read())
    return h.hexdigest()[:10]


CODE = code_signature()
if getattr(boran, "_code_sig", CODE) != CODE:
    for name in _RELOAD_ORDER:
        mod = getattr(boran, name, None) or importlib.import_module("boran." + name)
        importlib.reload(mod)
boran._code_sig = CODE

st.set_page_config(page_title="БОРАН · Астана", page_icon="❄️", layout="wide", initial_sidebar_state="collapsed")

FRONTEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "boran", "frontend")
boran_map = components.declare_component("boran_map", path=FRONTEND)

st.markdown(
    """
<style>
#MainMenu, header, footer, [data-testid="stToolbar"], [data-testid="stDecoration"], [data-testid="stStatusWidget"], [data-testid="stHeader"] {display: none !important;}
html, body, .stApp, [data-testid="stAppViewContainer"], [data-testid="stMain"] {background: #070B18 !important; overflow: hidden !important;}
.block-container, [data-testid="stMainBlockContainer"] {padding: 0 !important; max-width: 100% !important;}
[data-testid="stVerticalBlock"] {gap: 0 !important;}
iframe[title*="boran_map"] {position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; height: 100dvh !important; border: 0 !important; z-index: 10;}
</style>
""",
    unsafe_allow_html=True,
)


def data_signature():
    path = graph.data_path()
    try:
        stt = os.stat(path)
        return f"{int(stt.st_mtime)}-{stt.st_size}-{CODE}"
    except OSError:
        return "demo-" + CODE


@st.cache_resource(show_spinner=False, max_entries=2)
def load_city(signature):
    city = graph.get_city()
    meta, tiles = city.frontend()
    blob = json.dumps(meta, ensure_ascii=False, separators=(",", ":"))
    version = hashlib.md5((blob + signature).encode("utf-8")).hexdigest()[:10]
    try:
        root = os.path.join(FRONTEND, "tiles")
        tile_dir = os.path.join(root, version)
        os.makedirs(tile_dir, exist_ok=True)
        for old in os.listdir(root):
            if old != version:
                shutil.rmtree(os.path.join(root, old), ignore_errors=True)
        for key, edges in tiles.items():
            with open(os.path.join(tile_dir, key + ".json"), "w", encoding="utf-8") as f:
                json.dump(edges, f, separators=(",", ":"))
        with open(os.path.join(tile_dir, "big.json"), "w", encoding="utf-8") as f:
            json.dump([e for key, edges in tiles.items() if key != "heat" for e in edges if e[2] == 1], f, separators=(",", ":"))
        with open(os.path.join(FRONTEND, "city.json"), "w", encoding="utf-8") as f:
            f.write(blob)
        return city, version, None
    except OSError:
        return city, version, dict(meta, inline=tiles)


@st.cache_data(ttl=600, show_spinner=False)
def load_weather(name):
    return weather.get(name)


@st.cache_data(ttl=600, show_spinner=False, max_entries=8)
def analyse(name, stamp, signature):
    return pipeline.analyse(load_city(signature)[0], load_weather(name))


@st.cache_data(ttl=600, show_spinner=False, max_entries=32)
def find_compare(name, stamp, signature, src, dst):
    return pipeline.compare(load_city(signature)[0], analyse(name, stamp, signature), src, dst)


@st.cache_data(ttl=600, show_spinner=False, max_entries=64)
def find_route(name, stamp, signature, src, dst):
    return pipeline.route(load_city(signature)[0], analyse(name, stamp, signature), load_weather(name), src, dst)


loading = st.empty()
loading.markdown(
    '<div style="position:fixed;inset:0;display:grid;place-items:center;background:#070B18;color:#9FE3FF;'
    'font:600 14px system-ui;letter-spacing:.3em;text-transform:uppercase;z-index:5">БОРАН · загружаю карту Астаны…</div>',
    unsafe_allow_html=True,
)
city, version, inline_city = load_city(data_signature())
loading.empty()
state = st.session_state.get("boran") or {}
scenario = state.get("scenario", "live")
if scenario != "live" and scenario not in weather.SCENARIOS:
    scenario = "live"
wx = load_weather(scenario)
stamp = f'{wx["date"]}{wx["now"]["time"]}{wx["source"]}'
sig = data_signature()
an = analyse(scenario, stamp, sig)

route = None
error = None
src, dst = state.get("src"), state.get("dst")
if src and dst:
    try:
        route = find_route(scenario, stamp, sig, (round(src[0], 5), round(src[1], 5)), (round(dst[0], 5), round(dst[1], 5)))
        if route is None:
            error = "no_path"
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"

compare = None
if src and dst and state.get("cmp"):
    try:
        compare = find_compare(scenario, stamp, sig, (round(src[0], 5), round(src[1], 5)), (round(dst[0], 5), round(dst[1], 5)))
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"

payload = {
    "n": state.get("n", 0),
    "scenario": scenario,
    "scenarios": list(weather.SCENARIOS),
    "places": config.PLACES,
    "weather": wx,
    "hmm": an["hmm"],
    "prior": round(an["prior"], 4),
    "riskTable": [int(round(an["table"][m] * 100)) for m in range(32)],
    "wind_k": an["wind_k"],
    "route": route,
    "error": error,
    "compare": compare,
    "ack": state.get("n", 0),
    "cityVersion": version,
    "city": inline_city,
    "params": {"alpha": config.ALPHA_RISK, "beta": config.BETA_WIND, "threshold": config.TRANSIT_THRESHOLD_M},
}

value = boran_map(payload=payload, key="boran_component", default=None)
if value and value != st.session_state.get("boran"):
    st.session_state["boran"] = value
    st.rerun()
