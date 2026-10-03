// Render source facts as text, using the same team logos as the schedule.
(function(root) {
    let activeRequest=0;
    function node(tag,text,className) {
        const element=document.createElement(tag);
        if(text!==undefined) element.textContent=text;
        if(className) element.className=className;
        return element;
    }
    function link(text,href,className) {
        const element=node('a',text,className);
        if(/^https:\/\/www\.espn\.com\//.test(href||'')) {
            element.href=href;element.target='_blank';element.rel='noopener noreferrer';
        }
        return element;
    }
    function date(value) {return value ? new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';}
    function meta(game) {return `${date(game.date)}${game.week ? ` · Week ${game.week}` : ''}`;}
    function section(parent,title,note) {
        const element=node('section',undefined,'insight-section');element.append(node('h4',title));
        if(note) element.append(node('p',note,'insight-note'));
        parent.append(element);return element;
    }
    function empty(parent,text) {parent.append(node('p',text,'insight-empty'));}
    function teamLabel(data,name,compact=false) {
        const team=data.teams?.[name] || {name,abbr:name};
        const label=node('span',undefined,'insight-team');label.title=name;
        const logo=node('span',undefined,'insight-team-logo');
        const fallback=node('span',team.abbr===name ? name.split(' ').map(word=>word[0]).join('').slice(0,3) : team.abbr,'insight-logo-fallback');
        logo.append(fallback);
        if(/^https:\/\/a\.espncdn\.com\//.test(team.logo || '')) {
            const img=node('img');img.alt='';img.src=team.logo;img.loading='lazy';
            fallback.hidden=true;
            img.addEventListener('error',()=>{img.remove();fallback.hidden=false;},{once:true});logo.append(img);
        }
        label.append(logo,node('span',compact ? team.abbr : name,'insight-team-name'));
        return label;
    }
    function resultBadge(result) {
        return node('span',result,`insight-result insight-result-${result.toLowerCase()}`);
    }
    function scoreRow(data,team,game) {
        const row=link(undefined,game.source,'insight-score-row');
        row.setAttribute('aria-label',`${team}: ${game.result}, ${game.score} to ${game.opponentScore}, ${game.home?'vs':'at'} ${game.opponent}, ${meta(game)}`);
        row.append(resultBadge(game.result),node('span',`${game.score}–${game.opponentScore}`,'insight-score'));
        const opponent=node('span',undefined,'insight-opponent');
        opponent.append(node('span',game.home?'vs':'@','insight-location'),teamLabel(data,game.opponent,true));
        row.append(opponent,node('span',meta(game),'insight-game-meta'));
        return row;
    }
    function render(container,data) {
        container.replaceChildren();
        const heading=node('div',undefined,'insight-heading');
        heading.append(node('h3','Matchup insights'),node('span','ESPN · Regular-season results','insight-kicker'));container.append(heading);
        const injury=section(container,'Key absences',data.injuries.note);
        if(data.injuries.updatedAt) injury.append(node('p',`Report updated ${new Date(data.injuries.updatedAt).toLocaleString()}`,'insight-note'));
        function playerRow(player) {
            const row=node('li',undefined,'insight-player');
            const line=node('div',undefined,'insight-player-line');
            line.append(link(player.name,player.source,'insight-player-name'),node('span',player.position || '','insight-position'));
            const status=player.status.toLowerCase();
            const tone=status==='out' || status==='injured reserve' ? 'out' : status==='questionable' || status==='doubtful' ? 'uncertain' : 'other';
            line.append(node('span',player.status,`insight-status insight-status-${tone}`));row.append(line);
            row.append(node('p',[player.reason,player.role].filter(Boolean).join(' · '),'insight-player-role'));
            if(player.comment) row.append(node('p',player.comment,'insight-player-comment'));
            return row;
        }
        const injuryGrid=node('div',undefined,'insight-team-grid');injury.append(injuryGrid);
        for(const team of data.injuries.teams) {
            const card=node('article',undefined,'insight-team-card');injuryGrid.append(card);
            const title=node('h5');title.append(teamLabel(data,team.name));card.append(title);
            if(!team.available) {empty(card,'Injury report unavailable for this team.');continue;}
            const key=team.players.filter(player=>player.key).slice(0,5);
            const list=node('ul',undefined,'insight-player-list');key.forEach(player=>list.append(playerRow(player)));card.append(list);
            if(!key.length) empty(card,team.players.length ? 'No key absences confirmed. Check the full report for players with unconfirmed roles.' : 'No players listed in this report.');
            if(team.players.length) {
                const details=node('details',undefined,'insight-full-report');details.append(node('summary',`Full injury report (${team.players.length})`));
                const full=node('ul',undefined,'insight-player-list');team.players.forEach(player=>full.append(playerRow(player)));details.append(full);card.append(details);
            }
            card.append(node('p',team.roleNote,'insight-note'));
        }
        if(data.watch?.teams.length) {
            const watch=section(container,'Players to watch',data.watch.note);
            const grid=node('div',undefined,'insight-team-grid');watch.append(grid);
            for(const team of data.watch.teams) {
                const card=node('article',undefined,'insight-team-card');grid.append(card);
                const title=node('h5');title.append(teamLabel(data,team.name));card.append(title);
                if(team.updatedAt) card.append(node('p',`Stats updated ${new Date(team.updatedAt).toLocaleString()}`,'insight-note'));
                for(const player of team.players) {
                    const row=node('div',undefined,'insight-watch-player');
                    if(/^https:\/\/a\.espncdn\.com\//.test(player.headshot || '')) {
                        const photo=node('img');photo.alt='';photo.src=player.headshot;photo.loading='lazy';photo.className='insight-player-photo';
                        photo.addEventListener('error',()=>photo.remove(),{once:true});row.append(photo);
                    }
                    const body=node('div',undefined,'insight-watch-body');
                    const name=node('div',undefined,'insight-player-line');name.append(link(player.name,player.source,'insight-player-name'),node('span',player.position,'insight-position'));
                    if(player.status) name.append(node('span',player.status,'insight-status insight-status-uncertain'));
                    body.append(name,node('p',player.label,'insight-player-role'));
                    for(const stat of player.metrics) body.append(node('p',`${stat.display}${stat.label===player.label ? '' : ' · '+stat.label}`,'insight-watch-stat'));
                    row.append(body);card.append(row);
                }
                if(!team.players.length) empty(card,'Player highlights are unavailable in the saved team data.');
            }
        }
        const meetings=section(container,'Recent meetings',data.historyNote);
        const history=node('div',undefined,'insight-meetings');meetings.append(history);
        data.meetings.forEach(game=>{
            const card=link(undefined,game.source,'insight-meeting');
            card.setAttribute('aria-label',`${game.awayTeam} ${game.awayScore}, ${game.homeTeam} ${game.homeScore}, ${date(game.date)}`);
            const away=node('span',undefined,'insight-meeting-team');away.append(teamLabel(data,game.awayTeam),node('strong',String(game.awayScore),game.awayScore>game.homeScore?'insight-winning-score':''));
            const home=node('span',undefined,'insight-meeting-team');home.append(teamLabel(data,game.homeTeam),node('strong',String(game.homeScore),game.homeScore>game.awayScore?'insight-winning-score':''));
            card.append(node('span',date(game.date),'insight-meeting-date'),away,node('span','@','insight-meeting-at'),home);history.append(card);
        });
        if(!data.meetings.length) empty(meetings,'No previous meetings found in the available seasons.');
        const common=section(container,'Common opponents','This year’s completed regular-season games, before this matchup.');
        for(const comparison of data.commonOpponents) {
            const card=node('article',undefined,'insight-common-card');common.append(card);
            const opponent=node('h5');opponent.append(teamLabel(data,comparison.opponent),node('span','Shared opponent','insight-kicker'));card.append(opponent);
            const grid=node('div',undefined,'insight-team-grid');card.append(grid);
            for(const [team,game] of [[data.recent[0].name,comparison.away],[data.recent[1].name,comparison.home]]) {
                const column=node('div',undefined,'insight-comparison');column.append(teamLabel(data,team),scoreRow(data,team,game));grid.append(column);
            }
        }
        if(!data.commonOpponents.length) empty(common,'No shared opponents found in the completed games available.');
        const form=section(container,'Recent form','Last three completed regular-season games, before this matchup.');
        const formGrid=node('div',undefined,'insight-team-grid');form.append(formGrid);
        for(const team of data.recent) {
            const card=node('article',undefined,'insight-team-card');formGrid.append(card);
            const title=node('h5');title.append(teamLabel(data,team.name));
            const record=node('span',undefined,'insight-form-record');team.games.forEach(game=>record.append(resultBadge(game.result)));title.append(record);card.append(title);
            team.games.forEach(game=>card.append(scoreRow(data,team.name,game)));
            if(!team.games.length) empty(card,'No earlier completed regular-season games available.');
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
