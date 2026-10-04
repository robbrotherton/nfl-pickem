# Season handling review

These fixes were developed on `fix/season-boundaries`, merged into `main`, and deployed from `/home/rb/projects/nfl-pickem` on October 3, 2026. The temporary worktree was retired on October 4, 2026; its files are archived locally under `backups/worktree-retirement-2026-10-04/`.

The findings and validation below record the original review. See [the deployment record](MATCHUP-PREVIEW.md) for the subsequent production rollout.

## Findings and fixes

- **Matchup popup mixed season types.** The team endpoint returned every type, sorted by week, and the UI took the first game matching a week number. Preseason Week 1 could replace regular-season Week 1. Both the endpoint default and popup now explicitly use regular-season games from the selected year. The popup title includes that year and “Regular Season.”
- **Week defaults and invalid filters could mix or delete multiple types.** Weekly games, weekly leaderboards, and weekly deletion now default to regular season. Invalid years, weeks, or types are rejected before writes. The legacy playoff flag uses type 3 directly rather than guessing from kickoff dates.
- **Refresh deleted cached games before confirming replacement data.** Refresh now validates ESPN's year, type, and week, including event metadata when present, before upserting. It does not delete the cache first. Saving a game cannot move its existing ID to another year/week/type; picks must agree with their game’s context and teams.
- **Historical seasons reused the current season’s calendar.** Calendar requests and caching now use the selected year; changing years rebuilds the selector. Historical regular seasons before 2021 have 17 weeks. January/February fallbacks retain the season’s start year, and active postseason selection retains ESPN's season year.
- **Playoff calculator requests omitted the season year.** Regular-season scoreboard requests now include the selected year and reject mismatched responses. Preseason no longer switches the calculator to a hardcoded old season.
- **Postseason seeding attempted 18 weeks.** It now uses five ESPN postseason slots, including the existing Pro Bowl slot. Automatic seeding fills uncached weeks rather than repeatedly treating bye weeks or the one-game Hall of Fame week as incomplete. `force=1` remains available to re-fetch partially cached weeks.
- **All-season standings undercounted weeks.** Preseason, regular season, and postseason Week 1 now count as three distinct played weeks.

## Validation

`npm test` runs the existing tiebreaker tests plus two new season regression suites. The route tests use in-memory SQLite and stub ESPN, and the client tests use simulated browser globals. No test uses the live app or database. JavaScript syntax and Git whitespace checks also pass.

A read-only check of the live database found zero picks whose stored year/week/type disagreed with their game and zero games with missing season types. This checks stored consistency; it does not independently verify every game against ESPN.

No schema change or production data repair is included. The review covers season context and the affected requests; it is not an exhaustive audit of scoring or playoff rules. Subsequent browser smoke testing and the production rollout are recorded in `MATCHUP-PREVIEW.md`.

For a manual local preview, install dependencies in this checkout and run with an explicit disposable database and loopback binding:

```bash
HOST=127.0.0.1 PORT=3101 DB_PATH=/tmp/nfl-pickem-season-preview.db npm start
```

Opening the app can seed/fetch games into that disposable database; do not point a preview at the production database. Do not edit files in the running checkout until rollout is intended, since it serves public assets directly.
