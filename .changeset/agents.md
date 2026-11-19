---
'@abdofawzi5/cclens': minor
---

New `cclens agents`: calls, runs, tokens and estimated cost for every subagent type you use (`--by session` shows where agent tokens went), and the installed agents you never call (`--unused`). Each run is priced per message by the model it actually ran on, using the LiteLLM price list ccusage uses (downloaded once a day, nothing sent); when a model has no price, the cost is the run's share of its session's cost and is marked `*`. `cclens review` gains two rules: `unused-agents` (agent descriptions cost tokens on every request) and `expensive-agents` (runs that used over 40% of their session's tokens).
