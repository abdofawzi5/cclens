---
'@abdofawzi5/cclens': patch
---

Skills and agents of plugins turned off with `claude plugin disable` no longer count as installed, so `cclens skills --unused`, `review` and `optimize` stop suggesting plugins you already disabled.
