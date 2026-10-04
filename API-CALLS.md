# API calls and schedule loading

## Why loading used to wait

Startup awaited an ESPN scoreboard to choose season/week/calendar, sometimes a second week-one scoreboard for publication/calendar discovery. It also started regular-season and preseason seed requests, which fetched every missing week from ESPN in the background. The selected week's schedule refreshed whenever **any game was not final**, including future games. Even an all-final week refreshed on Sunday/Monday/Thursday if its stored timestamps were over an hour old. Each refreshed game then made a separate local DB write before rendering.

## Current schedule policy

When the current season exists locally, startup reads `/api/seasons` and `/api/games/:season`, derives the selected week from stored kickoff dates, and uses standard week labels. The chosen week remains current through its last kickoff and the following day. Season changes also read stored dates. No ESPN calendar request is needed for a stored season.

The selected week always loads from `/api/games/:season/:week?season_type=TYPE` first:

- Stored games, all final or all unfinished kickoffs still in the future: render from DB, with no ESPN call.
- Stored games with an `in_progress` status or an unfinished game whose kickoff has passed: render from DB, then refresh the scoreboard in the background. Elapsed kickoff is checked because a cached `scheduled` status may be outdated. Failed refreshes retain the stored schedule; completed refreshes update scores/picks. Leaving the week or opening the leaderboard prevents a delayed response from replacing that view.
- Empty week: fetch ESPN, save games, then render. There is no stored schedule to display yet.
- Click the Game header: explicitly fetch that week's scoreboard, save it, and update the view.

There is no score polling timer. Automatic refresh happens when the schedule loads; manual refresh remains available. Already final games are trusted until a manual refresh, including later score corrections. Future kickoff changes likewise require manual refresh.

If no usable current-season schedule is stored, startup retains ESPN season discovery and calendar fallback. This can wait for ESPN. Page load no longer invokes full-season seeding. The seed endpoint remains available explicitly and only fetches missing weeks unless forced.

## Every active external API call

| ESPN request | Trigger and purpose | Sharing/cache |
| --- | --- | --- |
| Site API `/scoreboard?dates=YEAR&week=WEEK&seasontype=TYPE` | Missing selected week, background score update after kickoff, or manual Game-header refresh | Same query cached in server memory for 60 seconds; simultaneous requests share one fetch; cache resets on server restart |
| Site API `/scoreboard` | Startup fallback when current-season dates are unavailable locally; selects current season/type/week | Same 60-second server cache; season info reused within the browser page |
| Site API week-one scoreboard | Startup fallback to discover a released season or obtain its calendar | Same 60-second server cache; calendar reused within the browser page |
| Site API `/injuries` | An upcoming matchup needs a current report, or successful scoreboard fetch starts pregame archiving | **One league-wide feed**, shared across teams, matchups, and users; 6 hours, tightened to 30 minutes within 6 hours of an upcoming stored kickoff |
| Site API `/teams/ID/depthcharts` | Upcoming matchup or background pregame archiving needs listed starters/QB order | Per team: 6 hours, 30 minutes within 6 hours of that matchup's kickoff |
| Core API `/seasons/YEAR/types/2/teams/ID/leaders?lang=en&region=us` | Opening an upcoming matchup needs bulk season player statistics | Per season/team: 12 hours, invalidated when the team's latest locally stored final game changes; background archiving never fetches this |
| Site API `/teams/ID/schedule?season=YEAR&seasontype=2` | Opening a matchup needs historical meeting coverage absent or incomplete in the DB | Only the away team's schedule is needed to find meetings; up to selected year plus 5 previous years. Completed seasons persist without expiry; active/future seasons 6 hours |
| Site API `/teams?limit=100` | Opening a matchup cannot resolve one of the team IDs from saved metadata | Shared directory cached 30 days; skipped when IDs are already known |
| Site API scoreboard per missing week | Explicit POST `/api/season/:season/seed?season_type=TYPE` (or `force=1`) | Separate server HTTPS path, sequential weeks, without the proxy's 60-second cache; no longer invoked on page load |

Site API base: `https://site.api.espn.com/apis/site/v2/sports/football/nfl`.
Core API base: `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl`.

Matchup response caches persist in `.cache/matchup-insights/insights.db`, separate from `nfl-pickem.db`, and are shared across requests/users. Identical concurrent requests are deduplicated. Expired responses refresh on demand. Failures retain usable stale data and defer retries for 5 minutes. No independent injury/depth/stat polling job exists.

A successful uncached scoreboard fetch also starts **background** pregame archiving for regular-season games within 8 days of kickoff: one shared injury feed and a depth-chart request per uncached/expired team, with 4 teams processed at once. It does not delay the scoreboard response and makes no new statistics calls. Avoiding scoreboard calls for stored future weeks also avoids this incidental archive activity. Opening a matchup still captures its available pregame context; games never observed before kickoff may have no archived report.

## Each matchup opening

Every opening makes three same-origin requests:

1. `/api/games/:season/team/:awayTeam?season_type=2`: DB schedule.
2. `/api/games/:season/team/:homeTeam?season_type=2`: DB schedule.
3. `/api/matchup-insights/:gameId`: assembles local results plus cached ESPN data.

The two schedules render independently of insights. The insights request is made on each opening, but upstream ESPN requests happen only for missing/expired resources. Reopening a cached matchup often makes **zero external API calls**. Another matchup shares the injury feed and any overlapping team data.

Current injury/depth/player-stat requests apply only to unfinished regular-season matchups **before kickoff and within 8 days**. Historical matchups use archived availability and may fetch missing historical schedules, but never today's injuries/depth/stats. Recent form and common opponents come from stored results. No AI calls, game-summary calls, or per-player statistics calls occur.

## Other same-origin requests

These access SQLite or app configuration, without ESPN:

- Initial page: `/api/app-info` (preview banner), `/api/seasons`, stored season/week games, `/api/week-players/:season/:week`, `/api/players` (autocomplete), `/api/picks/:season/:week`, and `/api/leaderboard/:season/:week`.
- Empty player list: may read earlier week's players and copy them with POST `/api/week-players`.
- Every schedule render: POST `/api/score-picks` for each final game with a winner, before reading picks/leaderboard. These local writes are still awaited.
- Refreshed schedule: POST `/api/games` once per ESPN event to save its data.
- Player changes: POST `/api/week-players` or DELETE `/api/week-players/:season/:week/:player`, followed by reloading the selected schedule.
- Picks: POST `/api/picks` or DELETE `/api/picks/:player/:gameId`.
- Season leaderboard: `/api/leaderboard/:season`, optionally filtered by season type.
- Playoff views: stored season games, stored playoff-week games, plus `/api/conference-records/:season`, `/api/division-records/:season`, `/api/common-games/:season`, `/api/head-to-head/:season`, and regular-season games for tiebreaks. Active playoff pages use DB data.

Team logos, player headshots, and wordmarks also load as browser image requests from their existing image URLs/CDNs. Those are separate from the football data API requests described above.

`public/modules/api.js` retains older exported ESPN standings/current-season/remaining-games/clincher helpers. No active page imports those helpers: current playoff pages use `fetchDbSeasonData`. If invoked, the old standings helper scans every regular-season week, fetches two conference clincher feeds, and follows team reference URLs; the old remaining-games helper scans the remaining weeks. Root-level `app.js`/`index.html` are legacy files; Express serves `public/`.
