// Facts from the server, rendered as text; external data is never inserted as HTML.
(function(root) {
    let activeRequest=0;
    function node(tag,text,className) {
        const element=document.createElement(tag);
        if(text!==undefined) element.textContent=text;
        if(className) element.className=className;
        return element;
    }
    function link(text,href) {
        const element=node('a',text);
        // Only approved public source URLs become links.
        if(/^https:\/\/www\.espn\.com\//.test(href||'')) {
            element.href=href;element.target='_blank';element.rel='noopener noreferrer';
        }
        return element;
    }
    function date(value) {return value ? new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';}
    function gameText(game) {return `${game.result} ${game.score}–${game.opponentScore} ${game.home?'vs':'@'} ${game.opponent} · ${date(game.date)}${game.week ? ` · Week ${game.week}` : ''}`;}
    function section(parent,title) {const element=node('section',undefined,'insight-section');element.append(node('h4',title));parent.append(element);return element;}
    function render(container,data) {
        container.replaceChildren();
        container.append(node('h3','Matchup insights'));
        const injury=section(container,'Key absences');
        injury.append(node('p',data.injuries.note,'insight-note'));
        if(data.injuries.updatedAt) injury.append(node('p',`Report updated ${new Date(data.injuries.updatedAt).toLocaleString()}`,'insight-note'));
        function playerRow(player) {
            const row=node('li');
            row.append(link(`${player.name} (${player.position || 'Position unavailable'})`,player.source));
            row.append(node('span',` — ${player.status}${player.reason ? ` · ${player.reason}` : ''} · ${player.role}`));
            if(player.comment) row.append(node('p',player.comment,'insight-note'));
            return row;
        }
        for(const team of data.injuries.teams) {
            injury.append(node('h5',team.name));
            if(!team.available) {injury.append(node('p','Injury report unavailable for this team.'));continue;}
            const key=team.players.filter(player=>player.key).slice(0,5);
            const list=node('ul');key.forEach(player=>list.append(playerRow(player)));injury.append(list);
            if(!key.length) injury.append(node('p',team.players.length ? 'No key absences could be confirmed from the available roles. See the full report below.' : 'No players listed in this report.'));
            injury.append(node('p',team.roleNote,'insight-note'));
            if(team.players.length) {
                const details=node('details');details.append(node('summary',`Full injury report (${team.players.length})`));
                const full=node('ul');team.players.forEach(player=>full.append(playerRow(player)));details.append(full);injury.append(details);
            }
        }
        const meetings=section(container,'Recent meetings');meetings.append(node('p',data.historyNote,'insight-note'));
        const history=node('ul');
        data.meetings.forEach(game=>{const li=node('li');li.append(link(`${game.awayTeam} ${game.awayScore} @ ${game.homeTeam} ${game.homeScore} · ${date(game.date)}`,game.source));history.append(li);});
        meetings.append(history);
        if(!data.meetings.length) meetings.append(node('p','No previous meetings found in the available seasons.'));
        const common=section(container,'Common opponents');
        common.append(node('p','Completed regular-season games from this year, before this matchup.','insight-note'));
        for(const comparison of data.commonOpponents) {
            common.append(node('h5',comparison.opponent));
            for(const [team,game] of [[data.recent[0].name,comparison.away],[data.recent[1].name,comparison.home]]) {
                const paragraph=node('p');paragraph.append(node('strong',team+': '),link(gameText(game),game.source));common.append(paragraph);
            }
        }
        if(!data.commonOpponents.length) common.append(node('p','No shared opponents found in the completed games available.'));
        const form=section(container,'Recent form');
        for(const team of data.recent) {
            form.append(node('h5',team.name));const list=node('ul');
            team.games.forEach(game=>{const li=node('li');li.append(link(gameText(game),game.source));list.append(li);});form.append(list);
            if(!team.games.length) form.append(node('p','No earlier completed regular-season games available.'));
        }
        data.warnings.forEach(warning=>container.append(node('p',warning,'insight-note')));
        container.append(node('p','Common-opponent results are context, not a prediction.','insight-note'));
    }
    async function load(container,gameId) {
        const request=++activeRequest;
        container.replaceChildren(node('p','Loading matchup insights…','loading'));
        if(!gameId) {container.replaceChildren(node('p','Select a matchup to see insights.'));return;}
        try {
            const response=await fetch(`/api/matchup-insights/${encodeURIComponent(gameId)}`);
            if(!response.ok) throw new Error('Unavailable');
            const data=await response.json();
            if(request===activeRequest) render(container,data);
        } catch {
            if(request===activeRequest) container.replaceChildren(node('p','Matchup insights are unavailable right now. The schedules are still available.','insight-note'));
        }
    }
    root.MatchupInsights={load,cancel(){activeRequest++;}};
})(globalThis);
