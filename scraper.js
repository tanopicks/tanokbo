const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const INTERVAL_MS = 120000; // 2 minutes

// Helper to parse Innings Pitched (IP)
function parseIP(ipStr) {
  if (!ipStr) return 0;
  ipStr = ipStr.replace(/\s+/g, ' ').trim();
  let parts = ipStr.split(' ');
  let whole = parseInt(parts[0]) || 0;
  let fraction = 0;
  if (parts.length > 1) {
    if (parts[1] === '⅓' || parts[1] === '1/3') fraction = 1 / 3;
    else if (parts[1] === '⅔' || parts[1] === '2/3') fraction = 2 / 3;
  } else if (ipStr.includes('.')) {
    let decimals = ipStr.split('.');
    whole = parseInt(decimals[0]) || 0;
    let outs = parseInt(decimals[1]) || 0;
    fraction = outs / 3;
  }
  return whole + fraction;
}

// Helper to parse fractional stats
function parseFloatSafe(val) {
  if (!val) return 0;
  let clean = val.replace(/[^0-9.-]/g, '');
  return parseFloat(clean) || 0;
}

// Scrape pitcher stats from their profile page
async function scrapePitcher(page, url, name) {
  console.log(`Scraping stats for pitcher: ${name} (${url})`);
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    const stats = await page.evaluate(() => {
      const table = document.querySelector('table');
      if (!table) return null;
      
      const headers = Array.from(table.querySelectorAll('th')).map(th => th.innerText.trim());
      const rows = Array.from(table.querySelectorAll('tr')).map(tr => 
        Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim())
      ).filter(r => r.length > 0);

      // Find the index of key headers
      const getIndex = (name) => headers.findIndex(h => h.toUpperCase() === name.toUpperCase());
      const idxYear = getIndex('Year');
      const idxERA = getIndex('ERA');
      const idxWHIP = getIndex('WHIP');
      const idxHR = getIndex('HR');
      const idxBB = getIndex('BB');
      const idxSO = getIndex('SO');
      const idxIP = getIndex('IP');
      const idxHB = getIndex('HB'); // Hit By Pitch

      // Try to find the 2026 row, or 2025, or Career
      let targetRow = rows.find(r => r[idxYear] === '2026');
      if (!targetRow) targetRow = rows.find(r => r[idxYear] === '2025');
      if (!targetRow) targetRow = rows.find(r => r[idxYear] === 'Career');
      if (!targetRow && rows.length > 0) targetRow = rows[0]; // Fallback to first row

      if (!targetRow) return null;

      return {
        era: targetRow[idxERA] || '0.00',
        whip: targetRow[idxWHIP] || '0.00',
        hr: targetRow[idxHR] || '0',
        bb: targetRow[idxBB] || '0',
        so: targetRow[idxSO] || '0',
        ip: targetRow[idxIP] || '0',
        hb: targetRow[idxHB] || '0',
        yearUsed: targetRow[idxYear] || 'Unknown'
      };
    });

    if (!stats) {
      console.log(`No table stats found for ${name}. Using defaults.`);
      return { name, url, era: 4.50, whip: 1.40, hr: 0, bb: 0, so: 0, ip: 0, hb: 0, fip: 4.50, yearUsed: 'N/A' };
    }

    const ipParsed = parseIP(stats.ip);
    const eraParsed = parseFloatSafe(stats.era);
    const whipParsed = parseFloatSafe(stats.whip);
    const hrParsed = parseFloatSafe(stats.hr);
    const bbParsed = parseFloatSafe(stats.bb);
    const soParsed = parseFloatSafe(stats.so);
    const hbParsed = parseFloatSafe(stats.hb);

    // Calculate FIP
    // FIP = (13*HR + 3*(BB+HBP) - 2*SO) / IP + FIP_constant
    // We use 3.80 as a reasonable KBO FIP constant
    let fip = 4.50;
    if (ipParsed > 0) {
      fip = (13 * hrParsed + 3 * (bbParsed + hbParsed) - 2 * soParsed) / ipParsed + 3.80;
      fip = Math.max(1.0, Math.min(9.99, fip)); // clamp values realistically
    } else {
      fip = eraParsed > 0 ? eraParsed : 4.50;
    }

    return {
      name,
      url,
      era: eraParsed.toFixed(2),
      whip: whipParsed.toFixed(2),
      hr: hrParsed,
      bb: bbParsed,
      so: soParsed,
      ip: stats.ip,
      hb: hbParsed,
      fip: fip.toFixed(2),
      yearUsed: stats.yearUsed
    };

  } catch (error) {
    console.error(`Error scraping pitcher ${name}:`, error);
    return { name, url, era: 4.50, whip: 1.40, hr: 0, bb: 0, so: 0, ip: 0, hb: 0, fip: 4.50, yearUsed: 'Error' };
  }
}

// Scrape team roster stats and aggregate them
async function scrapeTeamStats(page, url, teamName) {
  console.log(`Scraping team roster stats: ${teamName} (${url})`);
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    const rosterData = await page.evaluate(() => {
      // Find Pitchers table
      const tables = Array.from(document.querySelectorAll('table'));
      
      let pitchersTable = null;
      let hittersTable = null;

      tables.forEach(t => {
        const headers = Array.from(t.querySelectorAll('th')).map(th => th.innerText.trim().toUpperCase());
        if (headers.includes('PITCHERS') || headers.includes('K/BB')) {
          pitchersTable = t;
        } else if (headers.includes('HITTERS') || headers.includes('AVG/OBP/SLG')) {
          hittersTable = t;
        }
      });

      const pitcherStats = [];
      if (pitchersTable) {
        const headers = Array.from(pitchersTable.querySelectorAll('th')).map(th => th.innerText.trim());
        const rows = Array.from(pitchersTable.querySelectorAll('tr')).map(tr => 
          Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim())
        ).filter(r => r.length > 0);

        const getIndex = (name) => headers.findIndex(h => h.toUpperCase() === name.toUpperCase());
        const idxERA = getIndex('ERA');
        const idxWHIP = getIndex('WHIP');
        const idxIP = getIndex('IP');
        const idxSO = getIndex('SO');
        const idxBB = getIndex('BB');

        rows.forEach(row => {
          pitcherStats.push({
            era: row[idxERA] || '0.00',
            whip: row[idxWHIP] || '0.00',
            ip: row[idxIP] || '0',
            so: row[idxSO] || '0',
            bb: row[idxBB] || '0'
          });
        });
      }

      const hitterStats = [];
      if (hittersTable) {
        const headers = Array.from(hittersTable.querySelectorAll('th')).map(th => th.innerText.trim());
        const rows = Array.from(hittersTable.querySelectorAll('tr')).map(tr => 
          Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim())
        ).filter(r => r.length > 0);

        const getIndex = (name) => headers.findIndex(h => h.toUpperCase() === name.toUpperCase());
        const idxSlash = headers.findIndex(h => h.includes('AVG/OBP/SLG') || h.includes('/'));
        const idxOPS = getIndex('OPS');
        const idxPA = getIndex('PA');
        const idxHR = getIndex('HR');

        rows.forEach(row => {
          hitterStats.push({
            slash: row[idxSlash] || '.000/.000/.000',
            ops: row[idxOPS] || '.000',
            pa: row[idxPA] || '0',
            hr: row[idxHR] || '0'
          });
        });
      }

      return { pitcherStats, hitterStats };
    });

    // 1. Aggregate Pitching stats
    let totalPitchingIP = 0;
    let weightedERA = 0;
    let weightedWHIP = 0;
    let totalTeamSO = 0;
    let totalTeamBB = 0;
    let activePitchersCount = 0;

    rosterData.pitcherStats.forEach(p => {
      const ip = parseIP(p.ip);
      const era = parseFloatSafe(p.era);
      const whip = parseFloatSafe(p.whip);
      const so = parseFloatSafe(p.so);
      const bb = parseFloatSafe(p.bb);

      if (ip > 0) {
        totalPitchingIP += ip;
        weightedERA += era * ip;
        weightedWHIP += whip * ip;
        totalTeamSO += so;
        totalTeamBB += bb;
        activePitchersCount++;
      }
    });

    const teamERA = totalPitchingIP > 0 ? (weightedERA / totalPitchingIP) : 4.50;
    const teamWHIP = totalPitchingIP > 0 ? (weightedWHIP / totalPitchingIP) : 1.40;

    // 2. Aggregate Batting stats
    let totalBattingPA = 0;
    let weightedAVG = 0;
    let weightedOBP = 0;
    let weightedSLG = 0;
    let weightedOPS = 0;
    let totalTeamHR = 0;
    let activeHittersCount = 0;

    rosterData.hitterStats.forEach(h => {
      const pa = parseFloatSafe(h.pa);
      const ops = parseFloatSafe(h.ops);
      const hr = parseFloatSafe(h.hr);

      // Parse slash (.250/.320/.410)
      const slashParts = h.slash.split('/');
      const avg = slashParts[0] ? parseFloatSafe(slashParts[0]) : 0;
      const obp = slashParts[1] ? parseFloatSafe(slashParts[1]) : 0;
      const slg = slashParts[2] ? parseFloatSafe(slashParts[2]) : 0;

      if (pa > 0) {
        totalBattingPA += pa;
        weightedAVG += avg * pa;
        weightedOBP += obp * pa;
        weightedSLG += slg * pa;
        weightedOPS += ops * pa;
        totalTeamHR += hr;
        activeHittersCount++;
      }
    });

    const teamAVG = totalBattingPA > 0 ? (weightedAVG / totalBattingPA) : .260;
    const teamOBP = totalBattingPA > 0 ? (weightedOBP / totalBattingPA) : .330;
    const teamSLG = totalBattingPA > 0 ? (weightedSLG / totalBattingPA) : .400;
    const teamOPS = totalBattingPA > 0 ? (weightedOPS / totalBattingPA) : .730;

    // Estimate team runs scored per game (approx 5.0 in KBO)
    // Run estimation: R/G is strongly correlated with OPS. Usually, R/G ≈ OPS * 6.5
    const estimatedRunsPerGame = teamOPS * 6.8;

    return {
      pitching: {
        era: teamERA.toFixed(2),
        whip: teamWHIP.toFixed(2),
        hr: Math.round(totalTeamHR * 0.9), // approximate opponent HRs
        bb: totalTeamBB,
        so: totalTeamSO,
        avg: (teamAVG + 0.01).toFixed(3) // opposing AVG is usually slightly higher than own AVG
      },
      batting: {
        avg: teamAVG.toFixed(3),
        obp: teamOBP.toFixed(3),
        slg: teamSLG.toFixed(3),
        ops: teamOPS.toFixed(3),
        r: (estimatedRunsPerGame * 90).toFixed(0), // Total estimated runs (90 games)
        r_per_game: estimatedRunsPerGame.toFixed(2),
        hr: totalTeamHR
      }
    };

  } catch (error) {
    console.error(`Error scraping team ${teamName}:`, error);
    // Fallbacks
    return {
      pitching: { era: '4.50', whip: '1.40', hr: 80, bb: 350, so: 700, avg: '.265' },
      batting: { avg: '.265', obp: '.335', slg: '.410', ops: '.745', r: '450', r_per_game: '5.00', hr: 90 }
    };
  }
}

// Scrape KBO Stats Homepage for daily games
async function scrapeKBO(browser) {
  console.log('--- Starting Scrape KBO Stats ---', new Date().toLocaleTimeString());
  
  let page;
  try {
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 1000 });

    console.log('Navigating to homepage...');
    await page.goto('https://mykbostats.com/', { waitUntil: 'networkidle2', timeout: 60000 });

    // Extract all games on the homepage (Today & Tomorrow)
    const gamesInfo = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.ds-game-card'));
      return cards.map(c => {
        const href = c.href;
        
        // Find text content
        const text = c.innerText || '';
        
        // Identify game status / time
        const stateEl = c.querySelector('.ds-game-card__state');
        const stateText = stateEl ? stateEl.innerText.trim() : '';
        const isLiveOrFinal = stateText.includes('Final') || stateText.includes('Live') || stateText.includes('Progress');

        // Extract team logos/names
        const teamEls = Array.from(c.querySelectorAll('.ds-game-team'));
        const teams = teamEls.map(t => {
          const nameSpan = t.querySelector('.ds-game-team__name');
          const nameText = nameSpan ? nameSpan.innerText.trim() : '';
          const logoEl = t.querySelector('.ds-team-logo');
          const logoUrl = logoEl ? logoEl.src : '';
          return { name: nameText, logo: logoUrl };
        });

        // Determine if it is in tomorrow's list
        const tomorrowHeading = Array.from(document.querySelectorAll('h2, h3')).find(h => h.innerText.includes('Tomorrow'));
        let isTomorrow = false;
        if (tomorrowHeading) {
          // simple DOM check to see if this card is after the tomorrow heading
          let sibling = tomorrowHeading.nextElementSibling;
          while (sibling) {
            if (sibling.contains(c) || sibling === c) {
              isTomorrow = true;
              break;
            }
            sibling = sibling.nextElementSibling;
          }
        }

        return {
          href,
          teams,
          status: stateText,
          isTomorrow,
          isLiveOrFinal
        };
      });
    });

    console.log(`Found ${gamesInfo.length} games on the homepage.`);

    const scrapedGames = [];

    // Filter games: We prefer Scheduled (unplayed) games for prediction
    // But we'll scrape all scheduled games, and if none, we scrape live/final games.
    const gamesToProcess = gamesInfo.filter(g => !g.isLiveOrFinal).slice(0, 5); // Process up to 5 unplayed games
    
    // If no scheduled games, process today's finished games just as a demonstration
    const finalGames = gamesToProcess.length === 0 ? gamesInfo.slice(0, 5) : [];
    const gamesList = gamesToProcess.concat(finalGames);

    for (const g of gamesList) {
      console.log(`Processing game: ${g.href}`);
      
      // Go to game details page
      await page.goto(g.href, { waitUntil: 'networkidle2', timeout: 45000 });
      console.log(`Game page title: "${await page.title()}"`);
      
      const gameDetails = await page.evaluate(() => {
        // Find Probable Starters names and links
        const links = Array.from(document.querySelectorAll('a'));
        
        // Find links that match /players/
        const playerLinks = links.filter(l => l.href.includes('/players/') && !l.href.includes('/foreign'));
        const activePlayerLinks = playerLinks.filter(l => l.innerText.trim() !== '');
        
        // Find team links /teams/
        const teamLinks = links.filter(l => l.href.includes('/teams/') && !l.href.includes('/historical') && l.innerText.trim() !== 'Team List');

        let pitcher1 = { name: 'Unknown Pitcher', url: '' };
        let pitcher2 = { name: 'Unknown Pitcher', url: '' };
        
        if (activePlayerLinks.length >= 2) {
          pitcher1 = { name: activePlayerLinks[0].innerText.trim(), url: activePlayerLinks[0].href };
          pitcher2 = { name: activePlayerLinks[1].innerText.trim(), url: activePlayerLinks[1].href };
        }

        // Teams Info
        let team1 = { name: 'Away Team', url: '' };
        let team2 = { name: 'Home Team', url: '' };
        
        const uniqueTeams = [];
        const seen = new Set();
        teamLinks.forEach(tl => {
          const cleanUrl = tl.href;
          if (!seen.has(cleanUrl)) {
            seen.add(cleanUrl);
            uniqueTeams.push({ name: tl.innerText.trim(), url: cleanUrl });
          }
        });

        // Match team names from URL slug
        const gameUrl = window.location.href;
        const urlMatch = gameUrl.match(/\/games\/\d+-([A-Za-z0-9]+)-vs-([A-Za-z0-9]+)-\d+/);
        if (urlMatch && uniqueTeams.length > 0) {
          const awaySlug = urlMatch[1].toLowerCase();
          const homeSlug = urlMatch[2].toLowerCase();
          
          const findTeam = (slug) => {
            return uniqueTeams.find(t => {
              const nameLower = t.name.toLowerCase();
              return nameLower.includes(slug) || (slug === 'kt' && nameLower.includes('kt')) || (slug === 'lg' && nameLower.includes('lg'));
            });
          };
          
          const awayTeamMatch = findTeam(awaySlug);
          const homeTeamMatch = findTeam(homeSlug);
          
          if (awayTeamMatch) team1 = awayTeamMatch;
          if (homeTeamMatch) team2 = homeTeamMatch;
        } else if (uniqueTeams.length >= 2) {
          // Fallback to first two if regex fails
          team1 = uniqueTeams[0];
          team2 = uniqueTeams[1];
        }

        // Check if there is game state time
        const stateEl = document.querySelector('.ds-game-card__state');
        const timeStr = stateEl ? stateEl.innerText.trim() : '6:30pm';

        return {
          team1,
          team2,
          pitcher1,
          pitcher2,
          time: timeStr
        };
      });

      console.log("Game Details Scraped:", JSON.stringify(gameDetails, null, 2));

      // Now scrape each pitcher details
      let pitcher1Stats = null;
      let pitcher2Stats = null;
      if (gameDetails.pitcher1.url) {
        pitcher1Stats = await scrapePitcher(page, gameDetails.pitcher1.url, gameDetails.pitcher1.name);
      }
      if (gameDetails.pitcher2.url) {
        pitcher2Stats = await scrapePitcher(page, gameDetails.pitcher2.url, gameDetails.pitcher2.name);
      }

      // Now scrape each team details
      let team1Stats = null;
      let team2Stats = null;
      if (gameDetails.team1.url) {
        team1Stats = await scrapeTeamStats(page, gameDetails.team1.url, gameDetails.team1.name);
      }
      if (gameDetails.team2.url) {
        team2Stats = await scrapeTeamStats(page, gameDetails.team2.url, gameDetails.team2.name);
      }

      scrapedGames.push({
        id: g.href.split('/').pop(),
        url: g.href,
        status: g.status,
        isTomorrow: g.isTomorrow,
        time: gameDetails.time,
        teamAway: {
          name: gameDetails.team1.name,
          url: gameDetails.team1.url,
          pitcher: pitcher1Stats || { name: 'TBD', era: '0.00', whip: '0.00', hr: 0, bb: 0, so: 0, ip: '0', fip: '0.00' },
          batting: team1Stats ? team1Stats.batting : { avg: '.260', obp: '.330', slg: '.400', ops: '.730', r: '450', r_per_game: '5.00', hr: 90 },
          pitching: team1Stats ? team1Stats.pitching : { era: '4.50', whip: '1.40', hr: 80, bb: 350, so: 700, avg: '.265' }
        },
        teamHome: {
          name: gameDetails.team2.name,
          url: gameDetails.team2.url,
          pitcher: pitcher2Stats || { name: 'TBD', era: '0.00', whip: '0.00', hr: 0, bb: 0, so: 0, ip: '0', fip: '0.00' },
          batting: team2Stats ? team2Stats.batting : { avg: '.260', obp: '.330', slg: '.400', ops: '.730', r: '450', r_per_game: '5.00', hr: 90 },
          pitching: team2Stats ? team2Stats.pitching : { era: '4.50', whip: '1.40', hr: 80, bb: 350, so: 700, avg: '.265' }
        }
      });
    }

    const output = {
      lastUpdated: new Date().toISOString(),
      games: scrapedGames
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(output, null, 2));
    fs.writeFileSync(path.join(__dirname, 'data.js'), 'window.kboData = ' + JSON.stringify(output, null, 2) + ';');
    console.log(`Successfully updated data.json and data.js with ${scrapedGames.length} games.`);

  } catch (error) {
    console.error('Fatal error during scrape:', error);
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    console.log('Page closed. Scrape cycle finished.');
  }
}

// Main execution loop
async function main() {
  const runOnce = process.argv.includes('--once') || process.env.RUN_ONCE === 'true';
  
  console.log('Launching browser instance...');
  const launchOptions = { headless: true };
  if (runOnce) {
    // Required arguments for GitHub Actions Linux runners
    launchOptions.args = ['--no-sandbox', '--disable-setuid-sandbox'];
  }
  
  const browser = await puppeteer.launch(launchOptions);

  try {
    await scrapeKBO(browser);
    
    if (runOnce) {
      console.log('Run once mode active. Closing browser and exiting...');
      await browser.close();
      process.exit(0);
    }
    
    console.log(`Scheduling next scrape in ${INTERVAL_MS / 1000} seconds...`);
    setInterval(async () => {
      try {
        await scrapeKBO(browser);
      } catch (e) {
        console.error('Error in interval scrape:', e);
      }
    }, INTERVAL_MS);
  } catch (error) {
    console.error('Failed in main scraper execution:', error);
    await browser.close().catch(() => {});
    if (runOnce) process.exit(1);
  }
}

main();
