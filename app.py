import hashlib
import json
import os

import streamlit as st
import streamlit.components.v1 as components

from boran import config, graph, pipeline, weather

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


@st.cache_resource(show_spinner=False)
def load_city():
    city = graph.get_city()
    blob = json.dumps(city.frontend(), ensure_ascii=False, separators=(",", ":"))
    version = hashlib.md5(blob.encode("utf-8")).hexdigest()[:10]
    served = True
    try:
        with open(os.path.join(FRONTEND, "city.json"), "w", encoding="utf-8") as f:
            f.write(blob)
    except OSError:
        served = False
    return city, version, (None if served else json.loads(blob))


@st.cache_data(ttl=600, show_spinner=False)
def load_weather(name):
    return weather.get(name)


@st.cache_data(ttl=600, show_spinner=False, max_entries=8)
def analyse(name, stamp):
    return pipeline.analyse(load_city()[0], load_weather(name))


@st.cache_data(ttl=600, show_spinner=False, max_entries=64)
def find_route(name, stamp, src, dst):
    return pipeline.route(load_city()[0], analyse(name, stamp), load_weather(name), src, dst)


loading = st.empty()
loading.markdown(
    '<div style="position:fixed;inset:0;display:grid;place-items:center;background:#070B18;color:#9FE3FF;'
    'font:600 14px system-ui;letter-spacing:.3em;text-transform:uppercase;z-index:5">БОРАН · загружаю карту Астаны…</div>',
    unsafe_allow_html=True,
)
city, version, inline_city = load_city()
loading.empty()
state = st.session_state.get("boran") or {}
scenario = state.get("scenario", "live")
if scenario != "live" and scenario not in weather.SCENARIOS:
    scenario = "live"
wx = load_weather(scenario)
stamp = f'{wx["date"]}{wx["now"]["time"]}{wx["source"]}'
an = analyse(scenario, stamp)

route = None
error = None
src, dst = state.get("src"), state.get("dst")
if src and dst:
    try:
        route = find_route(scenario, stamp, (round(src[0], 5), round(src[1], 5)), (round(dst[0], 5), round(dst[1], 5)))
        if route is None:
            error = "no_path"
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
    "risk": [int(round(r * 100)) for r in an["risks"]],
    "wind_k": an["wind_k"],
    "route": route,
    "error": error,
    "ack": state.get("n", 0),
    "cityVersion": version,
    "city": inline_city,
    "params": {"alpha": config.ALPHA_RISK, "beta": config.BETA_WIND, "threshold": config.TRANSIT_THRESHOLD_M},
}

value = boran_map(payload=payload, key="boran_component", default=None)
if value and value != st.session_state.get("boran"):
    st.session_state["boran"] = value
    st.rerun()
