/* ================================================================
   GREENSTUMP — APP SCRIPT
   ================================================================
   PUT YOUR API KEYS HERE. This is the only place you need to edit
   to make live data (scores, rankings, news) start flowing.
   ================================================================ */
const CONFIG = {
  // Cricket live scores / scorecards — https://cricapi.com (free tier available)
  // Sign up, grab your key, and paste it below.
  CRIC_API_KEY: "d5eed837-a909-4317-b0c4-2687c10c7681",
  CRIC_API_BASE: "https://api.cricapi.com/v1",

  // Rankings — CricAPI does not provide ICC rankings on the free tier.
  // Point this at whichever rankings API/endpoint you have access to
  // (for example a RapidAPI "cricket rankings" endpoint). Leave the key
  // blank to show sample rankings instead, so the page still looks complete.
  RANKINGS_API_URL: "", // e.g. "https://<your-rankings-provider>/rankings"
  RANKINGS_API_KEY: "",

  // News — https://newsapi.org (free tier available) is a good default.
  // Paste your key below. Leave blank to show sample headlines instead.
  NEWS_API_KEY: "aeb54150c7a54a2ba0ea0e51d795dc89",
  NEWS_API_URL: "https://newsapi.org/v2/everything",

  // How often to auto-refresh live data, in milliseconds.
  REFRESH_INTERVAL_MS: 60000
};

/* ----------------------------------------------------------------
   Small helpers
   ---------------------------------------------------------------- */
function $(sel, ctx){ return (ctx||document).querySelector(sel); }
function $all(sel, ctx){ return Array.from((ctx||document).querySelectorAll(sel)); }
function escapeHtml(str){
  return String(str==null?"":str).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function showToast(msg, ms){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(function(){ t.classList.remove("show"); }, ms || 3200);
}
function keyMissing(key){
  return !key || key.indexOf("PUT_YOUR") === 0 || key.trim() === "";
}

/* ----------------------------------------------------------------
   Navigation: single-page section switching + mobile drawer
   ---------------------------------------------------------------- */
const sections = $all(".page-section");
function setActiveSection(id){
  sections.forEach(function(s){ s.classList.toggle("hidden", s.id !== id); });
  $all("[data-nav]").forEach(function(el){
    el.classList.toggle("active", el.getAttribute("data-nav") === id);
  });
  window.scrollTo({top:0, behavior:"instant" in window ? "instant" : "auto"});
}
function goTo(id){
  if(!$("#"+id)) return;
  history.replaceState(null, "", "#"+id);
  setActiveSection(id);
  closeDrawer();
}
$all("[data-nav]").forEach(function(el){
  el.addEventListener("click", function(e){
    e.preventDefault();
    goTo(el.getAttribute("data-nav"));
  });
});
window.addEventListener("load", function(){
  const id = (location.hash || "#home").slice(1);
  setActiveSection($("#"+id) ? id : "home");
});

const drawer = $("#mobileDrawer"), scrim = $("#scrim");
function openDrawer(){ drawer.classList.add("open"); scrim.classList.add("show"); $("#menuToggle").setAttribute("aria-expanded","true"); }
function closeDrawer(){ drawer.classList.remove("open"); scrim.classList.remove("show"); $("#menuToggle").setAttribute("aria-expanded","false"); }
$("#menuToggle").addEventListener("click", openDrawer);
$("#drawerClose").addEventListener("click", closeDrawer);
scrim.addEventListener("click", function(){ closeDrawer(); closeAllModals(); });
document.addEventListener("keydown", function(e){ if(e.key === "Escape"){ closeDrawer(); closeAllModals(); }});

/* ----------------------------------------------------------------
   Auth modal (front-end only demo)
   ---------------------------------------------------------------- */
const authModal = $("#authModal");
function openAuth(which){
  authModal.classList.add("show");
  scrim.classList.add("show");
  setAuthTab(which || "login");
}
function closeAllModals(){
  authModal.classList.remove("show");
  $("#scorecardModal").classList.remove("show");
  if(!drawer.classList.contains("open")) scrim.classList.remove("show");
}
function setAuthTab(which){
  $all(".auth-tab").forEach(function(t){ t.classList.toggle("active", t.dataset.authTab === which); });
  $all(".auth-panel").forEach(function(p){ p.classList.toggle("active", p.dataset.authPanel === which); });
}
$all("[data-auth-open]").forEach(function(btn){
  btn.addEventListener("click", function(){ openAuth(btn.getAttribute("data-auth-open")); });
});
$("#authModalClose").addEventListener("click", closeAllModals);
$all(".auth-tab").forEach(function(t){ t.addEventListener("click", function(){ setAuthTab(t.dataset.authTab); }); });
$("#loginPanel").addEventListener("submit", function(e){
  e.preventDefault();
  showToast("Logged in (demo) — connect a real auth backend to make this work.");
  closeAllModals();
});
$("#registerPanel").addEventListener("submit", function(e){
  e.preventDefault();
  showToast("Account created (demo) — connect a real auth backend to make this work.");
  closeAllModals();
});

/* contact form (front-end only demo) */
$("#contactForm").addEventListener("submit", function(e){
  e.preventDefault();
  $("#contactFormMsg").classList.add("show");
  this.reset();
});

$("#footYear").textContent = new Date().getFullYear();

/* ================================================================
   LIVE SCORES
   ================================================================ */
let allMatches = []; // cached, classified matches
let currentLiveTab = "live";

function classifyMatch(m){
  if(m.matchStarted === false) return "upcoming";
  if(m.matchEnded === true) return "finished";
  if(m.matchStarted === true && m.matchEnded === false) return "live";
  // fallback: try to infer from status text
  const s = (m.status || "").toLowerCase();
  if(s.includes("won") || s.includes("drawn") || s.includes("abandoned") || s.includes("no result")) return "finished";
  if(s.includes("scheduled") || s.includes("not started")) return "upcoming";
  return "live";
}

function scoreLine(m){
  // CricAPI-style: m.score = [{r,w,o,inning:"Team Name Inning 1"}, ...]
  if(!Array.isArray(m.score) || m.score.length === 0) return null;
  return m.score.map(function(inn){
    const overs = (inn.o !== undefined && inn.o !== null) ? " (" + inn.o + ")" : "";
    const wkts = (inn.w !== undefined && inn.w !== null) ? "/" + inn.w : "";
    return { label: inn.inning || "", text: (inn.r !== undefined ? inn.r : "-") + wkts + overs };
  });
}

async function fetchLiveMatches(){
  if(keyMissing(CONFIG.CRIC_API_KEY)){
    renderMatchState("Add your CricAPI key", "Paste your key into CONFIG.CRIC_API_KEY in the script to load real matches.");
    renderHeroState("Add your CricAPI key in script.js to load live matches.");
    return;
  }
  try{
    const url = CONFIG.CRIC_API_BASE + "/currentMatches?apikey=" + encodeURIComponent(CONFIG.CRIC_API_KEY) + "&offset=0";
    const res = await fetch(url);
    const json = await res.json();
    if(json.status && json.status !== "success"){
      throw new Error(json.message || "API returned an error");
    }
    allMatches = Array.isArray(json.data) ? json.data : [];
    renderHeroMatches();
    renderTicker();
    renderHomeMatchPreview();
    renderLiveGrid(currentLiveTab);
  }catch(err){
    console.error("fetchLiveMatches failed:", err);
    renderMatchState("Couldn't load matches", "Check your API key and network connection, then refresh.");
    renderHeroState("Couldn't load live matches right now.");
  }
}

function renderMatchState(title, sub){
  const html = '<div class="state-msg"><strong>' + escapeHtml(title) + '</strong>' + escapeHtml(sub) + '</div>';
  $("#liveMatchGrid").innerHTML = html;
  $("#homeMatchPreview").innerHTML = html;
}
function renderHeroState(msg){
  $("#heroMatches").innerHTML = '<p class="hero-status">' + escapeHtml(msg) + '</p>';
}

function renderHeroMatches(){
  const live = allMatches.filter(function(m){ return classifyMatch(m) === "live"; }).slice(0,3);
  const list = live.length ? live : allMatches.slice(0,3);
  if(!list.length){ renderHeroState("No matches available right now."); return; }
  $("#heroMatches").innerHTML = list.map(function(m){
    const lines = scoreLine(m) || [];
    const teamText = (m.teams || []).join(" vs ");
    const scoreText = lines.length ? lines.map(function(l){ return l.text; }).join("  ·  ") : "";
    return '<div class="hero-match">' +
      '<div class="hero-teams"><span>' + escapeHtml(teamText) + '</span>' + (scoreText ? '<span class="score tnum">' + escapeHtml(scoreText) + '</span>' : '') + '</div>' +
      '<div class="hero-status">' + escapeHtml(m.status || "") + '</div>' +
    '</div>';
  }).join("");
}

function renderTicker(){
  if(!allMatches.length) return;
  const items = allMatches.slice(0,10).map(function(m){
    const teamText = (m.teams || []).join(" vs ");
    return '<div class="ticker-item"><span class="ticker-dot"></span><b>' + escapeHtml(teamText) + '</b>&nbsp;— ' + escapeHtml(m.status || "") + '</div>';
  }).join("");
  // duplicate content once for a seamless CSS loop
  $("#tickerTrack").innerHTML = items + items;
}

function matchCardHtml(m, idx){
  const status = classifyMatch(m);
  const chipClass = status === "live" ? "live" : (status === "finished" ? "finished" : "upcoming");
  const chipLabel = status === "live" ? "Live" : (status === "finished" ? "Finished" : "Upcoming");
  const lines = scoreLine(m) || [];
  const teams = m.teams || [];
  const teamRows = teams.map(function(t, i){
    const line = lines[i];
    return '<div class="team-row"><span class="team-name">' + escapeHtml(t) + '</span>' + (line ? '<span class="team-score tnum">' + escapeHtml(line.text) + '</span>' : '') + '</div>';
  }).join("");

  return '<button class="match-card" data-match-id="' + escapeHtml(m.id || idx) + '">' +
    '<div class="match-card-top"><span class="match-series">' + escapeHtml(m.name || m.matchType || "Match") + '</span>' +
      '<span class="status-chip ' + chipClass + '">' + (status === "live" ? '<span class="pulse-dot"></span>' : '') + chipLabel + '</span></div>' +
    '<div class="match-teams">' + (teamRows || '<div class="team-row"><span class="team-name">Teams TBC</span></div>') + '</div>' +
    '<div class="match-status-line">' + escapeHtml(m.status || "") + '</div>' +
    '<div class="venue-line">' + escapeHtml(m.venue || "") + '</div>' +
  '</button>';
}

function renderLiveGrid(tab){
  currentLiveTab = tab;
  const statusMap = { live: "live", recent: "finished", upcoming: "upcoming" };
  const wanted = statusMap[tab] || "live";
  const filtered = allMatches.filter(function(m){ return classifyMatch(m) === wanted; });
  const grid = $("#liveMatchGrid");
  if(!filtered.length){
    grid.innerHTML = '<div class="state-msg"><strong>No ' + tab + ' matches</strong>Nothing to show in this tab right now — try another tab or check back soon.</div>';
    return;
  }
  grid.innerHTML = filtered.map(function(m,i){ return matchCardHtml(m,i); }).join("");
  bindMatchCardClicks(grid);
}

function renderHomeMatchPreview(){
  const preview = allMatches.slice(0,6);
  const grid = $("#homeMatchPreview");
  if(!preview.length){ grid.innerHTML = '<div class="state-msg"><strong>No matches yet</strong>Check back shortly.</div>'; return; }
  grid.innerHTML = preview.map(function(m,i){ return matchCardHtml(m,i); }).join("");
  bindMatchCardClicks(grid);
}

function bindMatchCardClicks(container){
  $all(".match-card", container).forEach(function(card){
    card.addEventListener("click", function(){ openScorecard(card.getAttribute("data-match-id")); });
  });
}

$all("#liveTabs .tab-pill").forEach(function(btn){
  btn.addEventListener("click", function(){
    $all("#liveTabs .tab-pill").forEach(function(b){ b.classList.remove("active"); });
    btn.classList.add("active");
    renderLiveGrid(btn.getAttribute("data-status"));
  });
});

/* ----------------------------------------------------------------
   Scorecard modal — batting, bowling, partnership, who's on strike
   ---------------------------------------------------------------- */
const scorecardModal = $("#scorecardModal");
$("#scModalClose").addEventListener("click", closeAllModals);

async function openScorecard(matchId){
  const match = allMatches.find(function(m){ return String(m.id) === String(matchId); });
  scorecardModal.classList.add("show");
  scrim.classList.add("show");
  $("#scModalTitle").textContent = match ? (match.teams || []).join(" vs ") : "Match";
  $("#scModalSeries").textContent = match ? (match.name || "") : "";
  $("#scModalBody").innerHTML = '<p style="color:var(--cream-dim);">Loading full scorecard…</p>';

  if(keyMissing(CONFIG.CRIC_API_KEY)){
    $("#scModalBody").innerHTML = '<div class="state-msg"><strong>Add your CricAPI key</strong>Paste it into CONFIG.CRIC_API_KEY to load full scorecards.</div>';
    return;
  }

  try{
    const url = CONFIG.CRIC_API_BASE + "/match_scorecard?apikey=" + encodeURIComponent(CONFIG.CRIC_API_KEY) + "&id=" + encodeURIComponent(matchId);
    const res = await fetch(url);
    const json = await res.json();
    if(json.status && json.status !== "success") throw new Error(json.message || "API returned an error");
    renderScorecard(json.data, match);
  }catch(err){
    console.error("openScorecard failed:", err);
    $("#scModalBody").innerHTML = '<div class="state-msg"><strong>Couldn\'t load the scorecard</strong>The match provider may use slightly different field names — check the browser console and adjust renderScorecard() in script.js if needed.</div>';
  }
}

function renderScorecard(data, match){
  if(!data){ $("#scModalBody").innerHTML = '<p style="color:var(--cream-dim);">No scorecard available for this match yet.</p>'; return; }

  const summaryScore = (scoreLine(data) || (match ? scoreLine(match) : null) || [])
    .map(function(l){ return l.text; }).join("  ·  ");

  let html = '<div class="summary-band">' +
    '<div><div class="summary-score tnum">' + escapeHtml(summaryScore || "—") + '</div></div>' +
    '<div class="summary-status">' + escapeHtml(data.status || (match ? match.status : "") || "") + '</div>' +
  '</div>';

  const innings = Array.isArray(data.scorecard) ? data.scorecard : [];
  if(!innings.length){
    html += '<p style="color:var(--cream-dim);">Ball-by-ball scorecard isn\'t available for this match yet — it may not have started.</p>';
    $("#scModalBody").innerHTML = html;
    return;
  }

  html += '<div class="inning-tabs">' + innings.map(function(inn, i){
    return '<button class="inning-tab' + (i===0?' active':'') + '" data-inn="' + i + '">' + escapeHtml(inn.inning || ("Innings " + (i+1))) + '</button>';
  }).join("") + '</div>';

  html += '<div id="inningPanels">' + innings.map(function(inn, i){ return inningPanelHtml(inn, i); }).join("") + '</div>';

  $("#scModalBody").innerHTML = html;

  $all("#scModalBody .inning-tab").forEach(function(tab){
    tab.addEventListener("click", function(){
      $all("#scModalBody .inning-tab").forEach(function(t){ t.classList.remove("active"); });
      tab.classList.add("active");
      $all("#scModalBody .inning-panel").forEach(function(p){ p.classList.toggle("hidden", p.dataset.inn !== tab.dataset.inn); });
    });
  });
}

function inningPanelHtml(inn, idx){
  const batting = Array.isArray(inn.batting) ? inn.batting : (Array.isArray(inn.batsman) ? inn.batsman : []);
  const bowling = Array.isArray(inn.bowling) ? inn.bowling : (Array.isArray(inn.bowler) ? inn.bowler : []);

  // Not-out batsmen are the current pair at the crease during a live innings.
  const notOut = batting.filter(function(b){
    const dText = (b["dismissal-text"] || b.dismissal || "").toLowerCase();
    return dText === "" || dText === "not out" || dText === "batting";
  });
  // Heuristic for who's on strike: prefer an explicit flag if the provider sends one,
  // otherwise assume the not-out batsman with the most balls faced is on strike.
  let strikerId = null;
  const flagged = notOut.find(function(b){ return b.onStrike === true || b.isStriker === true; });
  if(flagged){
    strikerId = flagged.batsman ? flagged.batsman.id : flagged.id;
  } else if(notOut.length){
    const sorted = notOut.slice().sort(function(a,b){ return (Number(b.b)||0) - (Number(a.b)||0); });
    const top = sorted[0];
    strikerId = top.batsman ? top.batsman.id : top.id;
  }

  const battingRows = batting.map(function(b){
    const name = b.batsman ? b.batsman.name : (b.name || "—");
    const bId = b.batsman ? b.batsman.id : b.id;
    const isStriker = strikerId !== null && bId === strikerId;
    const dismissal = b["dismissal-text"] || b.dismissal || (notOut.indexOf(b) > -1 ? "not out" : "");
    return '<tr><td><span class="player-name">' + escapeHtml(name) + (isStriker ? ' <span class="striker-flag">●</span>' : '') + '<span class="dismissal-text">' + escapeHtml(dismissal) + '</span></span></td>' +
      '<td class="tnum">' + escapeHtml(b.r != null ? b.r : "-") + '</td>' +
      '<td class="tnum">' + escapeHtml(b.b != null ? b.b : "-") + '</td>' +
      '<td class="tnum">' + escapeHtml(b["4s"] != null ? b["4s"] : "-") + '</td>' +
      '<td class="tnum">' + escapeHtml(b["6s"] != null ? b["6s"] : "-") + '</td>' +
      '<td class="tnum">' + escapeHtml(b.sr != null ? b.sr : "-") + '</td></tr>';
  }).join("");

  const bowlingRows = bowling.map(function(b){
    const name = b.bowler ? b.bowler.name : (b.name || "—");
    return '<tr><td>' + escapeHtml(name) + '</td>' +
      '<td class="tnum">' + escapeHtml(b.o != null ? b.o : "-") + '</td>' +
      '<td class="tnum">' + escapeHtml(b.m != null ? b.m : "-") + '</td>' +
      '<td class="tnum">' + escapeHtml(b.r != null ? b.r : "-") + '</td>' +
      '<td class="tnum">' + escapeHtml(b.w != null ? b.w : "-") + '</td>' +
      '<td class="tnum">' + escapeHtml(b.eco != null ? b.eco : "-") + '</td></tr>';
  }).join("");

  // Simple current-partnership estimate from the not-out pair, when the innings is live.
  let partnershipHtml = "";
  if(notOut.length >= 2){
    const runs = notOut.reduce(function(sum,b){ return sum + (Number(b.r)||0); }, 0);
    const balls = notOut.reduce(function(sum,b){ return sum + (Number(b.b)||0); }, 0);
    const names = notOut.map(function(b){ return b.batsman ? b.batsman.name : b.name; }).join(" &amp; ");
    partnershipHtml = '<div class="partnership-box"><div><div class="label">Current partnership</div><div class="value">' + names + '</div></div>' +
      '<div class="value tnum">' + runs + ' runs (' + balls + ' balls)</div></div>';
  }

  return '<div class="inning-panel' + (idx===0?'':' hidden') + '" data-inn="' + idx + '">' +
    partnershipHtml +
    '<table class="score-table"><caption>Batting</caption><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>' +
    '<tbody>' + (battingRows || '<tr><td colspan="6" style="text-align:center;color:var(--cream-faint);">No batting data yet</td></tr>') + '</tbody></table>' +
    '<table class="score-table"><caption>Bowling</caption><thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr></thead>' +
    '<tbody>' + (bowlingRows || '<tr><td colspan="6" style="text-align:center;color:var(--cream-faint);">No bowling data yet</td></tr>') + '</tbody></table>' +
  '</div>';
}

/* ================================================================
   RANKINGS
   ================================================================ */
let rankState = { format: "test", category: "teams" };

// Sample fallback data, shown automatically until you connect a rankings API.
const SAMPLE_RANKINGS = {
  teams: [
    {name:"Australia", sub:"Men's Test", rating:128},
    {name:"India", sub:"Men's Test", rating:124},
    {name:"South Africa", sub:"Men's Test", rating:113},
    {name:"England", sub:"Men's Test", rating:107},
    {name:"New Zealand", sub:"Men's Test", rating:102},
    {name:"Pakistan", sub:"Men's Test", rating:97},
    {name:"Sri Lanka", sub:"Men's Test", rating:88},
    {name:"Bangladesh", sub:"Men's Test", rating:76}
  ],
  batting: [
    {name:"J. Root", sub:"England", rating:892},
    {name:"K. Williamson", sub:"New Zealand", rating:878},
    {name:"S. Gill", sub:"India", rating:861},
    {name:"H. Head", sub:"Australia", rating:847},
    {name:"B. Mitchell", sub:"South Africa", rating:820},
    {name:"R. Ravindra", sub:"New Zealand", rating:803}
  ],
  bowling: [
    {name:"J. Bumrah", sub:"India", rating:901},
    {name:"P. Cummins", sub:"Australia", rating:867},
    {name:"K. Jamieson", sub:"New Zealand", rating:822},
    {name:"K. Rabada", sub:"South Africa", rating:809},
    {name:"N. Lyon", sub:"Australia", rating:788},
    {name:"S. Bahadur", sub:"Sri Lanka", rating:754}
  ],
  allrounder: [
    {name:"J. Bracewell", sub:"New Zealand", rating:412},
    {name:"R. Jadeja", sub:"India", rating:398},
    {name:"M. Labuschagne", sub:"Australia", rating:355},
    {name:"C. Green", sub:"Australia", rating:341},
    {name:"M. Ali", sub:"England", rating:301}
  ]
};

async function fetchRankings(){
  const tbody = $("#rankTableBody");
  tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--cream-faint);padding:32px;">Loading rankings…</td></tr>';

  if(keyMissing(CONFIG.RANKINGS_API_KEY) || !CONFIG.RANKINGS_API_URL){
    renderRankingRows(SAMPLE_RANKINGS[rankState.category] || []);
    $("#rankSourceNote").textContent = "Showing sample rankings — set CONFIG.RANKINGS_API_URL and CONFIG.RANKINGS_API_KEY in script.js to load live data.";
    return;
  }

  try{
    const url = CONFIG.RANKINGS_API_URL + "?apikey=" + encodeURIComponent(CONFIG.RANKINGS_API_KEY) +
      "&format=" + encodeURIComponent(rankState.format) + "&category=" + encodeURIComponent(rankState.category);
    const res = await fetch(url);
    const json = await res.json();
    // Adjust this mapping to match your rankings provider's actual response shape.
    const rows = (json.data || json.rankings || []).map(function(r){
      return { name: r.name || r.team || r.player, sub: r.country || r.format || "", rating: r.rating || r.points };
    });
    if(!rows.length) throw new Error("Empty rankings response");
    renderRankingRows(rows);
    $("#rankSourceNote").textContent = "";
  }catch(err){
    console.error("fetchRankings failed:", err);
    renderRankingRows(SAMPLE_RANKINGS[rankState.category] || []);
    $("#rankSourceNote").textContent = "Live rankings couldn't be loaded — showing sample data instead.";
  }
}

function renderRankingRows(rows){
  const tbody = $("#rankTableBody");
  if(!rows.length){
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--cream-faint);padding:32px;">No rankings to show.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(function(r, i){
    const pos = i + 1;
    return '<tr><td class="rank-pos' + (pos<=3 ? ' top3':'') + '">' + pos + '</td>' +
      '<td><div class="rank-name">' + escapeHtml(r.name) + '</div>' + (r.sub ? '<div class="rank-sub">' + escapeHtml(r.sub) + '</div>' : '') + '</td>' +
      '<td class="rank-rating tnum">' + escapeHtml(r.rating) + '</td></tr>';
  }).join("");
}

$all("#rankFormatTabs .tab-pill").forEach(function(btn){
  btn.addEventListener("click", function(){
    $all("#rankFormatTabs .tab-pill").forEach(function(b){ b.classList.remove("active"); });
    btn.classList.add("active");
    rankState.format = btn.getAttribute("data-format");
    fetchRankings();
  });
});
$all("#rankCategoryTabs .tab-pill").forEach(function(btn){
  btn.addEventListener("click", function(){
    $all("#rankCategoryTabs .tab-pill").forEach(function(b){ b.classList.remove("active"); });
    btn.classList.add("active");
    rankState.category = btn.getAttribute("data-category");
    fetchRankings();
  });
});

/* ================================================================
   NEWS
   ================================================================ */
const SAMPLE_NEWS = [
  {title:"Series decider set for a full house as both sides chase the trophy", source:"GreenStump Desk", excerpt:"With the series tied at 1-1, the final match promises a full house and a straight shootout for the trophy.", url:"#"},
  {title:"Uncapped seamer added to the squad ahead of the away tour", source:"GreenStump Desk", excerpt:"Selectors have turned to a uncapped, pace bowler as cover for the upcoming tour, citing recent domestic form.", url:"#"},
  {title:"Board confirms venues for next year's home season", source:"GreenStump Desk", excerpt:"Five host cities have been confirmed for the upcoming home season, with tickets expected to go on sale shortly.", url:"#"},
  {title:"Rain washes out day three, leaving the Test finely poised", source:"GreenStump Desk", excerpt:"Persistent rain wiped out the entire third day's play, leaving both sides needing quick runs when the skies clear.", url:"#"}
];

async function fetchNews(){
  const grids = [$("#newsGrid"), $("#homeNewsPreview")];
  if(keyMissing(CONFIG.NEWS_API_KEY)){
    renderNews(SAMPLE_NEWS);
    return;
  }
  try{
    const url = CONFIG.NEWS_API_URL + "?q=cricket&sortBy=publishedAt&language=en&pageSize=12&apiKey=" + encodeURIComponent(CONFIG.NEWS_API_KEY);
    const res = await fetch(url);
    const json = await res.json();
    if(json.status && json.status !== "ok") throw new Error(json.message || "API returned an error");
    const articles = (json.articles || []).map(function(a){
      return { title: a.title, source: (a.source && a.source.name) || "News", excerpt: a.description || "", url: a.url, image: a.urlToImage };
    });
    if(!articles.length) throw new Error("No articles returned");
    renderNews(articles);
  }catch(err){
    console.error("fetchNews failed:", err);
    renderNews(SAMPLE_NEWS);
  }
}

function renderNews(articles){
  const full = articles.map(newsCardHtml).join("");
  const preview = articles.slice(0,3).map(newsCardHtml).join("");
  $("#newsGrid").innerHTML = full || '<div class="state-msg"><strong>No headlines yet</strong>Check back soon.</div>';
  $("#homeNewsPreview").innerHTML = preview || '<div class="state-msg"><strong>No headlines yet</strong>Check back soon.</div>';
}

function newsCardHtml(a){
  const img = a.image ? '<img class="news-thumb" src="' + escapeHtml(a.image) + '" alt="" loading="lazy">' : '<div class="news-thumb"></div>';
  return '<article class="news-card">' + img +
    '<div class="news-body">' +
      '<div class="news-meta">' + escapeHtml(a.source || "News") + '</div>' +
      '<h3 class="news-title">' + escapeHtml(a.title || "") + '</h3>' +
      '<p class="news-excerpt">' + escapeHtml(a.excerpt || "") + '</p>' +
      '<a class="news-link" href="' + escapeHtml(a.url || "#") + '" target="_blank" rel="noopener">Read more</a>' +
    '</div>' +
  '</article>';
}

/* ================================================================
   BOOT
   ================================================================ */
fetchLiveMatches();
fetchRankings();
fetchNews();
setInterval(fetchLiveMatches, CONFIG.REFRESH_INTERVAL_MS);