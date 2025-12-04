// state.js
// Centralized state management for NFL Playoff Calculator

// ========================================
// STATE STORAGE
// ========================================

let _targetTeam = 'CHI';
let _currentSeason = null;
let _currentWeek = null;
let _allStandings = [];
let _allGames = [];
let _criticalGames = [];
let _userOutcomes = {}; // gameId -> 'home' or 'away'
let _currentBestCase = null;
let _currentWorstCase = null;
let _useWeightedSimulation = true;

// ========================================
// GETTERS
// ========================================

export function getTargetTeam() {
    return _targetTeam;
}

export function getCurrentSeason() {
    return _currentSeason;
}

export function getCurrentWeek() {
    return _currentWeek;
}

export function getAllStandings() {
    return _allStandings;
}

export function getAllGames() {
    return _allGames;
}

export function getCriticalGames() {
    return _criticalGames;
}

export function getUserOutcomes() {
    return _userOutcomes;
}

export function getUserOutcome(gameId) {
    return _userOutcomes[gameId];
}

export function getCurrentBestCase() {
    return _currentBestCase;
}

export function getCurrentWorstCase() {
    return _currentWorstCase;
}

export function isUsingWeightedSimulation() {
    return _useWeightedSimulation;
}

// ========================================
// SETTERS
// ========================================

export function setTargetTeam(teamAbbr) {
    _targetTeam = teamAbbr;
}

export function setCurrentSeason(season) {
    _currentSeason = season;
}

export function setCurrentWeek(week) {
    _currentWeek = week;
}

export function setAllStandings(standings) {
    _allStandings = standings;
}

export function setAllGames(games) {
    _allGames = games;
}

export function setCriticalGames(games) {
    _criticalGames = games;
}

export function setUserOutcomes(outcomes) {
    _userOutcomes = outcomes;
}

export function setUserOutcome(gameId, winner) {
    _userOutcomes[gameId] = winner;
}

export function removeUserOutcome(gameId) {
    delete _userOutcomes[gameId];
}

export function clearUserOutcomes() {
    _userOutcomes = {};
}

export function setCurrentBestCase(scenario) {
    _currentBestCase = scenario;
}

export function setCurrentWorstCase(scenario) {
    _currentWorstCase = scenario;
}

export function setUseWeightedSimulation(useWeighted) {
    _useWeightedSimulation = useWeighted;
}

// ========================================
// COMPUTED STATE HELPERS
// ========================================

export function getTargetTeamData() {
    return _allStandings.find(t => t.abbr === _targetTeam);
}

export function getConferenceStandings(conference) {
    return _allStandings.filter(t => t.conference === conference);
}

export function getTargetConferenceStandings() {
    const targetTeam = getTargetTeamData();
    const conference = targetTeam?.conference || 'NFC';
    return getConferenceStandings(conference);
}

export function getDivisionStandings(division) {
    return _allStandings.filter(t => t.division === division);
}

export function getTargetDivisionStandings() {
    const targetTeam = getTargetTeamData();
    const division = targetTeam?.division || 'NFC North';
    return getDivisionStandings(division);
}

// ========================================
// STATE RESET
// ========================================

export function resetState() {
    _targetTeam = 'CHI';
    _currentSeason = null;
    _currentWeek = null;
    _allStandings = [];
    _allGames = [];
    _criticalGames = [];
    _userOutcomes = {};
    _currentBestCase = null;
    _currentWorstCase = null;
    _useWeightedSimulation = true;
}
