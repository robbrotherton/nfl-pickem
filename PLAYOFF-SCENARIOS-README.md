# Bears Playoff Scenario Calculator

## What This Does

This is a **standalone test page** that analyzes the Chicago Bears' playoff chances based on remaining NFL games.

## Features

✅ **Real-time ESPN Data**: Fetches current NFC standings and remaining schedule (weeks 14-18)  
✅ **Smart Game Filtering**: Identifies ~20-30 "critical games" that actually affect Bears playoff chances  
✅ **Monte Carlo Simulation**: Runs 1,000 random scenarios to calculate playoff probability  
✅ **Interactive Outcomes**: Click to set game outcomes and see updated playoff chances in real-time  
✅ **Best Case Analysis**: Shows the optimal path for Bears to make playoffs  

## How It Works

### 1. Data Collection
- Fetches NFC standings from ESPN API
- Gets all remaining regular season games (weeks 14-18)
- Identifies team divisions, records, etc.

### 2. Game Filtering (Smart Pruning)
Critical games are identified using this priority system:
- **Critical**: All Bears games (direct impact)
- **High**: NFC North division matchups (Lions, Vikings, Packers, Bears)
- **Medium**: NFC North teams vs other NFC teams
- **Medium**: Wild card contenders within 3 games of 7th playoff spot

This reduces ~150 total remaining games to ~20-30 that actually matter.

### 3. Playoff Calculation
For each scenario:
1. Updates team records based on game outcomes
2. Determines 4 division winners (best record in each NFC division)
3. Determines 3 wild card teams (next best records)
4. Checks if Bears are in top 7

Tiebreakers (simplified):
- Win-loss record (primary)
- Division record (for division winners)
- Head-to-head record (when available)

### 4. Scenario Analysis
- **Monte Carlo**: Randomly simulates 1,000 different outcome combinations
- **User Locked**: When you click outcomes, those are fixed and remaining games vary
- **Performance**: ~1 second to calculate all scenarios

### 5. Interactive UI
- **Top**: Big playoff probability display
- **Standings Table**: Shows current NFC standings with playoff seeds
- **Best Case**: Optimal outcomes for Bears to make playoffs
- **Critical Games**: Click to lock in outcomes and see impact

## How to Use

1. **Open**: `public/playoff-tree.html` in any browser
2. **View**: Check current Bears playoff chances (based on random outcomes)
3. **Interact**: Click game outcomes to see how it affects playoff probability
4. **Experiment**: Try different scenarios:
   - "What if Bears win out?"
   - "What if Vikings lose to Lions?"
   - "What combination gets Bears to playoffs?"

## Technical Details

### Files
- `public/playoff-tree.html` - The page structure and styling
- `public/playoff-tree.js` - All logic (ESPN API, calculations, UI)

### Key Functions
```javascript
fetchNFCStandings()        // Get current standings
fetchRemainingGames()      // Get weeks 14-18 schedule
identifyCriticalGames()    // Filter to important games
calculatePlayoffTeams()    // Determine 7 playoff teams
simulateScenario()         // Run one scenario
setOutcome()               // User interaction
```

### Performance
- Initial load: ~2-3 seconds (fetching 5 weeks of schedules)
- Scenario calculation: ~500ms (1,000 simulations)
- User interaction: Instant (re-runs scenarios)

## Example Output

```
Bears Playoff Chances: 23.4%
Made playoffs in 234 of 1000 simulated scenarios

Best Case Scenario:
✅ Bears make playoffs as 7 seed
- Week 14: Chicago Bears wins
- Week 15: Chicago Bears wins  
- Week 16: Chicago Bears wins
- Week 17: Minnesota Vikings loses
- Week 18: Green Bay Packers loses
```

## Future Enhancements

Possible additions (not yet implemented):
- [ ] More sophisticated tiebreakers (common games, strength of schedule)
- [ ] Win probability for each game (instead of 50/50)
- [ ] Historical data / playoff scenarios from past seasons
- [ ] Team selector (analyze any team, not just Bears)
- [ ] Scenario tree visualization (graph/flowchart)
- [ ] Integration with main pick'em app database

## Current Limitations

1. **Tiebreakers**: Simplified (doesn't handle all NFL tiebreaker rules)
2. **Win Probability**: Assumes 50/50 for each game (doesn't factor in Vegas odds, team strength)
3. **Sample Size**: 1,000 scenarios (could do more but diminishing returns)
4. **Bears Only**: Hardcoded to Chicago Bears (easy to change in code)

## Testing

Current as of: December 3, 2024 (Week 13)
- Bears record: 4-8
- Status: Long shot but mathematically alive

Try scenarios like:
- ✅ Set Bears to win all remaining games → playoff % jumps
- ✅ Set Vikings/Lions to lose key games → helps Bears
- ✅ Mix and match to find realistic paths

---

**Note**: This is a TEST VERSION that runs entirely client-side with ESPN API. It's separate from the main pick'em app and doesn't use the database. Perfect for testing the logic before integrating!
