# 0025 - Bounded shipment planning and isolated demo launcher

Date: 2026-10-02. Status: accepted review fixes.

The review found zero-rounded dimensions, excessive candidate generation, and incomplete
shipments saved with omitted cargo. Owner decision 0024 explicitly rejects an arbitrary
three-layer default: unstated stacking remains bounded by the roof. The review's three-layer
recommendation is superseded by recorded owner intent; UI, tool and algorithm agree.

Shipment dimensions must be at least 1 mm before conversion. Candidate spots are limited
by requested quantity; walls exceeding 5,000 spots or 2,000,000 candidate spot evaluations
per part are reported as unsupported. Gap generation stops at remaining quantity. Dense
millimetre cargo can be rejected even though it geometrically fits. The legacy `tooBig`
result also carries unsupported ids; explanations name container, payload or planning limits.

Creation refuses incomplete plans before any store write, naming omitted part ids and
complete-set models. The form disables creation and displays reasons. Persisted projects,
schemas and cargo metadata are not rewritten.

`start-demo.bat` uses `PLANNER_DATA=data-demo` and fixed `PLANNER_PORT=4601`.
Normal `start.bat` retains `data` and default port 4600. Explicit ports fail when busy.
Command line `--data`/`--port` override environment settings. Browser opening invokes the
mandatory Chrome helper through Python, preferring the workspace helper then user skill
helper. No system URL handler is used.

POST `/api/backups` with JSON `{}` makes a consistent SQLite `VACUUM INTO` snapshot
under `dataDir/backups`, with timestamp and UUID naming. It reopens the snapshot read-only
and checks SQLite integrity, foreign keys, every saved revision and its project/revision identity, current revision links and
settings JSON. Returns `{name, rehearsal:{ok:true, projects, revisions, settings, agentRuns}}`.
The existing loopback Host/Origin/JSON guard applies; response contains no settings values.
The snapshot includes project revisions, settings (including stored credentials/eco state),
and agent history. Agent work-directory files are outside SQLite and excluded.
Stored API credentials are included intentionally: protect snapshots like the live database.
The planner's ecosystem keys use Windows DPAPI for the current user, with no data-directory
keyfile. They remain usable when restoring to another folder on the same machine under the
same Windows account. On another machine or account, re-enter/re-pair the GMES and live-view
keys; the SQLite rehearsal validates stored JSON, not operating-system key decryption.

For restore: stop the server; preserve the existing data folder separately; move `planner.db`
and its `-wal`/`-shm` sidecars into that preserved location; copy a verified named snapshot to
`planner.db` in the selected data directory, then start with that directory. Never leave old
sidecars beside the restored database. Rehearse first in a different directory and port;
the regression test compares all revisions, current project, settings and agent logs.

The launcher accepts `--no-open`, suppressing automatic Chrome opening for package launches.
