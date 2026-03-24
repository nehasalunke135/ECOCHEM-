/* ══════════════════════════════════════════════════════════
   ReacSense — Core Application Script
   Features: Search, AI (Groq API), Dashboard, Analytics
══════════════════════════════════════════════════════════ */

// ── 12 Green Chemistry Principles ────────────────────────
const GREEN_PRINCIPLES = {
  1:  "Prevention",
  2:  "Atom Economy",
  3:  "Less Hazardous Synthesis",
  4:  "Designing Safer Chemicals",
  5:  "Safer Solvents & Auxiliaries",
  6:  "Design for Energy Efficiency",
  7:  "Use of Renewable Feedstocks",
  8:  "Reduce Derivatives",
  9:  "Catalysis",
  10: "Design for Degradation",
  11: "Real-time Pollution Prevention",
  12: "Inherently Safer Chemistry"
};

const TOXIN_COLORS = {
  "VERY HIGH": "#f04040",
  "HIGH":      "#f5a623",
  "MEDIUM":    "#4eb8f0",
  "LOW":       "#22d9a0"
};
const SCORE_COLORS = [
  "#f04040","#f04040","#f5623c","#f5a623",
  "#d4c020","#9bcf30","#6db83a","#22d9a0",
  "#22d9a0","#22d9a0","#22d9a0"
];

// ── State ─────────────────────────────────────────────────
let currentFilter  = 'all';
let currentResults = [];
let chatHistory    = [];
let isAILoading    = false;

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const total = REACTIONS_DB.length;
  document.getElementById('totalCount').textContent      = total;
  document.getElementById('kpiTotal').textContent        = total;
  document.getElementById('aiReactionCount').textContent = total;

  document.getElementById('kpiCritical').textContent =
    REACTIONS_DB.filter(r => r.sustainabilityRating === 'CRITICAL').length;
  document.getElementById('kpiPoor').textContent =
    REACTIONS_DB.filter(r => r.sustainabilityRating === 'POOR').length;
  document.getElementById('kpiGood').textContent =
    REACTIONS_DB.filter(r => ['GOOD','EXCELLENT'].includes(r.sustainabilityRating)).length;

  initCanvas();
  buildDashboard();
  document.getElementById('browseCta').style.display = 'block';
});

// ── Section Navigation ────────────────────────────────────
function showSection(name) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-pill').forEach(p => p.classList.remove('active'));
  document.getElementById('section-' + name).classList.add('active');
  const pills = document.querySelectorAll('.nav-pill');
  const idx = { search: 0, dashboard: 1, ai: 2 };
  pills.forEach(p => p.classList.remove('active'));
  if (pills[idx[name]]) pills[idx[name]].classList.add('active');
}

// ── Filter ────────────────────────────────────────────────
function setFilter(el, industry) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  currentFilter = industry;
  const q = document.getElementById('searchInput').value.trim();
  if (q) doSearch();
  else if (industry !== 'all') {
    const filtered = REACTIONS_DB.filter(r => r.industry === industry);
    renderCards(filtered);
    document.getElementById('sortBar').style.display = 'flex';
    document.getElementById('resultCount').textContent = filtered.length + ' reactions';
    currentResults = filtered;
  }
}

// ── Live Search + Autocomplete ────────────────────────────
function liveSearch() {
  const q = document.getElementById('searchInput').value.trim();
  document.getElementById('clearBtn').style.display = q ? 'block' : 'none';

  if (q.length < 2) { hideSuggestions(); return; }

  const lower = q.toLowerCase();
  const seen  = new Set();
  const sugs  = [];

  REACTIONS_DB.forEach(r => {
    if (r.product.toLowerCase().includes(lower) && !seen.has(r.product)) {
      sugs.push({ text: r.product, type: 'product', r });
      seen.add(r.product);
    }
    if (r.process.toLowerCase().includes(lower) && !seen.has(r.process)) {
      sugs.push({ text: r.process, type: 'process', r });
      seen.add(r.process);
    }
    r.toxins.forEach(t => {
      const tKey = t.split('(')[0].trim();
      if (t.toLowerCase().includes(lower) && !seen.has(tKey)) {
        sugs.push({ text: tKey, type: 'toxin', r });
        seen.add(tKey);
      }
    });
  });

  if (!sugs.length) { hideSuggestions(); return; }

  const box = document.getElementById('suggestions');
  box.innerHTML = sugs.slice(0, 6).map(s => `
    <div class="suggestion-item" onclick="selectSuggestion('${esc(s.text)}')">
      <span class="sug-type">${s.type}</span>
      <span>${esc(s.text)}</span>
    </div>`).join('');
  box.style.display = 'block';
}

function selectSuggestion(text) {
  document.getElementById('searchInput').value = text;
  hideSuggestions();
  doSearch();
}
function hideSuggestions() {
  document.getElementById('suggestions').style.display = 'none';
}
document.addEventListener('click', e => {
  if (!e.target.closest('.search-bar')) hideSuggestions();
});

// ── ML-Style Scoring ──────────────────────────────────────
function scoreRelevance(r, terms) {
  let score = 0;
  const fields = [
    { text: r.product, w: 5 },
    { text: r.reactants, w: 4 },
    { text: r.process, w: 3 },
    { text: r.industry, w: 2 },
    { text: r.info, w: 1 },
    { text: r.toxins.join(' '), w: 3 },
    { text: r.greenAlternatives.join(' '), w: 2 },
    { text: r.equation, w: 2 }
  ];
  terms.forEach(term => {
    fields.forEach(f => {
      const count = (f.text.toLowerCase().split(term).length - 1);
      score += count * f.w;
    });
  });
  return score;
}

// ── Main Search ───────────────────────────────────────────
function doSearch() {
  hideSuggestions();
  const raw = document.getElementById('searchInput').value.trim();
  if (!raw) { browseAll(); return; }

  const stopWords = new Set(['the','a','an','of','in','and','or','for','is','are','to','from','with','by','at','as']);
  const terms = raw.toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 1 && !stopWords.has(t));

  let pool = currentFilter === 'all' ? REACTIONS_DB :
    REACTIONS_DB.filter(r => r.industry === currentFilter);

  const scored = pool
    .map(r => ({ r, score: scoreRelevance(r, terms) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  currentResults = scored.map(x => x.r);

  document.getElementById('sortBar').style.display = 'flex';
  document.getElementById('resultCount').textContent =
    currentResults.length
      ? currentResults.length + ' reaction' + (currentResults.length > 1 ? 's' : '') + ' found'
      : 'No results';

  renderCards(currentResults);
  document.getElementById('browseCta').style.display = 'none';
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  document.getElementById('clearBtn').style.display = 'none';
  document.getElementById('results').innerHTML = '';
  document.getElementById('sortBar').style.display = 'none';
  document.getElementById('browseCta').style.display = 'block';
  hideSuggestions();
}

function browseAll() {
  currentResults = currentFilter === 'all' ? [...REACTIONS_DB] :
    REACTIONS_DB.filter(r => r.industry === currentFilter);
  renderCards(currentResults);
  document.getElementById('sortBar').style.display = 'flex';
  document.getElementById('resultCount').textContent = currentResults.length + ' reactions';
  document.getElementById('browseCta').style.display = 'none';
}

// ── Sort ──────────────────────────────────────────────────
function sortResults() {
  const v = document.getElementById('sortSelect').value;
  let sorted = [...currentResults];
  if (v === 'greenScore-asc') sorted.sort((a,b) => a.greenScore - b.greenScore);
  else if (v === 'greenScore-desc') sorted.sort((a,b) => b.greenScore - a.greenScore);
  else if (v === 'toxin-desc') {
    const order = { 'VERY HIGH': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
    sorted.sort((a,b) => (order[b.toxinLevel]||0) - (order[a.toxinLevel]||0));
  }
  else if (v === 'industry') sorted.sort((a,b) => a.industry.localeCompare(b.industry));
  renderCards(sorted, false);
}

// ── Render Cards ──────────────────────────────────────────
function renderCards(list, animate = true) {
  const div = document.getElementById('results');
  div.innerHTML = '';

  if (!list.length) {
    div.innerHTML = `<div class="empty-state">
      <div class="empty-ico">⚗</div>
      <div class="empty-title">No reactions found</div>
      <p class="empty-hint">Try broader terms: chemical name, industry, or toxin</p>
    </div>`;
    return;
  }

  list.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'r-card risk-' + r.sustainabilityRating;
    card.onclick = () => openModal(r);

    const score    = r.greenScore;
    const circ     = 2 * Math.PI * 16;
    const offset   = circ - (score / 10) * circ;
    const ringColor = SCORE_COLORS[Math.min(score, 10)];

    const toxinPills = r.toxins.slice(0, 3).map(t =>
      `<span class="toxin-pill" title="${esc(t)}">${esc(t.split('(')[0].trim())}</span>`
    ).join('') + (r.toxins.length > 3 ? `<span class="toxin-pill">+${r.toxins.length - 3} more</span>` : '');

    card.innerHTML = `
      <div class="card-top">
        <span class="card-industry-badge">${esc(r.industry)}</span>
        <div class="card-score-ring" title="Green Score: ${score}/10">
          <svg class="ring-svg" viewBox="0 0 42 42">
            <circle class="ring-bg" cx="21" cy="21" r="16"/>
            <circle class="ring-fg" cx="21" cy="21" r="16"
              stroke="${ringColor}"
              stroke-dasharray="${circ}"
              stroke-dashoffset="${offset}"/>
          </svg>
          <div class="ring-label">${score}</div>
        </div>
      </div>
      <div class="card-product">${esc(r.product)}</div>
      <div class="card-equation">${esc(r.equation)}</div>
      <div class="card-meta">
        <div class="meta-row"><span class="meta-key">Reactants</span><span class="meta-val">${esc(r.reactants)}</span></div>
        <div class="meta-row"><span class="meta-key">Process</span><span class="meta-val">${esc(r.process)}</span></div>
        <div class="meta-row"><span class="meta-key">Conditions</span><span class="meta-val">${esc(r.conditions)}</span></div>
      </div>
      <div class="toxin-row">${toxinPills}</div>
      <div class="card-footer">
        <span class="sust-badge sust-${r.sustainabilityRating}">${r.sustainabilityRating}</span>
        <span class="card-more">View full analysis →</span>
      </div>`;

    div.appendChild(card);
    if (animate) {
      setTimeout(() => card.classList.add('visible'), i * 60);
    } else {
      card.classList.add('visible');
    }
  });
}

// ── Modal ─────────────────────────────────────────────────
function openModal(r) {
  const principles = (r.greenPrinciples || []).map(p =>
    `<span class="p-badge" title="${GREEN_PRINCIPLES[p]}">P${p}: ${GREEN_PRINCIPLES[p]}</span>`
  ).join('');

  const toxinList = r.toxins.map(t =>
    `<div class="modal-toxin-item"><span class="toxin-ico">⚠</span>${esc(t)}</div>`
  ).join('');

  const altList = r.greenAlternatives.map(a =>
    `<div class="modal-alt-item"><span class="alt-ico">✦</span>${esc(a)}</div>`
  ).join('');

  const scoreColor = SCORE_COLORS[Math.min(r.greenScore, 10)];

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-industry">${esc(r.industry)} · ${esc(r.id)}</div>
    <div class="modal-product">${esc(r.product)}</div>
    <div class="modal-process">${esc(r.process)}</div>
    <div class="modal-eq">${esc(r.equation)}</div>

    <div class="modal-score-row">
      <div class="score-big" style="color:${scoreColor}">${r.greenScore}</div>
      <div class="score-meta">
        <div class="score-label">GREEN SCORE / 10</div>
        <span class="sust-badge sust-${r.sustainabilityRating}">${r.sustainabilityRating}</span>
        <div style="font-size:12px;color:var(--text-3);margin-top:4px;font-family:var(--font-mono)">Toxin Level: ${r.toxinLevel}</div>
      </div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">Process Conditions</div>
      <div style="font-size:13px;color:var(--text-2);background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;padding:12px 14px;">${esc(r.conditions)}</div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">About this Reaction</div>
      <div style="font-size:13px;color:var(--text-2);line-height:1.7;">${esc(r.info)}</div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">⚠ Toxins & Hazardous Byproducts</div>
      <div class="modal-toxins">${toxinList}</div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">Real-World Environmental Impact</div>
      <div class="modal-impact">${esc(r.realWorldImpact)}</div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">Annual Waste Estimate</div>
      <div style="font-size:13px;color:var(--warn);font-family:var(--font-mono);background:rgba(245,166,35,0.06);border:1px solid rgba(245,166,35,0.15);padding:10px 14px;border-radius:8px;">${esc(r.annualWaste)}</div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">✦ Green Chemistry Alternatives</div>
      <div class="modal-alts">${altList}</div>
    </div>

    ${principles ? `<div class="modal-section">
      <div class="modal-section-title">Green Chemistry Principles Violated</div>
      <div class="modal-principles">${principles}</div>
    </div>` : ''}

    <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
      <button onclick="askAIAbout('${esc(r.product)}')" style="
        font-family:var(--font-body);font-size:13px;font-weight:500;
        padding:10px 20px;border-radius:100px;border:1px solid rgba(34,217,160,0.3);
        background:rgba(34,217,160,0.08);color:var(--accent);cursor:pointer;transition:all .2s;">
        Ask AI about ${esc(r.product)} →
      </button>
    </div>`;

  document.getElementById('modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(e) {
  if (e.target === document.getElementById('modal')) closeModalBtn();
}
function closeModalBtn() {
  document.getElementById('modal').classList.remove('open');
  document.body.style.overflow = '';
}

function askAIAbout(product) {
  closeModalBtn();
  showSection('ai');
  document.getElementById('chatInput').value =
    `What are the green chemistry alternatives for ${product} production? Give specific improvements.`;
  sendAI();
}

// ── Dashboard Builder ─────────────────────────────────────
function buildDashboard() {
  buildBarChart();
  buildDonut();
  buildHeatmap();
  buildPrinciples();
}

function buildBarChart() {
  const byIndustry = {};
  REACTIONS_DB.forEach(r => {
    if (!byIndustry[r.industry]) byIndustry[r.industry] = [];
    byIndustry[r.industry].push(r.greenScore);
  });

  const rows = Object.entries(byIndustry)
    .map(([ind, scores]) => ({
      label: ind,
      avg: scores.reduce((a,b) => a+b,0) / scores.length
    }))
    .sort((a,b) => a.avg - b.avg);

  const container = document.getElementById('barChart');
  container.innerHTML = rows.map(row => {
    const pct = (row.avg / 10) * 100;
    const color = SCORE_COLORS[Math.round(row.avg)];
    const shortLabel = row.label.replace(' & ', '/').replace('Petrochemicals','Petrochem').replace('Semiconductors','Semicon');
    return `<div class="bar-row">
      <div class="bar-label" title="${row.label}">${shortLabel}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <div class="bar-val">${row.avg.toFixed(1)}</div>
    </div>`;
  }).join('');

  setTimeout(() => {
    container.querySelectorAll('.bar-fill').forEach(b => {
      const w = b.style.width;
      b.style.width = '0';
      setTimeout(() => b.style.width = w, 100);
    });
  }, 200);
}

function buildDonut() {
  const counts = { 'VERY HIGH': 0, 'HIGH': 0, 'MEDIUM': 0, 'LOW': 0 };
  REACTIONS_DB.forEach(r => { if (counts[r.toxinLevel] !== undefined) counts[r.toxinLevel]++; });
  const total  = REACTIONS_DB.length;
  const colors = { 'VERY HIGH': '#f04040', 'HIGH': '#f5a623', 'MEDIUM': '#4eb8f0', 'LOW': '#22d9a0' };

  const wrap = document.getElementById('donutChart');
  let segments = '';
  let offset = 0;
  const r = 52, circ = 2 * Math.PI * r;
  Object.entries(counts).forEach(([level, count]) => {
    if (!count) return;
    const fraction = count / total;
    const dashLen  = fraction * circ;
    const gap      = circ - dashLen;
    segments += `<circle cx="70" cy="70" r="${r}" fill="none"
      stroke="${colors[level]}" stroke-width="14"
      stroke-dasharray="${dashLen} ${gap}"
      stroke-dashoffset="${-offset * circ / (2 * Math.PI * r) * r * 2 * Math.PI}"
      style="stroke-dashoffset:${-offset * circ}"/>`;
    offset += fraction;
  });

  wrap.innerHTML = `
    <div class="donut-svg-wrap">
      <svg id="donutSvg" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r="${r}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="14"/>
        ${segments}
      </svg>
      <div class="donut-center">Toxin<br>Profile</div>
    </div>
    <div class="donut-legend">
      ${Object.entries(counts).map(([level, count]) => `
        <div class="legend-item">
          <div class="legend-dot" style="background:${colors[level]}"></div>
          <span>${level} (${count})</span>
        </div>`).join('')}
    </div>`;
}

function buildHeatmap() {
  const grid   = document.getElementById('heatmap');
  const sorted = [...REACTIONS_DB].sort((a,b) => a.greenScore - b.greenScore);
  const colors  = { 'CRITICAL': '#f04040', 'POOR': '#f5a623', 'MODERATE': '#4eb8f0', 'GOOD': '#22d9a0' };
  const bgAlpha = { 'CRITICAL':'0.25','POOR':'0.2','MODERATE':'0.15','GOOD':'0.18' };

  grid.innerHTML = sorted.map(r => {
    const c    = colors[r.sustainabilityRating] || '#aaa';
    const a    = bgAlpha[r.sustainabilityRating] || '0.1';
    const barW = (r.greenScore / 10) * 100;
    return `<div class="hm-row">
      <div class="hm-label" title="${r.industry}">${r.product}</div>
      <div class="hm-cell" onclick="openModal(REACTIONS_DB.find(x=>x.id==='${r.id}'))"
        style="background:rgba(${hexToRGB(c)},${a});">
        <div style="position:absolute;left:0;top:0;bottom:0;width:${barW}%;background:rgba(${hexToRGB(c)},0.3);"></div>
        <span style="position:relative;z-index:1;">${r.process}</span>
        <span style="position:absolute;right:8px;font-family:var(--font-mono);font-size:9.5px;color:${c}">${r.greenScore}/10</span>
      </div>
    </div>`;
  }).join('');
}

function buildPrinciples() {
  const counts = {};
  for (let i = 1; i <= 12; i++) counts[i] = 0;
  REACTIONS_DB.forEach(r => (r.greenPrinciples || []).forEach(p => { counts[p] = (counts[p]||0)+1; }));
  const max = Math.max(...Object.values(counts));

  const grid = document.getElementById('principlesChart');
  grid.innerHTML = Object.entries(counts).map(([num, count]) => {
    const pct   = count / max;
    const color = pct > 0.6 ? '#f04040' : pct > 0.3 ? '#f5a623' : '#22d9a0';
    return `<div class="principle-item" title="${GREEN_PRINCIPLES[num]}">
      <div class="p-num" style="color:${color}">${num}</div>
      <div class="p-name">${GREEN_PRINCIPLES[num]}</div>
      <div class="p-count" style="color:${color}">${count} reactions</div>
    </div>`;
  }).join('');
}

function hexToRGB(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

// ── AI Advisor (Groq API — llama-3.3-70b-versatile) ──────
function usePrompt(el) {
  document.getElementById('chatInput').value = el.textContent;
}

async function sendAI() {
  if (isAILoading) return;
  const input   = document.getElementById('chatInput');
  const userMsg = input.value.trim();
  if (!userMsg) return;

  input.value  = '';
  isAILoading  = true;
  document.getElementById('sendBtn').disabled = true;

  appendChatMsg(userMsg, 'user');

  const dbSummary = buildDBSummary();
  const typingId  = appendTyping();

  chatHistory.push({ role: 'user', content: userMsg });

  try {
    const systemPrompt = `You are ReacSense AI, an expert green chemistry advisor and industrial sustainability consultant. You have deep knowledge of:
- The 12 Principles of Green Chemistry
- Industrial chemical processes and their environmental impacts
- Sustainable alternatives, cleaner production methods, and circular economy principles
- Toxicology, waste management, and pollution prevention

You have access to the following industrial reaction database summary:
${dbSummary}

When answering:
1. Be specific and actionable — cite real technologies, named processes, and companies where relevant
2. Use the green chemistry principles framework
3. Quantify improvements where possible (e.g. "reduces CO₂ by 70%", "E-factor drops from 40 to 5")
4. Structure longer answers with clear sections
5. Always link recommendations to real-world feasibility
6. Format responses clearly with line breaks between sections

Keep responses focused, scientific, and practical for industrial decision-makers.`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer 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'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1000,
        messages: [
          { role: 'system', content: systemPrompt },
          ...chatHistory
        ]
      })
    });

    removeTyping(typingId);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${response.status}`);
    }

    const data  = await response.json();
    const reply = data.choices[0].message.content;

    chatHistory.push({ role: 'assistant', content: reply });
    appendChatMsg(reply, 'assistant');

  } catch (err) {
    removeTyping(typingId);
    appendChatMsg(
      `Unable to connect to AI service. Please check your Groq API key or internet connection.\n\n**Tip:** You can still use the Search and Dashboard sections — they work fully offline.\n\n_Error: ${err.message}_`,
      'assistant', true
    );
  }

  isAILoading = false;
  document.getElementById('sendBtn').disabled = false;
}

function buildDBSummary() {
  const industries = [...new Set(REACTIONS_DB.map(r => r.industry))];
  const criticals  = REACTIONS_DB.filter(r => r.sustainabilityRating === 'CRITICAL').map(r => r.product);
  const avgScore   = (REACTIONS_DB.reduce((s,r) => s + r.greenScore, 0) / REACTIONS_DB.length).toFixed(1);

  return `Database contains ${REACTIONS_DB.length} industrial reactions across industries: ${industries.join(', ')}.
Average green score: ${avgScore}/10.
Critical sustainability risks: ${criticals.join(', ')}.
Key toxins covered: VCM (PVC production), CS₂ (rayon), cyanide (gold mining), PFCs (aluminium), dioxins (textiles), SO₂ (copper/refining), nitrates (fertilizers).
Green Chemistry principles most frequently violated: Prevention (P1), Less Hazardous Synthesis (P3), Safer Solvents (P5), Renewable Feedstocks (P7), Design for Degradation (P10).`;
}

function appendChatMsg(text, role, isError = false) {
  const win = document.getElementById('chatWindow');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  const initials = role === 'user' ? 'You' : 'RS';
  div.innerHTML = `
    <div class="msg-avatar">${initials}</div>
    <div class="msg-body">${formatAIText(text)}</div>`;
  if (isError) div.querySelector('.msg-body').style.borderColor = 'rgba(240,64,64,0.3)';
  win.appendChild(div);
  win.scrollTop = win.scrollHeight;
}

function appendTyping() {
  const win = document.getElementById('chatWindow');
  const div = document.createElement('div');
  div.className = 'chat-msg assistant';
  const id = 'typing-' + Date.now();
  div.id = id;
  div.innerHTML = `<div class="msg-avatar">RS</div>
    <div class="msg-body"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
  win.appendChild(div);
  win.scrollTop = win.scrollHeight;
  return id;
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function formatAIText(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code style="font-family:var(--font-mono);font-size:12px;background:rgba(255,255,255,0.07);padding:1px 5px;border-radius:3px;">$1</code>')
    .replace(/^#{1,3}\s(.+)$/gm, '<div style="font-family:var(--font-head);font-size:14px;font-weight:600;color:var(--text-1);margin:10px 0 4px;">$1</div>')
    .replace(/^[-•]\s(.+)$/gm, '<div style="padding-left:14px;margin:3px 0">• $1</div>')
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

// ── Animated Background Canvas ────────────────────────────
function initCanvas() {
  const canvas   = document.getElementById('bgCanvas');
  const ctx      = canvas.getContext('2d');
  const ELEMENTS = ['C','H','O','N','S','Fe','Cu','Al','Cl','P','Si','Zn'];
  const COLORS   = ['rgba(34,217,160,', 'rgba(78,184,240,', 'rgba(155,109,255,', 'rgba(245,166,35,'];
  let W, H, nodes, edges;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    build();
  }

  function build() {
    const n = Math.min(Math.floor(W * H / 28000), 60);
    nodes = Array.from({ length: n }, () => ({
      x:   Math.random() * W,
      y:   Math.random() * H,
      vx:  (Math.random() - .5) * .25,
      vy:  (Math.random() - .5) * .25,
      r:   Math.random() * 2.5 + 1.5,
      col: COLORS[Math.random() * COLORS.length | 0],
      lbl: ELEMENTS[Math.random() * ELEMENTS.length | 0],
      ph:  Math.random() * Math.PI * 2,
      ps:  .015 + Math.random() * .015
    }));
    rebuildEdges();
  }

  function rebuildEdges() {
    edges = [];
    for (let i = 0; i < nodes.length; i++)
      for (let j = i+1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        if (dx*dx + dy*dy < 120*120) edges.push([i,j]);
      }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    edges.forEach(([i,j]) => {
      const a = nodes[i], b = nodes[j];
      const d = Math.hypot(b.x-a.x, b.y-a.y);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = `rgba(34,217,160,${(1-d/120)*0.12})`;
      ctx.lineWidth = .6;
      ctx.stroke();
    });

    nodes.forEach(n => {
      n.ph += n.ps;
      const g = Math.sin(n.ph) * .5 + .5;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI*2);
      ctx.fillStyle = n.col + (0.4 + g*.4) + ')';
      ctx.fill();
      n.x += n.vx; n.y += n.vy;
      if (n.x < -10) n.x = W+10;
      if (n.x > W+10) n.x = -10;
      if (n.y < -10) n.y = H+10;
      if (n.y > H+10) n.y = -10;
    });

    if (Math.random() < .015) rebuildEdges();
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();
}

// ── Utility ───────────────────────────────────────────────
function esc(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
