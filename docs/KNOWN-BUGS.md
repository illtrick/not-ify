# Known Bugs

Tracked issues that need fixing but aren't blockers for current work.

## UI

### Duplicate track highlighting
When an album has multiple tracks with the same title (e.g., Tool Undertow has "Prison Sex" listed 3 times), all matching tracks highlight when one is playing. The highlight matches by title, not by unique track ID/position. A fix was attempted and reverted (broke highlighting entirely) — needs a more careful approach that preserves YT preview highlighting while deduplicating same-title tracks.

### Multi-disc albums show inconsistent tracklists
Albums with multiple media/discs on MusicBrainz (e.g., Bonobo "Black Sands Remixed") show different tracklists on each click. Track numbering restarts at 1 for each disc, mixing with library tracks. The MB release selection is non-deterministic across clicks, and multi-disc releases aren't handled (tracks from all discs are flattened into one list).

## Pipeline

_(none currently)_

## Infrastructure

_(none currently)_
