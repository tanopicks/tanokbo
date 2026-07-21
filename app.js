// --- KBO Analytics & Prediction Logic ---

let currentGames = [];
let selectedGame = null;
let syncTimer = null;
let updateCountdown = 120; // 2 minutes in seconds
let countdownTimer = null;

// Initialize app on load
window.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  setupEventListeners();
  startLoadingData();
  
  // Start the countdown timer for updates
  startCountdown();
}

// Event handlers setup
function setupEventListeners() {
  document.getElementById('btn-manual-sync').addEventListener('click', () => {
    rotateSyncIcon();
    loadData();
  });

  document.getElementById('btn-load-demo').addEventListener('click', loadDemoGame);
  document.getElementById('btn-open-manual').addEventListener('click', openManualModal);
  document.getElementById('btn-open-manual-2').addEventListener('click', openManualModal);
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  
  // Modal tabs
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      
      e.target.classList.add('active');
      document.getElementById(e.target.dataset.tab).classList.add('active');
    });
  });

  // Save manual inputs
  document.getElementById('btn-save-manual').addEventListener('click', saveManualData);
  
  // Parse pasted text
  document.getElementById('btn-parse-paste').addEventListener('click', parsePastedText);
  
  // Edit active button
  document.getElementById('btn-edit-active').addEventListener('click', toggleTableEditable);
}

// Start loading KBO data
function startLoadingData() {
  loadData();
  // Poll every 2 minutes
  syncTimer = setInterval(loadData, 120000);
}

// Countdown timer display
function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  updateCountdown = 120;
  
  countdownTimer = setInterval(() => {
    updateCountdown--;
    if (updateCountdown <= 0) {
      updateCountdown = 120;
    }
    document.getElementById('next-update').innerText = `${updateCountdown}s`;
  }, 1000);
}

// Rotate Sync icon during reload
function rotateSyncIcon() {
  const icon = document.querySelector('.icon-sync');
  icon.classList.add('spinning');
  setTimeout(() => icon.classList.remove('spinning'), 1000);
}

// Load KBO data from local files (data.js / data.json)
function loadData() {
  console.log('Loading KBO data...');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');

  // We load via dynamic script injection to bypass CORS on local file:/// paths
  const oldScript = document.getElementById('kbo-data-script');
  if (oldScript) oldScript.remove();

  const script = document.createElement('script');
  script.id = 'kbo-data-script';
  // Use timestamp to avoid caching
  script.src = `data.js?t=${Date.now()}`;
  
  script.onload = () => {
    if (window.kboData) {
      console.log('Data loaded successfully from data.js');
      statusDot.className = 'status-indicator online';
      statusText.innerText = 'Scraper conectado';
      
      const lastUpdateDate = new Date(window.kboData.lastUpdated);
      document.getElementById('last-updated').innerText = lastUpdateDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      currentGames = window.kboData.games || [];
      renderGamesList();
      
      // Auto-select first game if none selected
      if (currentGames.length > 0 && !selectedGame) {
        selectGame(currentGames[0]);
      }
      
      startCountdown();
    }
  };

  script.onerror = () => {
    // If script fails (e.g. data.js doesn't exist yet because scraper hasn't run),
    // try standard fetch as a fallback for JSON
    fetch('data.json')
      .then(response => response.json())
      .then(data => {
        console.log('Data loaded successfully from data.json');
        statusDot.className = 'status-indicator online';
        statusText.innerText = 'Scraper conectado (JSON)';
        document.getElementById('last-updated').innerText = new Date(data.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        currentGames = data.games || [];
        renderGamesList();
        
        if (currentGames.length > 0 && !selectedGame) {
          selectGame(currentGames[0]);
        }
        
        startCountdown();
      })
      .catch(err => {
        console.log('Scraper data not found. Waiting for scraper to start.');
        statusDot.className = 'status-indicator';
        statusText.innerText = 'Scraper inactivo (Usa datos manuales)';
      });
  };

  document.head.appendChild(script);
}

// Render games list in the sidebar
function renderGamesList() {
  const listContainer = document.getElementById('games-list');
  const countBadge = document.getElementById('games-count');
  
  listContainer.innerHTML = '';
  countBadge.innerText = currentGames.length;

  if (currentGames.length === 0) {
    listContainer.innerHTML = `
      <div class="loading-placeholder">
        <p>No hay partidos cargados.</p>
      </div>
    `;
    return;
  }

  currentGames.forEach(game => {
    const card = document.createElement('div');
    card.className = 'game-card-item';
    if (selectedGame && selectedGame.id === game.id) {
      card.classList.add('active');
    }

    const stateLabel = game.isTomorrow ? 'Mañana' : (game.status || 'Programado');
    const isLive = game.status && (game.status.includes('Live') || game.status.includes('Progress'));

    card.innerHTML = `
      <div class="game-card-header">
        <span>${game.time || '6:30 PM'}</span>
        <span class="badge" style="background:${isLive ? 'var(--color-danger)' : 'rgba(255,255,255,0.1)'}">${stateLabel}</span>
      </div>
      <div class="game-card-teams">
        <div class="game-card-team">
          <span class="game-team-name-logo">
            <span class="team-bullet" style="color:var(--color-away)">●</span>
            ${game.teamAway.name.split(' ')[0]}
          </span>
          <span>${game.teamAway.pitcher.name.split(' ').pop()}</span>
        </div>
        <div class="game-card-team">
          <span class="game-team-name-logo">
            <span class="team-bullet" style="color:var(--color-home)">●</span>
            ${game.teamHome.name.split(' ')[0]}
          </span>
          <span>${game.teamHome.pitcher.name.split(' ').pop()}</span>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      // Remove active classes
      document.querySelectorAll('.game-card-item').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectGame(game);
    });

    listContainer.appendChild(card);
  });
}

// Select and load a game
function selectGame(game) {
  selectedGame = game;
  
  // Show dashboard, hide placeholder
  document.getElementById('game-dashboard').style.display = 'block';
  document.getElementById('no-game-placeholder').style.display = 'none';

  // Load banner data
  document.getElementById('lbl-away-abbr').innerText = game.teamAway.name.substring(0, 3).toUpperCase();
  document.getElementById('lbl-away-name').innerText = game.teamAway.name;
  document.getElementById('lbl-home-abbr').innerText = game.teamHome.name.substring(0, 3).toUpperCase();
  document.getElementById('lbl-home-name').innerText = game.teamHome.name;
  
  // Roster details records
  document.getElementById('lbl-away-record').innerText = `ERA: ${game.teamAway.pitching.era} | BA: ${game.teamAway.batting.avg}`;
  document.getElementById('lbl-home-record').innerText = `ERA: ${game.teamHome.pitching.era} | BA: ${game.teamHome.batting.avg}`;

  // Pitchers
  document.getElementById('p-away-name').innerText = game.teamAway.pitcher.name;
  document.getElementById('p-away-year').innerText = game.teamAway.pitcher.yearUsed || '2026';
  document.getElementById('p-home-name').innerText = game.teamHome.pitcher.name;
  document.getElementById('p-home-year').innerText = game.teamHome.pitcher.yearUsed || '2026';

  updateDashboardUI();
}

// Update dashboard tables and prediction values
function updateDashboardUI() {
  if (!selectedGame) return;

  const away = selectedGame.teamAway;
  const home = selectedGame.teamHome;

  // Set Pitcher stats
  document.getElementById('p-away-era').innerText = away.pitcher.era;
  document.getElementById('p-home-era').innerText = home.pitcher.era;
  document.getElementById('p-away-whip').innerText = away.pitcher.whip;
  document.getElementById('p-home-whip').innerText = home.pitcher.whip;
  document.getElementById('p-away-fip').innerText = away.pitcher.fip;
  document.getElementById('p-home-fip').innerText = home.pitcher.fip;
  document.getElementById('p-away-ip').innerText = away.pitcher.ip;
  document.getElementById('p-home-ip').innerText = home.pitcher.ip;
  document.getElementById('p-away-so').innerText = away.pitcher.so;
  document.getElementById('p-home-so').innerText = home.pitcher.so;
  document.getElementById('p-away-bb').innerText = away.pitcher.bb;
  document.getElementById('p-home-bb').innerText = home.pitcher.bb;
  document.getElementById('p-away-hr').innerText = away.pitcher.hr;
  document.getElementById('p-home-hr').innerText = home.pitcher.hr;

  // Set Batting Team stats
  document.getElementById('b-away-avg').innerText = away.batting.avg;
  document.getElementById('b-home-avg').innerText = home.batting.avg;
  document.getElementById('b-away-obp').innerText = away.batting.obp;
  document.getElementById('b-home-obp').innerText = home.batting.obp;
  document.getElementById('b-away-slg').innerText = away.batting.slg;
  document.getElementById('b-home-slg').innerText = home.batting.slg;
  document.getElementById('b-away-ops').innerText = away.batting.ops;
  document.getElementById('b-home-ops').innerText = home.batting.ops;
  document.getElementById('b-away-hr').innerText = away.batting.hr;
  document.getElementById('b-home-hr').innerText = home.batting.hr;
  document.getElementById('b-away-r').innerText = away.batting.r;
  document.getElementById('b-home-r').innerText = home.batting.r;

  // Set Pitching Team stats
  document.getElementById('t-away-era').innerText = away.pitching.era;
  document.getElementById('t-home-era').innerText = home.pitching.era;
  document.getElementById('t-away-whip').innerText = away.pitching.whip;
  document.getElementById('t-home-whip').innerText = home.pitching.whip;
  document.getElementById('t-away-hr').innerText = away.pitching.hr;
  document.getElementById('t-home-hr').innerText = home.pitching.hr;
  document.getElementById('t-away-bb').innerText = away.pitching.bb;
  document.getElementById('t-home-bb').innerText = home.pitching.bb;
  document.getElementById('t-away-so').innerText = away.pitching.so;
  document.getElementById('t-home-so').innerText = home.pitching.so;
  document.getElementById('t-away-avg').innerText = away.pitching.avg;
  document.getElementById('t-home-avg').innerText = home.pitching.avg;

  // Run prediction formula
  calculateWinProbability();
}

// Mathematical win probability engine
function calculateWinProbability() {
  if (!selectedGame) return;

  const away = selectedGame.teamAway;
  const home = selectedGame.teamHome;

  // Helper to safely parse cell values
  const getVal = (id) => parseFloat(document.getElementById(id).innerText) || 0;

  // 1. Starting Pitcher strength (Lower rating is better)
  // SPS = FIP * 0.45 + WHIP * 3.0 * 0.35 + ERA * 0.20
  const spsAway = getVal('p-away-fip') * 0.45 + getVal('p-away-whip') * 3 * 0.35 + getVal('p-away-era') * 0.20;
  const spsHome = getVal('p-home-fip') * 0.45 + getVal('p-home-whip') * 3 * 0.35 + getVal('p-home-era') * 0.20;

  // 2. Team Batting strength (Higher rating is better)
  // TOS = OPS * 10 * 0.45 + OBP * 10 * 0.25 + SLG * 10 * 0.15 + AVG * 10 * 0.05 + RunsPerGame * 0.10
  const rpgAway = getVal('b-away-r') / 90; // estimate runs per game (approx 90 games)
  const rpgHome = getVal('b-home-r') / 90;
  const tosAway = getVal('b-away-ops') * 10 * 0.45 + getVal('b-away-obp') * 10 * 0.25 + getVal('b-away-slg') * 10 * 0.15 + getVal('b-away-avg') * 10 * 0.05 + rpgAway * 0.10;
  const tosHome = getVal('b-home-ops') * 10 * 0.45 + getVal('b-home-obp') * 10 * 0.25 + getVal('b-home-slg') * 10 * 0.15 + getVal('b-home-avg') * 10 * 0.05 + rpgHome * 0.10;

  // 3. Team Pitching strength (Lower rating is better)
  // TDS = ERA * 0.45 + WHIP * 3 * 0.35 + OppAvg * 10 * 0.20
  const tdsAway = getVal('t-away-era') * 0.45 + getVal('t-away-whip') * 3 * 0.35 + getVal('t-away-avg') * 10 * 0.20;
  const tdsHome = getVal('t-home-era') * 0.45 + getVal('t-home-whip') * 3 * 0.35 + getVal('t-home-avg') * 10 * 0.20;

  // 4. Game strength combines offense, bullpen/defense, and starting pitcher
  // In a single game, the starting pitcher represents ~40% of defense, team pitching 60%.
  const pitchingGameAway = spsAway * 0.40 + tdsAway * 0.60;
  const pitchingGameHome = spsHome * 0.40 + tdsHome * 0.60;

  // Final strength score (Offense - Pitching)
  const powerAway = tosAway - pitchingGameAway;
  const powerHome = tosHome - pitchingGameHome;

  // Home field advantage adjustment (standard baseball home edge is around +2% win probability)
  // We apply a +0.15 power rating boost to the home team
  const diff = (powerAway - (powerHome + 0.15));

  // Logistic function to map strength differences to a victory percentage
  // We calibrate the factor (-0.16) to keep normal baseball win % between 35% and 65%
  let probAway = 1 / (1 + Math.exp(-0.16 * diff));
  let probHome = 1 - probAway;

  // Convert to percentages
  let pctAway = Math.round(probAway * 100);
  let pctHome = 100 - pctAway;

  // Update UI Elements
  document.getElementById('bar-away').style.width = `${pctAway}%`;
  document.getElementById('bar-home').style.width = `${pctHome}%`;
  document.getElementById('pct-away-label').innerText = `Visitante: ${pctAway}%`;
  document.getElementById('pct-home-label').innerText = `Local: ${pctHome}%`;

  const dialText = document.getElementById('dial-value-text');
  const dialSub = document.getElementById('dial-subtext');
  const dialGlow = document.querySelector('.dial-glow');

  if (pctHome >= pctAway) {
    dialText.innerText = `${pctHome}%`;
    dialSub.innerText = 'Favorito Local';
    dialText.style.color = 'var(--color-home)';
    dialGlow.style.boxShadow = '0 0 25px rgba(0, 230, 118, 0.4)';
  } else {
    dialText.innerText = `${pctAway}%`;
    dialSub.innerText = 'Favorito Visit';
    dialText.style.color = 'var(--color-away)';
    dialGlow.style.boxShadow = '0 0 25px rgba(41, 121, 255, 0.4)';
  }

  // Visual cues: highlight better values in tables
  highlightBetterValues();

  // Generate justification text
  generateWinnerJustification(spsAway, spsHome, tosAway, tosHome, tdsAway, tdsHome, pctAway, pctHome);
}

// Generate natural language justification for the winner prediction
function generateWinnerJustification(spsAway, spsHome, tosAway, tosHome, tdsAway, tdsHome, pctAway, pctHome) {
  const justificationEl = document.getElementById('justification-text');
  if (!justificationEl) return;

  const away = selectedGame.teamAway;
  const home = selectedGame.teamHome;

  let points = [];

  // 1. Pitcher comparison
  const pAwayFip = parseFloat(document.getElementById('p-away-fip').innerText) || 9.99;
  const pHomeFip = parseFloat(document.getElementById('p-home-fip').innerText) || 9.99;
  const pAwayName = document.getElementById('p-away-name').innerText;
  const pHomeName = document.getElementById('p-home-name').innerText;

  if (Math.abs(pAwayFip - pHomeFip) < 0.1) {
    points.push(`• **Duelo de abridores parejo:** ${pAwayName} (FIP ${pAwayFip.toFixed(2)}) y ${pHomeName} (FIP ${pHomeFip.toFixed(2)}) presentan un nivel similar.`);
  } else if (pAwayFip < pHomeFip) {
    const diff = pHomeFip - pAwayFip;
    points.push(`• **Ventaja en la loma para el Visitante:** El abridor ${pAwayName} tiene un mejor FIP que ${pHomeName} (${pAwayFip.toFixed(2)} vs ${pHomeFip.toFixed(2)}, una diferencia de -${diff.toFixed(2)}).`);
  } else {
    const diff = pAwayFip - pHomeFip;
    points.push(`• **Ventaja en la loma para el Local:** El abridor ${pHomeName} tiene un mejor FIP que ${pAwayName} (${pHomeFip.toFixed(2)} vs ${pAwayFip.toFixed(2)}, una diferencia de -${diff.toFixed(2)}).`);
  }

  // 2. Offense comparison
  const awayOps = parseFloat(document.getElementById('b-away-ops').innerText) || 0;
  const homeOps = parseFloat(document.getElementById('b-home-ops').innerText) || 0;
  
  if (Math.abs(awayOps - homeOps) < 0.015) {
    points.push(`• **Bateo equilibrado:** Ambos equipos tienen un rendimiento ofensivo similar con OPS de ${awayOps.toFixed(3)} vs ${homeOps.toFixed(3)}.`);
  } else if (awayOps > homeOps) {
    const diff = awayOps - homeOps;
    points.push(`• **Poder ofensivo visitante:** ${away.name} supera en OPS a ${home.name} por +${diff.toFixed(3)} (${awayOps.toFixed(3)} vs ${homeOps.toFixed(3)}), anotando un promedio estimado superior.`);
  } else {
    const diff = homeOps - awayOps;
    points.push(`• **Poder ofensivo local:** ${home.name} supera en OPS a ${away.name} por +${diff.toFixed(3)} (${homeOps.toFixed(3)} vs ${awayOps.toFixed(3)}), lo que representa una mayor capacidad de producir carreras.`);
  }

  // 3. Defense / Bullpen comparison
  const awayTeamEra = parseFloat(document.getElementById('t-away-era').innerText) || 9.99;
  const homeTeamEra = parseFloat(document.getElementById('t-home-era').innerText) || 9.99;

  if (Math.abs(awayTeamEra - homeTeamEra) < 0.15) {
    points.push(`• **Defensa y Bullpen cerrados:** El pitcheo colectivo presenta efectividades muy cercanas (ERA de ${awayTeamEra.toFixed(2)} vs ${homeTeamEra.toFixed(2)}).`);
  } else if (awayTeamEra < homeTeamEra) {
    const diff = homeTeamEra - awayTeamEra;
    points.push(`• **Mejor relevo/defensa visitante:** El cuerpo de lanzadores de ${away.name} es más sólido con una efectividad colectiva inferior por -${diff.toFixed(2)} (${awayTeamEra.toFixed(2)} vs ${homeTeamEra.toFixed(2)}).`);
  } else {
    const diff = awayTeamEra - homeTeamEra;
    points.push(`• **Mejor relevo/defensa local:** El cuerpo de lanzadores de ${home.name} es más sólido con una efectividad colectiva inferior por -${diff.toFixed(2)} (${homeTeamEra.toFixed(2)} vs ${awayTeamEra.toFixed(2)}).`);
  }

  // 4. Home field advantage
  points.push(`• **Factor Campo:** ${home.name} juega como Local, lo cual le otorga una ventaja de localía en el modelo (+0.15 puntos de rating, aprox. +2.5% de probabilidad de victoria).`);

  // 5. Final summary
  const winnerName = pctHome >= pctAway ? home.name : away.name;
  const diffPct = Math.abs(pctHome - pctAway);
  let summary = "";
  if (diffPct <= 5) {
    summary = `**Análisis Final:** Se proyecta un encuentro sumamente cerrado. **${winnerName}** es el favorito marginal principalmente por la localía y detalles finos en las estadísticas.`;
  } else if (pctHome >= pctAway) {
    // Local favorite
    const reasons = [];
    if (pHomeFip < pAwayFip) reasons.push("su mejor abridor inicial");
    if (homeOps > awayOps) reasons.push("su ofensiva más explosiva");
    if (homeTeamEra < awayTeamEra) reasons.push("su pitcheo colectivo más hermético");
    reasons.push("la ventaja de jugar en casa");
    
    let reasonsStr = reasons.slice(0, -1).join(', ') + ' y ' + reasons.slice(-1);
    summary = `**Análisis Final:** **${home.name}** es el favorito claro para llevarse la victoria (${pctHome}%). Esto se justifica por ${reasonsStr}.`;
  } else {
    // Away favorite
    const reasons = [];
    if (pAwayFip < pHomeFip) reasons.push("su mejor abridor inicial");
    if (awayOps > homeOps) reasons.push("su ofensiva más explosiva");
    if (awayTeamEra < homeTeamEra) reasons.push("su pitcheo colectivo más hermético");
    
    let reasonsStr = "";
    if (reasons.length > 1) {
      reasonsStr = reasons.slice(0, -1).join(', ') + ' y ' + reasons.slice(-1);
    } else if (reasons.length === 1) {
      reasonsStr = reasons[0];
    } else {
      reasonsStr = "un mejor balance estadístico general";
    }
    summary = `**Análisis Final:** A pesar de jugar de visitante, **${away.name}** es el favorito proyectado (${pctAway}%). Esto se justifica por ${reasonsStr}, logrando compensar y superar el factor campo del local.`;
  }

  justificationEl.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 8px;">
      ${points.map(p => `<div style="display: flex; gap: 8px;">${p}</div>`).join('')}
      <div style="margin-top: 8px; font-size: 14px; line-height: 1.5; font-weight: 500; padding: 12px; background: rgba(255,255,255,0.03); border-left: 4px solid ${pctHome >= pctAway ? 'var(--color-home)' : 'var(--color-away)'}; border-radius: 4px; color: var(--text-primary);">
        ${summary}
      </div>
    </div>
  `;
}

// Highlight better stats side-by-side (lower ERA is better, higher AVG is better, etc.)
function highlightBetterValues() {
  const compareStats = (awayId, homeId, lowerIsBetter = false) => {
    const elAway = document.getElementById(awayId);
    const elHome = document.getElementById(homeId);
    if (!elAway || !elHome) return;

    // Reset both to gray (non-winning style)
    elAway.style.color = 'var(--text-muted)';
    elAway.style.opacity = '0.5';
    elHome.style.color = 'var(--text-muted)';
    elHome.style.opacity = '0.5';

    const valAway = parseFloat(elAway.innerText) || 0;
    const valHome = parseFloat(elHome.innerText) || 0;

    if (valAway === valHome) return;

    const isAwayBetter = lowerIsBetter ? (valAway < valHome) : (valAway > valHome);
    if (isAwayBetter) {
      elAway.style.color = 'var(--color-home)'; // Green
      elAway.style.opacity = '1';
    } else {
      elHome.style.color = 'var(--color-home)'; // Green
      elHome.style.opacity = '1';
    }
  };

  // Pitchers: Lower is better for ERA, WHIP, FIP, BB, HR. Higher for SO, IP
  compareStats('p-away-era', 'p-home-era', true);
  compareStats('p-away-whip', 'p-home-whip', true);
  compareStats('p-away-fip', 'p-home-fip', true);
  compareStats('p-away-ip', 'p-home-ip', false);
  compareStats('p-away-so', 'p-home-so', false);
  compareStats('p-away-bb', 'p-home-bb', true);
  compareStats('p-away-hr', 'p-home-hr', true);

  // Team Batting: Higher is better
  compareStats('b-away-avg', 'b-home-avg', false);
  compareStats('b-away-obp', 'b-home-obp', false);
  compareStats('b-away-slg', 'b-home-slg', false);
  compareStats('b-away-ops', 'b-home-ops', false);
  compareStats('b-away-hr', 'b-home-hr', false);
  compareStats('b-away-r', 'b-home-r', false);

  // Team Pitching: Lower is better for ERA, WHIP, HR, BB, AVG. Higher for SO
  compareStats('t-away-era', 't-home-era', true);
  compareStats('t-away-whip', 't-home-whip', true);
  compareStats('t-away-hr', 't-home-hr', true);
  compareStats('t-away-bb', 't-home-bb', true);
  compareStats('t-away-so', 't-home-so', false);
  compareStats('t-away-avg', 't-home-avg', true);
}

// Make cells contenteditable for simulation
function toggleTableEditable() {
  const isEditable = this.dataset.editing === 'true';
  const cells = document.querySelectorAll('.stats-table td:first-child, .stats-table td:last-child');
  
  if (isEditable) {
    // Save
    this.dataset.editing = 'false';
    this.innerText = 'Editar datos de este juego';
    this.classList.remove('btn-outline');
    this.classList.add('btn-primary');
    
    cells.forEach(c => {
      c.removeAttribute('contenteditable');
    });
  } else {
    // Start editing
    this.dataset.editing = 'true';
    this.innerText = 'Guardar Simulación';
    this.classList.remove('btn-primary');
    this.classList.add('btn-outline');
    
    cells.forEach(c => {
      // Exclude metric name column
      if (!c.classList.contains('stat-name')) {
        c.setAttribute('contenteditable', 'true');
        
        c.addEventListener('blur', () => {
          calculateWinProbability();
        });
        c.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            c.blur();
          }
        });
      }
    });
  }
}

// Load Demo Game if no data is available
function loadDemoGame() {
  const demoGame = {
    id: "demo-game-2026",
    status: "Demo",
    isTomorrow: true,
    time: "6:30 PM",
    teamAway: {
      name: "Hanwha Eagles",
      pitcher: { name: "Owen White", era: "3.09", whip: "1.20", hr: 8, bb: 25, so: 70, ip: "80.1", fip: "3.50", yearUsed: "2026" },
      batting: { avg: ".276", obp: ".342", slg: ".420", ops: ".762", r: "480", r_per_game: "5.33", hr: 95 },
      pitching: { era: "4.11", whip: "1.38", hr: 82, bb: 320, so: 650, avg: ".260" }
    },
    teamHome: {
      name: "Kia Tigers",
      pitcher: { name: "Adam Oller", era: "2.52", whip: "1.01", hr: 9, bb: 34, so: 112, ip: "103.2", fip: "3.32", yearUsed: "2026" },
      batting: { avg: ".270", obp: ".348", slg: ".435", ops: ".783", r: "510", r_per_game: "5.67", hr: 105 },
      pitching: { era: "4.05", whip: "1.32", hr: 78, bb: 295, so: 680, avg: ".252" }
    }
  };

  currentGames = [demoGame];
  renderGamesList();
  selectGame(demoGame);
}

// Modal Handlers
function openManualModal() {
  document.getElementById('modal-manual').classList.add('active');
  // Load current selected game data into form as a starting point
  if (selectedGame) {
    document.getElementById('form-away-name').value = selectedGame.teamAway.name;
    document.getElementById('form-home-name').value = selectedGame.teamHome.name;
    
    // Pitchers
    document.getElementById('form-ap-name').value = selectedGame.teamAway.pitcher.name;
    document.getElementById('form-ap-era').value = selectedGame.teamAway.pitcher.era;
    document.getElementById('form-ap-whip').value = selectedGame.teamAway.pitcher.whip;
    document.getElementById('form-ap-ip').value = selectedGame.teamAway.pitcher.ip;
    document.getElementById('form-ap-fip').value = selectedGame.teamAway.pitcher.fip;
    document.getElementById('form-ap-so').value = selectedGame.teamAway.pitcher.so;
    document.getElementById('form-ap-bb').value = selectedGame.teamAway.pitcher.bb;
    document.getElementById('form-ap-hr').value = selectedGame.teamAway.pitcher.hr;

    document.getElementById('form-hp-name').value = selectedGame.teamHome.pitcher.name;
    document.getElementById('form-hp-era').value = selectedGame.teamHome.pitcher.era;
    document.getElementById('form-hp-whip').value = selectedGame.teamHome.pitcher.whip;
    document.getElementById('form-hp-ip').value = selectedGame.teamHome.pitcher.ip;
    document.getElementById('form-hp-fip').value = selectedGame.teamHome.pitcher.fip;
    document.getElementById('form-hp-so').value = selectedGame.teamHome.pitcher.so;
    document.getElementById('form-hp-bb').value = selectedGame.teamHome.pitcher.bb;
    document.getElementById('form-hp-hr').value = selectedGame.teamHome.pitcher.hr;
  }
}

function closeModal() {
  document.getElementById('modal-manual').classList.remove('active');
}

// Save manual form inputs
function saveManualData() {
  const manualGame = {
    id: `manual-sim-${Date.now()}`,
    status: "Simulación",
    isTomorrow: false,
    time: "Simulando",
    teamAway: {
      name: document.getElementById('form-away-name').value,
      pitcher: {
        name: document.getElementById('form-ap-name').value,
        era: parseFloat(document.getElementById('form-ap-era').value).toFixed(2),
        whip: parseFloat(document.getElementById('form-ap-whip').value).toFixed(2),
        ip: document.getElementById('form-ap-ip').value,
        fip: parseFloat(document.getElementById('form-ap-fip').value).toFixed(2),
        so: parseInt(document.getElementById('form-ap-so').value) || 0,
        bb: parseInt(document.getElementById('form-ap-bb').value) || 0,
        hr: parseInt(document.getElementById('form-ap-hr').value) || 0,
        yearUsed: "Custom"
      },
      batting: {
        avg: parseFloat(document.getElementById('form-ab-avg').value).toFixed(3),
        obp: parseFloat(document.getElementById('form-ab-obp').value).toFixed(3),
        slg: parseFloat(document.getElementById('form-ab-slg').value).toFixed(3),
        ops: parseFloat(document.getElementById('form-ab-ops').value).toFixed(3),
        r: parseInt(document.getElementById('form-ab-r').value) || 0,
        hr: parseInt(document.getElementById('form-ab-hr').value) || 0
      },
      pitching: {
        era: parseFloat(document.getElementById('form-ap-team-era').value).toFixed(2),
        whip: parseFloat(document.getElementById('form-ap-team-whip').value).toFixed(2),
        hr: parseInt(document.getElementById('form-ap-team-hr').value) || 0,
        bb: parseInt(document.getElementById('form-ap-team-bb').value) || 0,
        so: parseInt(document.getElementById('form-ap-team-so').value) || 0,
        avg: parseFloat(document.getElementById('form-ap-team-avg').value).toFixed(3)
      }
    },
    teamHome: {
      name: document.getElementById('form-home-name').value,
      pitcher: {
        name: document.getElementById('form-hp-name').value,
        era: parseFloat(document.getElementById('form-hp-era').value).toFixed(2),
        whip: parseFloat(document.getElementById('form-hp-whip').value).toFixed(2),
        ip: document.getElementById('form-hp-ip').value,
        fip: parseFloat(document.getElementById('form-hp-fip').value).toFixed(2),
        so: parseInt(document.getElementById('form-hp-so').value) || 0,
        bb: parseInt(document.getElementById('form-hp-bb').value) || 0,
        hr: parseInt(document.getElementById('form-hp-hr').value) || 0,
        yearUsed: "Custom"
      },
      batting: {
        avg: parseFloat(document.getElementById('form-hb-avg').value).toFixed(3),
        obp: parseFloat(document.getElementById('form-hb-obp').value).toFixed(3),
        slg: parseFloat(document.getElementById('form-hb-slg').value).toFixed(3),
        ops: parseFloat(document.getElementById('form-hb-ops').value).toFixed(3),
        r: parseInt(document.getElementById('form-hb-r').value) || 0,
        hr: parseInt(document.getElementById('form-hb-hr').value) || 0
      },
      pitching: {
        era: parseFloat(document.getElementById('form-hp-team-era').value).toFixed(2),
        whip: parseFloat(document.getElementById('form-hp-team-whip').value).toFixed(2),
        hr: parseInt(document.getElementById('form-hp-team-hr').value) || 0,
        bb: parseInt(document.getElementById('form-hp-team-bb').value) || 0,
        so: parseInt(document.getElementById('form-hp-team-so').value) || 0,
        avg: parseFloat(document.getElementById('form-hp-team-avg').value).toFixed(3)
      }
    }
  };

  // Add to games list and select it
  currentGames.push(manualGame);
  renderGamesList();
  selectGame(manualGame);
  closeModal();
}

// Smart Parser for pasted MyKBOStats text
function parsePastedText() {
  const pasteTarget = document.getElementById('paste-target').value;
  const rawText = document.getElementById('smart-paste-text').value;
  
  if (!rawText.trim()) {
    alert("Por favor, pega algo de texto primero.");
    return;
  }

  // 1. Parsing Pitcher Profile
  if (pasteTarget === 'away-pitcher' || pasteTarget === 'home-pitcher') {
    // Regex matches typical row: Year Team ERA WHIP W L SV ...
    // E.g. "2026 Kia 2.52 1.01 9 6 ..."
    const lines = rawText.split('\n');
    let pitcherName = "Pitcher Desconocido";
    let era = 4.50, whip = 1.40, ip = "0", hr = 0, bb = 0, so = 0, hb = 0;

    // Try to extract name
    // Pitcher profile pages have name in the first few lines
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      if (lines[i].trim() && lines[i].trim() !== "MyKBO Stats" && lines[i].trim() !== "Schedule" && lines[i].trim() !== "Stats" && lines[i].trim() !== "Search for player" && lines[i].trim() !== "Menu") {
        pitcherName = lines[i].trim();
        break;
      }
    }

    // Look for statistics row (usually starting with 2026 or 2025)
    let statsLine = lines.find(l => l.trim().startsWith('2026') || l.trim().startsWith('2025'));
    if (!statsLine) statsLine = lines.find(l => l.trim().startsWith('Career'));

    if (statsLine) {
      const parts = statsLine.split(/\s+/);
      // Row pattern: Year, Team, ERA, WHIP, W, L, SV, H, BSV, G, GS, CG, SHO, QS, TBF, NP, IP, R, ER, H, 2B, 3B, HR, SO, BB, IBB, HB
      if (parts.length >= 25) {
        era = parseFloat(parts[2]) || era;
        whip = parseFloat(parts[3]) || whip;
        ip = parts[16] || ip;
        hr = parseInt(parts[22]) || hr;
        so = parseInt(parts[23]) || so;
        bb = parseInt(parts[24]) || bb;
        hb = parseInt(parts[26]) || hb;
      }
    }

    // Calculate FIP
    let parsedIP = parseFloat(ip) || 1;
    let fip = (13 * hr + 3 * (bb + hb) - 2 * so) / parsedIP + 3.80;
    fip = Math.max(1.0, Math.min(9.99, fip));

    const prefix = pasteTarget === 'away-pitcher' ? 'form-ap' : 'form-hp';
    document.getElementById(`${prefix}-name`).value = pitcherName;
    document.getElementById(`${prefix}-era`).value = era.toFixed(2);
    document.getElementById(`${prefix}-whip`).value = whip.toFixed(2);
    document.getElementById(`${prefix}-ip`).value = ip;
    document.getElementById(`${prefix}-fip`).value = fip.toFixed(2);
    document.getElementById(`${prefix}-so`).value = so;
    document.getElementById(`${prefix}-bb`).value = bb;
    document.getElementById(`${prefix}-hr`).value = hr;

    alert(`Se ha analizado con éxito el perfil del abridor: ${pitcherName}`);
  }

  // 2. Parsing Team Roster Page
  if (pasteTarget === 'away-team' || pasteTarget === 'home-team') {
    const lines = rawText.split('\n');
    let teamName = "Equipo Desconocido";
    
    // Attempt to extract team name
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      if (lines[i].includes('Tigers') || lines[i].includes('Eagles') || lines[i].includes('Bears') || lines[i].includes('Twins') || lines[i].includes('Landers') || lines[i].includes('Lions') || lines[i].includes('Wiz') || lines[i].includes('Dinos') || lines[i].includes('Heroes') || lines[i].includes('Giants')) {
        teamName = lines[i].trim();
        break;
      }
    }

    // Parse Roster Pitchers & Hitters
    let inPitchersSection = false;
    let inHittersSection = false;

    let totalIP = 0;
    let weightedERA = 0;
    let weightedWHIP = 0;
    let totalTeamSO = 0;
    let totalTeamBB = 0;
    let pitcherHRCount = 0;

    let totalPA = 0;
    let weightedAVG = 0;
    let weightedOBP = 0;
    let weightedSLG = 0;
    let weightedOPS = 0;
    let totalTeamHR = 0;

    lines.forEach(line => {
      const cleanLine = line.trim();
      if (!cleanLine) return;

      if (cleanLine.includes('Pitchers (')) {
        inPitchersSection = true;
        inHittersSection = false;
        return;
      }
      if (cleanLine.includes('Hitters (')) {
        inPitchersSection = false;
        inHittersSection = true;
        return;
      }

      // Parse Pitchers Rows
      // E.g. "1.45 1.29 37 ⅓ 25 13 0.52" or similar
      if (inPitchersSection) {
        const parts = cleanLine.split(/\s+/);
        if (parts.length >= 6) {
          // Look for ERA (part 0), WHIP (part 1), IP (part 2, 3), SO (part 4), BB (part 5)
          const era = parseFloat(parts[0]);
          const whip = parseFloat(parts[1]);
          if (!isNaN(era) && !isNaN(whip)) {
            // handle fractional IP
            let ipStr = parts[2];
            if (parts[3] === '⅓' || parts[3] === '⅔' || parts[3] === '1/3' || parts[3] === '2/3') {
              ipStr = parts[2] + ' ' + parts[3];
            }
            // Parse IP
            let ipVal = 0;
            if (ipStr.includes('⅓') || ipStr.includes('1/3')) ipVal = parseInt(ipStr) + 0.333;
            else if (ipStr.includes('⅔') || ipStr.includes('2/3')) ipVal = parseInt(ipStr) + 0.667;
            else ipVal = parseFloat(ipStr) || 0;

            const soIndex = parts.indexOf('⅓') !== -1 || parts.indexOf('⅔') !== -1 ? 4 : 3;
            const bbIndex = soIndex + 1;
            const so = parseInt(parts[soIndex]) || 0;
            const bb = parseInt(parts[bbIndex]) || 0;

            if (ipVal > 0) {
              totalIP += ipVal;
              weightedERA += era * ipVal;
              weightedWHIP += whip * ipVal;
              totalTeamSO += so;
              totalTeamBB += bb;
            }
          }
        }
      }

      // Parse Hitters Rows
      // E.g. ".309/.424/.475 .899 275 69 6 28 39 40"
      if (inHittersSection) {
        if (cleanLine.includes('/')) {
          const parts = cleanLine.split(/\s+/);
          const slash = parts[0];
          const ops = parseFloat(parts[1]);
          const pa = parseInt(parts[2]);
          
          if (slash.includes('/') && !isNaN(ops) && !isNaN(pa)) {
            const slashParts = slash.split('/');
            const avg = parseFloat(slashParts[0]) || 0;
            const obp = parseFloat(slashParts[1]) || 0;
            const slg = parseFloat(slashParts[2]) || 0;

            const hrIndex = 5; // index of HR (parts: 0=slash, 1=ops, 2=pa, 3=H, 4=HR/RBI index)
            const hr = parseInt(parts[4]) || 0; // estimate HR

            totalPA += pa;
            weightedAVG += avg * pa;
            weightedOBP += obp * pa;
            weightedSLG += slg * pa;
            weightedOPS += ops * pa;
            totalTeamHR += hr;
          }
        }
      }
    });

    const teamERA = totalIP > 0 ? (weightedERA / totalIP) : 4.50;
    const teamWHIP = totalIP > 0 ? (weightedWHIP / totalIP) : 1.40;
    const teamAVG = totalPA > 0 ? (weightedAVG / totalPA) : .260;
    const teamOBP = totalPA > 0 ? (weightedOBP / totalPA) : .330;
    const teamSLG = totalPA > 0 ? (weightedSLG / totalPA) : .400;
    const teamOPS = totalPA > 0 ? (weightedOPS / totalPA) : .730;

    const estimatedRuns = Math.round(teamOPS * 6.8 * 90);

    const prefix = pasteTarget === 'away-team' ? 'form-ab' : 'form-hb';
    const pitchingPrefix = pasteTarget === 'away-team' ? 'form-ap-team' : 'form-hp-team';

    // Set Name
    const nameInputId = pasteTarget === 'away-team' ? 'form-away-name' : 'form-home-name';
    document.getElementById(nameInputId).value = teamName;

    // Set Batting fields
    document.getElementById(`${prefix}-avg`).value = teamAVG.toFixed(3);
    document.getElementById(`${prefix}-obp`).value = teamOBP.toFixed(3);
    document.getElementById(`${prefix}-slg`).value = teamSLG.toFixed(3);
    document.getElementById(`${prefix}-ops`).value = teamOPS.toFixed(3);
    document.getElementById(`${prefix}-r`).value = estimatedRuns;
    document.getElementById(`${prefix}-hr`).value = totalTeamHR;

    // Set Pitching fields
    document.getElementById(`${pitchingPrefix}-era`).value = teamERA.toFixed(2);
    document.getElementById(`${pitchingPrefix}-whip`).value = teamWHIP.toFixed(2);
    document.getElementById(`${pitchingPrefix}-hr`).value = Math.round(totalTeamHR * 0.9);
    document.getElementById(`${pitchingPrefix}-bb`).value = totalTeamBB;
    document.getElementById(`${pitchingPrefix}-so`).value = totalTeamSO;
    document.getElementById(`${pitchingPrefix}-avg`).value = (teamAVG + 0.01).toFixed(3);

    alert(`Se ha analizado con éxito el roster del equipo: ${teamName}`);
  }

  // Clear text area and toggle tab to Form
  document.getElementById('smart-paste-text').value = '';
  document.querySelectorAll('.tab-btn').forEach(t => {
    if (t.dataset.tab === 'tab-form') t.click();
  });
}
