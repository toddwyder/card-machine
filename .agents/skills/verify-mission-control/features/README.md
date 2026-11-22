# Mission Control Feature Map

User-facing features verified by `verify-mission-control`:

| Feature | File | What it proves |
| --- | --- | --- |
| Run view | [`run-view.md`](run-view.md) | Card title, largest stage heading, step counter, 6 distinct step states, helper cards newest-first, estimate wording, responsive layout |
| Warnings & states | [`warnings-and-states.md`](warnings-and-states.md) | All 4 warning banners (`stuck`, `quota_low`, `burning_fast`, `stopped`), `waiting_for_you`, and `idle` with `lastRun` |
| Subscriptions | [`subscriptions.md`](subscriptions.md) | CommandCode, ChatGPT, and Claude Code quota bars (`ok`, low-quota dashed ring `<= 20%`, and `unknown` never `0%`) against live provider readouts |
