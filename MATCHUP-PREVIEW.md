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

- Key absences ranked by listed depth-chart starters and recent leading passers/rushers/receivers; quarterbacks get priority. Healthy/Active news rows are filtered out. Unconfirmed roles remain in the expandable full report, and Questionable stays Questionable.
- Recent regular-season meetings from the selected year and previous five years. ESPN's requestedSeason and individual event metadata are checked; its current-season header is not mistaken for historical schedule context.
- Common-opponent comparisons and last three results from stored completed regular-season games in the selected year, strictly before the selected matchup's kickoff. Ties are handled explicitly.
- Current injury reports are limited to uncompleted matchups within eight days of the current date and with a matching report season. Historical matchups do not use today's injury report.
- Source links and injury report timestamps are visible. Schedules load independently of insights, and failed ESPN requests retain the available local facts and schedules.
- Browser scoreboard calls use a validated same-origin endpoint because ESPN blocked direct browser requests during smoke testing. The endpoint accepts only scoreboard season/type/week parameters; it cannot proxy arbitrary URLs.

There is no AI invocation, paid API dependency, or weather feature in this first version. Depth charts can lag injuries; recent offensive leaders mitigate that gap, but this does not yet identify every important defender or measure snap share. A full report is available for that reason. ESPN endpoints are unofficial and may change. Missing historical sources are reported rather than treated as complete coverage.

## Validation performed

- `npm test`: existing tiebreaker and season suites plus matchup regressions for starter-QB prioritization, removed recent QB contributors, healthy-row filtering, ties, season/event mismatches, historical/future cutoffs, cached requests, missing data, and read-only game access.
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
| `/summary?event=GAME_ID` | Selected matchup and team IDs | 5 minutes |
| `/teams/TEAM_ID/schedule?season=YEAR&seasontype=2` | Recent meetings; selected year plus five previous years, using one team's schedules | 10 minutes for selected year; 24 hours for older years |
| `/injuries` | Shared current injury feed | 10 minutes |
| `/teams/TEAM_ID/depthcharts` | Both teams' listed starters | 6 hours |
| `/summary?event=PREVIOUS_GAME_ID` | Each team's recent offensive leaders | 24 hours |

Injury, depth-chart, and recent-leader requests apply only to uncompleted matchups near kickoff with a matching injury-report year. Missing previous games skip the corresponding summary request. Common-opponent comparisons and recent form are computed from local stored games and require no extra ESPN calls.

The raw-response cache is shared by URL across users and matchups, held in memory and written into the preview's ignored insight-cache directory so it survives restarts. Identical simultaneous requests share one upstream fetch. Expired responses are refreshed when next requested; there is no scheduled polling job. The browser requests a new assembled response each time the popup opens. Scoreboards elsewhere in the app have a separate one-minute memory cache.

The popup now reuses team-logo metadata already in schedules, summaries, and stored games. Meetings have two-team score rows, common opponents have team comparison cards, and recent form has opponent logos and W/L/T badges. Cards stack on phones, missing images fall back to abbreviations, and the popup header/close button stay visible while scrolling. No extra ESPN calls were introduced for logos.
