# JUL-361 experiment isolation

On 21 November 2026, the active Codex session `session-7554.scope` had a runtime `MemoryMax` of 5 GiB and no swap. The target Studio had a runtime `MemoryMax` of 2 GiB and no swap. These runtime settings do not persist across a reboot or cover a new session.

Each experiment ran in its own systemd user unit with a memory limit. In the proof, a Python process attempted to allocate 256 MiB inside a 64 MiB unit. The kernel killed that process within the unit. Its `memory.events` recorded one OOM kill. Studio continued to answer HTTP requests, and the Codex session continued.

The [JUL-361 memory and crash fix report](https://linear.app/julia-next/document/jul-361-memory-and-crash-fix-report-bc30a7d67a29) records the commands' results and limitations. These limits do not prove that concurrent workloads fit on the server or that an install dies before Studio.
