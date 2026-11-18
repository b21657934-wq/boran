# Народная карта гололёда — design

## Why
The defence question is "why is this needed if 2GIS exists?". Astana sees thousands of winter fall injuries
(16 000 hospital visits in Nov–Dec of one season, 500+ a day at peaks) and nobody — not 2GIS, not the akimat —
knows which pavement is slippery right now. БОРАН becomes the place where residents report it and the city sees
where to send sand first.

## Goals
- Anyone marks a spot as «Скользко», «Снег не убран» or «Чисто / посыпано» in one tap.
- Every open copy of the site sees new marks within ~10 s (live demo: phone → teacher's screen).
- Each street segment's ice probability is updated from the marks (Bayes) and fades over time (HMM).
- Routes avoid segments people marked as icy.
- «Для города» list: segments ranked by ice probability × how many people walk there; «Посыпали» turns it green.
- Keep the existing forecast-accuracy table, now computed from everyone's marks.

## Non-goals
Accounts, moderation, spam protection, permanent storage, push notifications.

## Approaches considered
- A. Shared in-process memory + demo marks loaded at start (chosen by the user: zero setup, works live in the demo,
  marks reset when the app sleeps or redeploys).
- B. Supabase database (permanent, but needs an account and keys).
- C. Commits to a GitHub file (every mark is a commit; rejected).

## Design
- `boran/reports.py`: thread-safe `Store` (one per process via `st.cache_resource`), dedup by client id,
  marks older than 12 h dropped.
- Belief per segment: two-state HMM (slippery / safe). Prior = current Naive Bayes risk of the segment.
  Between marks the state drifts back to the prior (τ = 3 h). Each mark is an observation with likelihoods
  ice (0.70 | 0.08), packed (0.25 | 0.22), dry (0.05 | 0.70).
- Foot traffic: ~900 sampled shortest paths between bus stops and city places (300–2500 m apart), edge use counts
  (sampled betweenness).
- City priority = P(ice) × normalised traffic, nearby segments of the same street merged, top 10.
- Publishing: `reports.json` written next to the map files on every change (and at least once a minute);
  the page polls it every 8 s. Sending a mark goes through the existing component value → Python rerun.
- Route and comparison cache keys include the store version and a 10-minute time bucket.

## Left to the builder
Marker styling, panel layout, wording in KK/EN, demo mark placement (avoid the dorm and campus so the default
route stays the direct one).
