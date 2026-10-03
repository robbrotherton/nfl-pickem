# Matchup insights preview

Feature branch: `feature/matchup-insights`, based on the synced `fix/season-boundaries` commit `7fda892`.
Worktree: `/home/rb/nfl-pickem-matchup-insights`.

The running preview is available at **http://192.168.1.192:3101** on the LAN. It has a yellow preview banner. Port **3000** remains the original live app. In VS Code Remote SSH, forward port 3101 to use the preview through localhost.

## Data isolation

The preview uses `.preview/nfl-pickem.db`, created with SQLite's online backup API while the source database is opened read-only. The snapshot is reused on restarts. All preview picks, scoring, player changes, and schedule refreshes go to this separate file. Nothing is copied back into production. The database and ESPN metadata are ignored by Git. Pregame history is kept in the separate `.preview/insights-cache/insights.db`; it never changes the picks database schema or game rows.

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

- A combined player-availability card per team always shows the first QB on ESPN's depth chart, his injury status, and available regular-season passing totals/rating, even when a backup has more passing yards.
- If QB1 is Out or otherwise unavailable, show the next available QB on the depth chart with his own stats. Label him an expected replacement, not a confirmed game-day starter. Doubtful shows the backup conditionally; Questionable does not promote a backup. Missing stats and unavailable reports stay explicit.
- If a saved earlier report for this same game listed another QB1 and the chart later promotes his backup, preserve the original QB's current Out/Doubtful designation as “Previously listed QB1.” An older report alone never establishes that he is currently injured.
- Up to two other starters to watch, usually a receiver and defender, selected from all entries in the bulk leader feed. Hide reserves and players listed Out or Doubtful. Questionable starters retain their status. Individual player APIs are not called.
- Key injuries appear before the QB and healthy-starter groups. A significant designation is prominent if the player is a listed starter, a previously observed QB1 for this game, or a major season contributor. Injured reserves can qualify without being called starters; healthy reserve stat leaders do not become players to watch. Featured QB/highlight rows are not duplicated in key injuries.
- Contributor eligibility uses the top two passers/rushers, top three receivers, and top two in sacks/tackles/interceptions, with positive production of at least 25% of that category leader's value. This is a tunable heuristic, not a claim about snap share. Saved scoreboards without numeric values can identify their category's first listed leader only. Key injuries show ranking/stat evidence and its fetch time; small contributors and unconfirmed roles remain in the full report.
- Recent regular-season meetings from the selected year and previous five years. ESPN's requestedSeason and individual event metadata are checked; its current-season header is not mistaken for historical schedule context.
- Common-opponent comparisons and last three results from stored completed regular-season games in the selected year, strictly before the selected matchup's kickoff. Ties are handled explicitly.
- Current reports apply only before kickoff, within eight days, with a matching season. Past matchups display saved pregame reports if captured; they never use today's injuries or current season totals.
- Recent results and common-opponent rows include the saved QB1 designation and expected replacement, when known. No captured report means unknown, not healthy. A pregame designation is not proof of actual participation or the cause of a loss.
- Source links and injury report timestamps are visible. Schedules load independently of insights, and failed ESPN requests retain the available local facts and schedules.
- Browser scoreboard calls use a validated same-origin endpoint because ESPN blocked direct browser requests during smoke testing. The endpoint accepts only scoreboard season/type/week parameters; it cannot proxy arbitrary URLs.

There is no AI invocation, paid API dependency, or weather feature in this version. Depth charts can lag injuries; saved leaders mitigate that gap, but this does not identify every important player or measure snap share. A full report is available for that reason. ESPN endpoints are unofficial and may change. Missing historical sources are reported rather than treated as complete coverage.

## Validation performed

- `npm test`: existing tiebreaker and season suites plus starter-return/replacement scenarios, every-QB stat matching, unavailable/reserve exclusion, injury uncertainty, adaptive cache lifetimes, immutable pregame snapshots, whole-scoreboard capture without stats fetches, historical QB result notes, restart persistence, stale fallback, failure cooldowns, and read-only game access. Saved IDs eliminate directory lookups; no game summaries are fetched.
- Actual Chromium browser against port 3101: banner, current matchup, historical season switch, regular-season schedules, common opponents, mobile popup fit, and simulated insight failure while schedules remain available.
- Real Vikings and Bears examples: Vikings QB1 shown instead of passing-leader backup; Bears QB1 Out plus the next depth-chart QB's own stats; combined team cards fit mobile. Current-week scoreboard capture retained reports for 30 upcoming teams.
- Real Giants/Vikings injury examples: Dart's injured-reserve status is visible as a major passing contributor despite being third on the chart, and Jefferson's Out designation/rank appears above healthy starters. Desktop/mobile checks confirm both are visible without expanding the report.
- Added and selected a temporary preview-only player's pick through the real UI, checked the preview SQLite row, and verified the same player had zero production picks using a read-only connection. Removed the test player and pick afterward. All browser writes used port 3101.
- Checked the preview's LAN URL, the production checkout remained clean, and the production process retained its original PID without restart.

Screenshots are in ignored `.preview` files, including `vikings-qb-desktop.png`, `bears-qb-desktop.png`, and `bears-qb-mobile.png`.

Nothing has been merged into main or deployed to the original live process. Review the preview before production rollout; take a fresh consistent database backup at rollout time.

## Popup requests and cache lifetimes

Each opening makes one request to `/api/matchup-insights/:gameId` and two requests to the local team-schedule endpoint. The server assembles insights on each request from the database and cached ESPN responses. No AI runs.

The ESPN base is `https://site.api.espn.com/apis/site/v2/sports/football/nfl`:

| ESPN path | Purpose | Cache lifetime |
| --- | --- | --- |
| `/teams?limit=100` | Bootstrap unknown team IDs, names, abbreviations, logos | Only if a team ID is missing; response cached 30 days |
| `/teams/TEAM_ID/schedule?season=YEAR&seasontype=2` | Fill historical coverage missing from stored games | Completed seasons persist without expiry; active/future seasons 6 hours |
| `/injuries` | Shared current injury feed | 6 hours; 30 minutes within six hours of an upcoming kickoff |
| `/teams/TEAM_ID/depthcharts` | Listed starters, QB order, embedded injuries, player identity | 6 hours; 30 minutes within six hours of that team's kickoff |
| Core API `/seasons/YEAR/types/2/teams/TEAM_ID/leaders` | Bulk season leader statistics, including defense | 12 hours; invalidated by a new locally stored completed game |

The leader URL uses `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl` with `?lang=en&region=us`. Player-leader requests are made only when a current matchup is opened. Injury and depth-chart seasons are validated; current reports are never shown for past matchups. Complete local regular-season schedules skip the corresponding ESPN request. Common-opponent comparisons and recent form use stored games.

Team IDs and scoreboard leader snapshots are saved whenever an existing server scoreboard fetch succeeds, with no additional request. IDs persist across restarts. Snapshots explicitly distinguish game statistics from season totals. Saved season leaders provide an offensive fallback if the richer leader endpoint fails.

Responses, IDs, and snapshots live in `insights.db` inside the ignored insight-cache directory, separate from the application's picks database. Legacy cached JSON responses are imported when needed. The cache is shared across users and matchups and survives restarts. Identical simultaneous requests share one upstream fetch. Refresh failures retain saved data and delay retries for five minutes, including previously unavailable responses. Expired data refreshes on demand; there is no scheduled polling job. Scoreboards elsewhere in the app retain their separate one-minute memory cache.

## Pregame history

Existing current-week scoreboard fetches also start a background capture for upcoming regular-season games within eight days. This uses one shared injury feed and one cached depth-chart response per team, with at most four teams processed at once. It does not delay scoreboard delivery and fetches no player stats for archiving. Opening a matchup also captures its fresh available context.

The `availability` table retains the latest successfully observed injury/depth context for each game and team, including separate fetch timestamps and QB order/status. It is never overwritten after kickoff. Archived QB cards exclude season totals; key injuries retain the stat evidence observed before kickoff, with its timestamp. Background capture reuses already cached bulk leaders or scoreboard leaders without new statistics calls. Historical viewing performs no current injury/depth/player requests. There is no retroactive reconstruction and no independent background timer: games not observed before kickoff have no snapshot. If the page was last used days before kickoff, its saved report may be correspondingly old; the timestamps make that visible.

**Retain and back up `insights.db` alongside the picks database when deploying.** It now contains historical reports as well as refreshable responses. The existing `npm run backup` script backs up only the picks database; a rollout must also take an online SQLite backup of the metadata file. Do not delete the entire metadata database to clear responses. Moving/resetting the preview directory keeps the old directory's history separate; preview data is not automatically imported into production.

## Responsibilities

- `lib/player-context.js`: pure depth-chart, injury, QB-replacement, and starter-highlight rules; no network or database access.
- `lib/player-contributions.js`: production thresholds and prominent-injury selection shared by live and archived views.
- `lib/team-availability.js`: fetch lifetimes, team assembly, and pregame capture.
- `lib/espn-cache.js`: request deduplication, persistence, validation, stale fallback, and retry cooldowns.
- `lib/insights-store.js`: metadata and historical snapshot storage.
- `lib/matchup-insights.js`: matchup/history assembly; the app database is read-only to this service.
- `public/matchup-insights.js`: presentation helpers; no football selection rules in the browser.

The popup reuses team logos and available player headshots. Meetings have two-team score rows, common opponents have team comparison cards, and recent form has opponent logos and W/L/T badges. Cards stack on phones, missing logos fall back to abbreviations, and the popup header/close button stay visible while scrolling. No extra ESPN calls were introduced for images.
