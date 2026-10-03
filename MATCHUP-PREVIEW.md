# Matchup insights preview

Feature branch: `feature/matchup-insights`, based on the synced `fix/season-boundaries` commit `7fda892`.
Worktree: `/home/rb/nfl-pickem-matchup-insights`.

The running preview is available at **http://192.168.1.192:3101** on the LAN. It has a yellow preview banner. Port **3000** remains the original live app. In VS Code Remote SSH, forward port 3101 to use the preview through localhost.

## Data isolation

The preview uses `.preview/nfl-pickem.db`, created with SQLite's online backup API while the source database is opened read-only. The snapshot is reused on restarts. All preview picks, scoring, player changes, and schedule refreshes go to this separate file. Nothing is copied back into production. The database and insight caches are ignored by Git.

The launcher sets its own DB_PATH and refuses port 3000, a source/target collision, or a symlinked preview directory/database. The preview has a separate PM2 process named `nfl-pickem-preview`; restarting it does not restart `nfl-pickem`. The preview was not added to PM2's saved startup configuration.

```bash
# Run from this feature worktree (loopback by default):
npm run preview -- --source-db /home/rb/nfl-pickem/nfl-pickem.db

# Restart the currently running preview after server changes:
pm2 restart nfl-pickem-preview

# Stop just the preview:
pm2 stop nfl-pickem-preview
```

Changes in public assets appear on refresh. Server changes require a preview restart. To reset the snapshot, first stop the preview, move its `.preview` directory aside, and start again with the source-db option. Keep test data disposable; it is never merged with live data.

## Popup behavior

- Key absences ranked by listed depth-chart starters and saved team leaders; quarterbacks get priority. Healthy/Active news rows are filtered out. Unconfirmed roles remain in the expandable full report, and Questionable stays Questionable.
- Players to watch: up to three team statistical leaders, usually a passer, receiver, and defender, with season totals, headshots, injury status, and ESPN links. These are statistical leaders, not a prediction of who will start. Individual player APIs are not called.
- Recent regular-season meetings from the selected year and previous five years. ESPN's requestedSeason and individual event metadata are checked; its current-season header is not mistaken for historical schedule context.
- Common-opponent comparisons and last three results from stored completed regular-season games in the selected year, strictly before the selected matchup's kickoff. Ties are handled explicitly.
- Current injury reports are limited to uncompleted matchups within eight days of the current date and with a matching report season. Historical matchups do not use today's injury report.
- Source links and injury report timestamps are visible. Schedules load independently of insights, and failed ESPN requests retain the available local facts and schedules.
- Browser scoreboard calls use a validated same-origin endpoint because ESPN blocked direct browser requests during smoke testing. The endpoint accepts only scoreboard season/type/week parameters; it cannot proxy arbitrary URLs.

There is no AI invocation, paid API dependency, or weather feature in this version. Depth charts can lag injuries; saved leaders mitigate that gap, but this does not identify every important player or measure snap share. A full report is available for that reason. ESPN endpoints are unofficial and may change. Missing historical sources are reported rather than treated as complete coverage.

## Validation performed

- `npm test`: existing tiebreaker and season suites plus matchup regressions for starter-QB prioritization, removed QB contributors, player statistics, healthy-row filtering, ties, season/event mismatches, historical/future cutoffs, restart persistence, stale fallback, failure cooldowns, and read-only game access. Saved scoreboard IDs eliminate directory lookups; no game summaries are fetched.
- Actual Chromium browser against port 3101: banner, current matchup, historical season switch, regular-season schedules, common opponents, mobile popup fit, and simulated insight failure while schedules remain available.
- Added and selected a temporary preview-only player's pick through the real UI, checked the preview SQLite row, and verified the same player had zero production picks using a read-only connection. Removed the test player and pick afterward. All browser writes used port 3101.
- Checked the preview's LAN URL, the production checkout remained clean, and the production process retained its original PID without restart.

Screenshots are in the ignored `.preview/matchup-desktop.png` and `.preview/matchup-mobile.png` files.

Nothing has been merged into main or deployed to the original live process. Review the preview before production rollout; take a fresh consistent database backup at rollout time.

## Popup requests and cache lifetimes

Each opening makes one request to `/api/matchup-insights/:gameId` and two requests to the local team-schedule endpoint. The server assembles insights on each request from the database and cached ESPN responses. No AI runs.

The ESPN base is `https://site.api.espn.com/apis/site/v2/sports/football/nfl`:

| ESPN path | Purpose | Cache lifetime |
| --- | --- | --- |
| `/teams?limit=100` | Bootstrap unknown team IDs, names, abbreviations, logos | Only if a team ID is missing; response cached 30 days |
| `/teams/TEAM_ID/schedule?season=YEAR&seasontype=2` | Fill historical coverage missing from stored games | Completed seasons persist without expiry; active/future seasons 6 hours |
| `/injuries` | Shared current injury feed | 10 minutes |
| `/teams/TEAM_ID/depthcharts` | Both teams' listed starters and player identity | 24 hours |
| Core API `/seasons/YEAR/types/2/teams/TEAM_ID/leaders` | Bulk season leader statistics, including defense | 12 hours; invalidated by a new locally stored completed game |

The leader URL uses `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl` with `?lang=en&region=us`. Injury, depth-chart, and player-leader requests apply only to uncompleted matchups within eight days of kickoff. Injury and depth-chart seasons are validated; current reports are never shown for historical matchups. Complete local regular-season schedules skip the corresponding ESPN schedule request. Common-opponent comparisons and recent form use local stored games.

Team IDs and scoreboard leader snapshots are saved whenever an existing server scoreboard fetch succeeds, with no additional request. IDs persist across restarts. Snapshots explicitly distinguish game statistics from season totals. Saved season leaders provide an offensive fallback if the richer leader endpoint fails.

Responses, IDs, and snapshots live in `insights.db` inside the ignored insight-cache directory, separate from the application's picks database. Legacy cached JSON responses are imported when needed. The cache is shared across users and matchups and survives restarts. Identical simultaneous requests share one upstream fetch. Refresh failures retain saved data and delay retries for five minutes, including previously unavailable responses. Expired data refreshes on demand; there is no scheduled polling job. Scoreboards elsewhere in the app retain their separate one-minute memory cache.

The popup reuses team logos and available player headshots. Meetings have two-team score rows, common opponents have team comparison cards, and recent form has opponent logos and W/L/T badges. Cards stack on phones, missing logos fall back to abbreviations, and the popup header/close button stay visible while scrolling. No extra ESPN calls were introduced for images.
