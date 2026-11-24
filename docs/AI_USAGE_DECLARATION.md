# AI Usage Declaration

**Project:** BORAN — safe winter walking routes for Astana
**Course:** AI Fundamentals, Final Project, Qairu University
**Team:** Bilal Yuldashov, Shakhrukh Tashmetov, Yerzhan Baibek, Kenzhe Yerassyl
**Date:** November 2026

## 1. Tools used

| Tool | Used for |
|---|---|
| Claude (Anthropic), chat and coding agent | writing and debugging code (Python back end, JavaScript front end, the three.js parking game), tests, data-processing scripts, first drafts of the README, this report and the presentation text |
| Canva | layout of the presentation slides |

No AI service runs inside the application. The four AI methods (HMM, Naive Bayes, search algorithms, MDP) are implemented by hand in plain Python and JavaScript without machine-learning libraries.

## 2. What the AI assistant did

- Generated a large part of the source code from our descriptions, including the map front end, the 3D parking game and the evaluation script.
- Helped find and fix bugs (for example video playback in Safari, missing buildings at eye level, the autopilot hitting the barrier).
- Proposed wording and structure for the documentation and slides.
- Suggested implementation details such as the log-space Viterbi, the 2⁵ lookup table for Naive Bayes and pure-pursuit steering for the autopilot.

## 3. What the team did

- Chose the problem (hidden ice in Astana) and the three course topics, and designed the pipeline HMM → Naive Bayes → A* → MDP.
- Set every model assumption: hidden states and observations of the HMM, transition and emission probabilities, Bayes likelihoods, α and β of the cost function, MDP rewards and transition probabilities. These are expert estimates, not trained values, and they are marked as such in the code and the report.
- Checked the algorithms by hand on small examples (Bayes posterior, Viterbi against brute force, UCS = A* on the same graph) and wrote these checks as unit tests.
- Ran the evaluation, read the results and decided what to show and how to explain it.
- Tested the live site on our own laptops and phones, reported problems and asked for changes until the behaviour was right.
- Prepared and rehearsed the defence. Every team member can explain the algorithm they are responsible for without the assistant.

## 4. Verification

All numbers in the report and slides are produced by code in the repository (`python tools/evaluate.py`, `pytest -q`, `node --test tests/js/parking_ai.test.mjs`) and can be reproduced. We did not copy results from the AI assistant without running the code.

## 5. Statement

We used generative AI as a programming and writing assistant, openly and extensively. The idea, the modelling decisions, the testing and the understanding of every algorithm are our own, and we take responsibility for the submitted work.

Signed: Bilal Yuldashov · Shakhrukh Tashmetov · Yerzhan Baibek · Kenzhe Yerassyl
