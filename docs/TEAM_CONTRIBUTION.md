# Team Contribution Statement

**Project:** BORAN — safe winter walking routes for Astana
**Course:** AI Fundamentals, Final Project, Qairu University

Each member owned one part of the system and one part of the defence. Work was split so that everyone contributed roughly the same effort (about 25 % each).

| Member | Main responsibility | Code and artefacts | In the defence |
|---|---|---|---|
| **Bilal Yuldashov** — team lead | Idea and architecture, web interface, integration and deployment | `app.py`, `boran/frontend/*` (map, AI brain panel, navigator, EXPO parking game), `boran/pipeline.py`, Streamlit Cloud deployment, GitHub repository | Problem statement (2 min) and live demo |
| **Shakhrukh Tashmetov** | Search algorithms | `boran/astar.py`, `boran/search.py` (BFS, DFS, UCS, Greedy, A*), cost function, `boran/frost.py`, garage search `boran/frontend/parking/ai.js`, search comparison in `tools/evaluate.py` | AI topic: search; answers on A*, heuristics and the comparison table |
| **Yerzhan Baibek** | Probabilistic reasoning and data | `boran/hmm.py` (forward filter, Viterbi), `boran/bayes.py`, crowd ice reports `boran/reports.py`, weather data and scenarios `boran/weather.py`, OSM street features in `tools/build_data.py` | AI topic: HMM and Naive Bayes |
| **Kenzhe Yerassyl** | Decision making, evaluation and documentation | `boran/mdp.py` (value iteration), night sanding dispatcher `boran/night.py`, tests in `tests/`, `notebook/boran.ipynb`, Technical Report and results | AI topic: MDP; testing and results |

## Shared work

- All four members agreed on the problem, the pipeline and the model assumptions together.
- Everyone tested the live site on their own devices and reported bugs.
- Slides were prepared together; each member wrote the slide for their own topic.
- Everyone rehearsed the Q&A and can explain the whole pipeline, not only their part.

## Signatures

| Name | Contribution | Signature |
|---|---|---|
| Bilal Yuldashov | 25 % | |
| Shakhrukh Tashmetov | 25 % | |
| Yerzhan Baibek | 25 % | |
| Kenzhe Yerassyl | 25 % | |
