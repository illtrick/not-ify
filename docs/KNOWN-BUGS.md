# Known Bugs

Tracked issues that need fixing but aren't blockers for current work.

## UI

### Duplicate track highlighting
When an album has multiple tracks with the same title (e.g., Tool Undertow has "Prison Sex" listed 3 times), all matching tracks highlight when one is playing. The highlight matches by title, not by unique track ID/position. A fix was attempted and reverted (broke highlighting entirely) — needs a more careful approach that preserves YT preview highlighting while deduplicating same-title tracks.

### Multi-disc albums show inconsistent tracklists
Albums with multiple media/discs on MusicBrainz (e.g., Bonobo "Black Sands Remixed") show different tracklists on each click. Track numbering restarts at 1 for each disc, mixing with library tracks. The MB release selection is non-deterministic across clicks, and multi-disc releases aren't handled (tracks from all discs are flattened into one list).

## Pipeline

### Soulseek track titles show full peer filenames
When Soulseek downloads complete, track titles in the library show the raw peer filename (e.g., `virte, adèle. close to the water (w wajdi riahi...) [2024]. 01. close to the water`) instead of cleaned-up track names. The filenames from Soulseek peers often include artist, album, year, and encoding info. Need to strip this metadata from filenames when importing from Soulseek.

## Infrastructure

### slskd setup requires manual SSH + YAML config
Setting up Soulseek on a new deployment requires:
1. SSH into host, write `slskd.yml` with Soulseek credentials + API key
2. Set `SLSKD_API_KEY` env var on the not-ify container
3. Restart both containers

This should be automated: when the user enters Soulseek credentials in the Settings UI, not-ify should configure slskd automatically — either via the slskd API (if it supports credential updates) or by writing the config file to a shared volume and restarting slskd. The API key should be auto-generated and shared between containers without manual env var setup.

### Docker restart after library path change kills dev server
`process.exit(0)` in the library path change handler works in Docker (restart policy) but kills the dev server permanently. In dev mode, the UI shows "Restarting server..." forever. Need either: (a) don't restart in dev, just re-read the config, or (b) detect non-Docker and warn the user to restart manually.
