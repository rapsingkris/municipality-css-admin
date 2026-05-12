// ==================== RESPONSES.JS ====================

let officesData = [];
let currentOfficeId = null;

async function fetchOffices() {
  try {
    const { data, error } = await window.supabaseClient
      .from('offices')
      .select('id, name, photo_url')
      .order('name', { ascending: true });

    if (error) { showErrorMessage("Failed to load offices."); return; }
    officesData = data || [];
    renderOffices();
  } catch (err) {
    showErrorMessage("Something went wrong while loading offices.");
  }
}

function renderOffices() {
  const container = document.getElementById('officesGrid');
  container.innerHTML = '';

  if (officesData.length === 0) {
    container.innerHTML = `<p style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--text-light);">No offices found.</p>`;
    return;
  }

  officesData.forEach(office => {
    const card = document.createElement('div');
    card.className = 'office-card';

    const imageSrc = office.photo_url
      ? office.photo_url
      : `https://ui-avatars.com/api/?name=${encodeURIComponent(office.name)}&background=3b82f6&color=fff&size=128`;

    card.innerHTML = `
      <div class="photo-circle">
        <img src="${imageSrc}" alt="${office.name}"
             onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(office.name)}&background=3b82f6&color=fff&size=128'">
      </div>
      <div class="office-info">
        <h3 class="office-name">${office.name}</h3>
      </div>
    `;

    card.addEventListener('click', () => selectOffice(office.id, office.name));
    container.appendChild(card);
  });
}

function showErrorMessage(message) {
  document.getElementById('officesGrid').innerHTML =
    `<p style="grid-column:1/-1;text-align:center;padding:40px;color:#ef4444;">${message}</p>`;
}

async function selectOffice(officeId, officeName) {
  currentOfficeId = officeId;
  document.getElementById('officesGrid').parentElement.style.display = 'none';
  const content = document.getElementById('responsesContent');
  content.style.display = 'block';
  document.getElementById('selectedOfficeTitle').textContent = officeName;
  document.getElementById('exportBtn').style.display = 'flex'; // show export btn
  switchTab(0);
  await loadOverallAnalytics(officeId);
  await loadIndividualResponses(officeId);
  await loadArchivedResponse(officeId);
}

function showOffices() {
  document.getElementById('responsesContent').style.display = 'none';
  document.getElementById('officesGrid').parentElement.style.display = 'block';
  document.getElementById('exportBtn').style.display = 'none'; // hide export btn
  currentOfficeId = null;
}

let currentTabIndex = 0;

function switchTab(tabIndex) {
  currentTabIndex = tabIndex;
  document.querySelectorAll('.tab-btn').forEach((btn, i) => btn.classList.toggle('active', i === tabIndex));
  document.querySelectorAll('.tab-panel').forEach((panel, i) => panel.classList.toggle('active', i === tabIndex));
  const exportBtn = document.getElementById('exportBtn');
  if (!exportBtn) return;
  // Hide on Archived tab, no office selected, or when there are no responses
  const hasResponses = document.querySelector('#tab-all [style*="No responses"]') === null
    && document.querySelector('#tab-all > div')?.innerHTML?.includes('No responses') === false;
  const noResponseMsg = document.querySelector('#tab-all')?.textContent?.includes('No responses for this office yet');
  if (tabIndex === 2 || !currentOfficeId || noResponseMsg) {
    exportBtn.style.display = 'none';
  } else {
    exportBtn.style.display = 'flex';
  }
}

// ══════════════════════════════════════════════════════════════
//  SHARED FETCH HELPER
//  Fetches all three answer types for an office and returns
//  aggregated card arrays split into active / archived.
// ══════════════════════════════════════════════════════════════

async function fetchAggregatedCards(officeId, totalSubmissions) {
  const [
    { data: likertRows,  error: lErr  },
    { data: mcRows,      error: mcErr },
    { data: commentRows, error: cErr  },
    { data: mcOptions,   error: moErr },
  ] = await Promise.all([
    window.supabaseClient
      .from('v_likert_answers')
      .select('question_id, question_text, rating, page_order, question_order, is_active, deactivated_at')
      .eq('office_id', officeId)
      .order('page_order', { ascending: true })
      .order('question_order', { ascending: true }),

    window.supabaseClient
      .from('v_mc_answers')
      .select('question_id, question_text, select_type, answer_text, page_order, question_order, is_active, deactivated_at')
      .eq('office_id', officeId)
      .order('page_order', { ascending: true })
      .order('question_order', { ascending: true }),

    window.supabaseClient
      .from('v_comment_answers')
      .select('question_id, question_text, answer_text, page_order, question_order, is_active, deactivated_at')
      .eq('office_id', officeId)
      .order('page_order', { ascending: true })
      .order('question_order', { ascending: true }),

    window.supabaseClient
      .from('mc_options')
      .select('id, question_id, option_text, option_order')
      .order('option_order', { ascending: true }),
  ]);

  if (lErr)  throw lErr;
  if (mcErr) throw mcErr;
  if (cErr)  throw cErr;
  if (moErr) console.warn('mc_options fetch error:', moErr);

  // Build a map: question_id → ordered option labels
  const optionsMap = new Map();
  (mcOptions || []).forEach(opt => {
    if (!optionsMap.has(opt.question_id)) optionsMap.set(opt.question_id, []);
    optionsMap.get(opt.question_id).push(opt.option_text);
  });

  const likertCards  = aggregateLikert(likertRows   || [], totalSubmissions);
  const mcCards      = aggregateMC(mcRows || [], optionsMap);
  const commentCards = aggregateComments(commentRows || [], totalSubmissions);

  const allCards      = [...likertCards, ...mcCards, ...commentCards];
  const activeCards   = allCards.filter(q => q.is_active !== false);
  const archivedCards = allCards.filter(q => q.is_active === false);

  return { activeCards, archivedCards };
}

// ══════════════════════════════════════════════════════════════
//  OVERALL ANALYTICS TAB
// ══════════════════════════════════════════════════════════════

async function loadOverallAnalytics(officeId) {
  const panel = document.getElementById('tab-all');
  panel.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-light);">Loading responses…</div>`;

  try {
    const { data: surveyRows, error: srErr } = await window.supabaseClient
      .from('survey_responses')
      .select('id, cc1, cc2, cc3')
      .eq('office_id', officeId);

    if (srErr) throw srErr;

    const totalSubmissions = (surveyRows || []).length;

    if (totalSubmissions === 0) {
        panel.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-light);">No responses for this office yet.</div>`;
        document.getElementById('exportBtn').style.display = 'none';
        return;
    }
    const { activeCards } = await fetchAggregatedCards(officeId, totalSubmissions);

    if (activeCards.length === 0) {
      panel.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-light);">No active questions with responses.</div>`;
      return;
    }

    panel.innerHTML = `
      <div style="padding:32px;">
        ${buildCCSection(surveyRows, totalSubmissions)}
        ${activeCards.map(q => buildCard(q)).join('')}
      </div>`;

  } catch (err) {
    console.error('loadOverallAnalytics error:', err);
    panel.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444;">Failed to load analytics. Please try again.</div>`;
  }
}

// ══════════════════════════════════════════════════════════════
//  ARCHIVED RESPONSE TAB
// ══════════════════════════════════════════════════════════════

async function loadArchivedResponse(officeId) {
  const panel = document.getElementById('tab-archived');

  // Placeholder rows — not connected to DB yet
  const placeholderItems = [
    { name: 'Juan dela Cruz',    date: 'Jan 12, 2025', time: '09:14 AM', client: 'Mamamayan', gender: 'Male',   avg: '4.8' },
    { name: 'Maria Santos',      date: 'Jan 13, 2025', time: '10:32 AM', client: 'Negosyo',   gender: 'Female', avg: '3.5' },
    { name: 'Anonymous',         date: 'Jan 14, 2025', time: '02:05 PM', client: 'Gobyerno',  gender: null,     avg: null  },
    { name: 'Pedro Reyes',       date: 'Jan 15, 2025', time: '11:47 AM', client: 'Mamamayan', gender: 'Male',   avg: '2.1' },
    { name: 'Ana Gonzales',      date: 'Jan 16, 2025', time: '03:22 PM', client: 'Negosyo',   gender: 'Female', avg: '5.0' },
    { name: 'Anonymous',         date: 'Jan 17, 2025', time: '08:55 AM', client: 'Mamamayan', gender: null,     avg: '4.2' },
  ];

  const ratingColor = avg =>
    avg === null     ? '#94a3b8'
    : avg >= 4.5     ? '#16a34a'
    : avg >= 3.5     ? '#22c55e'
    : avg >= 2.5     ? '#f59e0b'
    :                  '#ef4444';

  panel.innerHTML = `
    <div class="ind-toolbar">
      <div class="ind-search-wrap">
        <i class="fas fa-search ind-search-icon"></i>
        <input type="text" class="ind-search-input" placeholder="Search by name…" disabled />
      </div>
      <div class="ind-filters">
        <select class="ind-select" disabled>
          <option>All Client Types</option>
        </select>
        <select class="ind-select" disabled>
          <option>All Genders</option>
        </select>
        <select class="ind-select" disabled>
          <option>All Ratings</option>
        </select>
      </div>
    </div>
    <p class="ind-results-count">${placeholderItems.length} archived respondents</p>
    <div class="ind-list">
      ${placeholderItems.map(r => {
        const avg = r.avg ? parseFloat(r.avg).toFixed(1) : null;
        const color = ratingColor(avg !== null ? parseFloat(avg) : null);
        const clientBadge = r.client
          ? `<span class="ind-badge ind-badge--client">${r.client}</span>`
          : '';
        const genderBadge = r.gender
          ? `<span class="ind-badge ind-badge--gender">${r.gender}</span>`
          : '';
        return `
          <div class="ind-row" style="opacity:0.6;cursor:default;">
            <div class="ind-row-left">
              <p class="ind-row-name">${r.name}</p>
              <div class="ind-row-badges">${clientBadge}${genderBadge}</div>
            </div>
            <div class="ind-row-mid">
              <span class="ind-row-datetime"><i class="far fa-calendar-alt"></i> ${r.date}</span>
              <span class="ind-row-datetime"><i class="far fa-clock"></i> ${r.time}</span>
            </div>
            <div class="ind-row-right">
              ${avg !== null
                ? `<span class="ind-rating-chip" style="background:${color}15;color:${color};">${avg} avg</span>`
                : `<span style="color:var(--text-light);font-size:0.82rem;">No rating</span>`}
              <i class="fas fa-chevron-right ind-row-chevron" style="opacity:0.3;"></i>
            </div>
          </div>`;
      }).join('')}
    </div>
    <p style="text-align:center;padding:20px;font-size:0.8rem;color:var(--text-light);font-style:italic;">
      <i class="fas fa-info-circle"></i> Archived responses — database connection coming soon.
    </p>
  `;
}

// ══════════════════════════════════════════════════════════════
//  AGGREGATION HELPERS
// ══════════════════════════════════════════════════════════════

function aggregateLikert(rows, totalSubmissions) {
  const map = new Map();
  rows.forEach(row => {
    if (!map.has(row.question_id)) {
      map.set(row.question_id, {
        type: 'likert',
        text: row.question_text,
        page_order: row.page_order,
        q_order: row.question_order,
        is_active: row.is_active,
        deactivated_at: row.deactivated_at,
        dist: { 5:0, 4:0, 3:0, 2:0, 1:0 },
        naCount: 0,
        total: 0,
      });
    }
    const q = map.get(row.question_id);
    if (row.rating === 'NA') { q.naCount++; }
    else {
      const r = parseInt(row.rating, 10);
      if (r >= 1 && r <= 5) { q.dist[r]++; q.total++; }
    }
  });
  return Array.from(map.values())
    .sort((a, b) => a.page_order - b.page_order || a.q_order - b.q_order)
    .map(q => ({
      type: 'likert',
      text: q.text,
      total: q.total,
      out_of: totalSubmissions,
      dist: q.dist,
      is_active: q.is_active,
      deactivated_at: q.deactivated_at,
    }));
}

function aggregateMC(rows, optionsMap = new Map()) {
  const map = new Map();
  rows.forEach(row => {
    if (!map.has(row.question_id)) {
      map.set(row.question_id, {
        type: 'mc',
        text: row.question_text,
        select_type: row.select_type,
        page_order: row.page_order,
        q_order: row.question_order,
        is_active: row.is_active,
        deactivated_at: row.deactivated_at,
        optionCounts: new Map(),
        total: 0,
      });
    }
    const q = map.get(row.question_id);
    row.answer_text.split(',').map(v => v.trim()).filter(Boolean)
      .forEach(val => q.optionCounts.set(val, (q.optionCounts.get(val) || 0) + 1));
    q.total++;
  });

  return Array.from(map.entries())
    .sort(([, a], [, b]) => a.page_order - b.page_order || a.q_order - b.q_order)
    .map(([questionId, q]) => {
      // Get the full ordered option list from mc_options, fall back to just voted options
      const allOptionLabels = optionsMap.get(questionId) || [];
      let options;
      if (allOptionLabels.length > 0) {
        // Show ALL options in defined order, with 0 counts for unselected
        options = allOptionLabels.map(label => [label, q.optionCounts.get(label) || 0]);
      } else {
        // Fallback: only voted options, sorted by count
        options = Array.from(q.optionCounts.entries()).sort((a, b) => b[1] - a[1]);
      }
      return {
        type: 'mc',
        text: q.text,
        select_type: q.select_type,
        total: q.total,
        options,
        is_active: q.is_active,
        deactivated_at: q.deactivated_at,
      };
    });
}

function aggregateComments(rows, totalSubmissions) {
  const map = new Map();
  rows.forEach(row => {
    if (!map.has(row.question_id)) {
      map.set(row.question_id, {
        type: 'comment',
        text: row.question_text,
        page_order: row.page_order,
        q_order: row.question_order,
        is_active: row.is_active,
        deactivated_at: row.deactivated_at,
        comments: [],
      });
    }
    const trimmed = (row.answer_text || '').trim();
    if (trimmed) map.get(row.question_id).comments.push(trimmed);
  });
  return Array.from(map.values())
    .sort((a, b) => a.page_order - b.page_order || a.q_order - b.q_order)
    .map(q => ({
      type: 'comment',
      text: q.text,
      total: q.comments.length,
      out_of: totalSubmissions,
      comments: q.comments,
      is_active: q.is_active,
      deactivated_at: q.deactivated_at,
    }));
}

// ══════════════════════════════════════════════════════════════
//  CITIZEN'S CHARTER SECTION BUILDER
// ══════════════════════════════════════════════════════════════

function buildCCSection(surveyRows, totalSubmissions) {
  // ── CC1 ───────────────────────────────────────────────────
  const cc1Options = [
    { value: '1', label: 'Alam ko ang CC at nakita ko ito sa napuntahang opisina' },
    { value: '2', label: 'Alam ko ang CC pero hindi ko ito nakita sa napuntahang opisina' },
    { value: '3', label: 'Nalaman ko ang CC nang makita ko ito sa napuntahang opisina' },
    { value: '4', label: 'Hindi ko alam kung ano ang CC at wala akong nakita sa napuntahang opisina' },
  ];

  const cc1Counts = { '1': 0, '2': 0, '3': 0, '4': 0 };
  let cc1Total = 0;
  surveyRows.forEach(r => {
    if (r.cc1) {
      // cc1 may be stored as comma-separated if multi-select, or single value
      r.cc1.split(',').map(v => v.trim()).filter(Boolean).forEach(v => {
        if (cc1Counts[v] !== undefined) { cc1Counts[v]++; cc1Total++; }
      });
    }
  });

  // ── CC2 ───────────────────────────────────────────────────
  const cc2Options = [
    { value: '1', label: 'Madaling makita' },
    { value: '2', label: 'Medyo madaling makita' },
    { value: '3', label: 'Mahirap makita' },
    { value: '4', label: 'Hindi makita' },
    { value: '5', label: 'Hindi angkop' },
  ];

  const cc2Counts = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  let cc2Total = 0;
  surveyRows.forEach(r => {
    if (r.cc2) {
      r.cc2.split(',').map(v => v.trim()).filter(Boolean).forEach(v => {
        if (cc2Counts[v] !== undefined) { cc2Counts[v]++; cc2Total++; }
      });
    }
  });

  // ── CC3 ───────────────────────────────────────────────────
  const cc3Options = [
    { value: '1', label: 'Sobrang nakatulong' },
    { value: '2', label: 'Nakatulong naman' },
    { value: '3', label: 'Hindi nakatulong' },
    { value: '4', label: 'Hindi angkop' },
  ];

  const cc3Counts = { '1': 0, '2': 0, '3': 0, '4': 0 };
  let cc3Total = 0;
  surveyRows.forEach(r => {
    if (r.cc3) {
      r.cc3.split(',').map(v => v.trim()).filter(Boolean).forEach(v => {
        if (cc3Counts[v] !== undefined) { cc3Counts[v]++; cc3Total++; }
      });
    }
  });

  function buildCCCard(label, tagLabel, options, counts, selectionTotal) {
    const maxCount = Math.max(...Object.values(counts), 1);
    const answered = surveyRows.filter(r => r[label.toLowerCase()] != null && r[label.toLowerCase()] !== '').length;
    const responsePct = Math.round((answered / totalSubmissions) * 100);

    return `
      <div class="q-card q-card--cc">
        <div class="cc-card-header">
          <span class="cc-tag">${tagLabel}</span>
          <p class="q-title" style="margin:0;">${getCCQuestion(tagLabel)}</p>
        </div>
        <p class="q-meta" style="margin:8px 0 20px;">
          ${answered} out of ${totalSubmissions} Responses &mdash; ${responsePct}% Response Rate
        </p>
        <div class="q-mc-list">
          ${options.map(opt => {
            const c        = counts[opt.value] || 0;
            const pct      = selectionTotal > 0 ? Math.round((c / selectionTotal) * 100) : 0;
            const barWidth = Math.round((c / maxCount) * 100);
            return `
              <div class="q-bar-row">
                <span class="q-mc-label">${escapeHtml(opt.label)}</span>
                <div class="q-bar-track">
                  <div class="q-bar-fill q-bar-fill--cc" style="width:${barWidth}%"></div>
                </div>
                <span class="q-bar-count">${c}&nbsp;&nbsp;<span class="q-bar-pct">(${pct}%)</span></span>
              </div>`;
          }).join('')}
        </div>
        <p class="q-bar-note" style="margin-top:12px;">Percentages based on total selections (multi-select)</p>
      </div>`;
  }

  function getCCQuestion(tag) {
    if (tag === 'CC1') return 'Alin sa mga sumusunod ang naglalarawan sa iyong kaalaman sa CC?';
    if (tag === 'CC2') return 'Kung alam ang CC, masasabi mo ba na ang CC nang napuntahang opisina ay…';
    if (tag === 'CC3') return 'Kung alam ang CC, gaano nakatulong ang CC sa transaksyon mo?';
    return '';
  }

  return `
    <div class="cc-section">
      <div class="cc-section-header">
        <i class="fas fa-id-card"></i>
        <span>Citizen's Charter (CC) Responses</span>
      </div>
      ${buildCCCard('cc1', 'CC1', cc1Options, cc1Counts, cc1Total)}
      ${buildCCCard('cc2', 'CC2', cc2Options, cc2Counts, cc2Total)}
      ${buildCCCard('cc3', 'CC3', cc3Options, cc3Counts, cc3Total)}
    </div>`;
}

// ══════════════════════════════════════════════════════════════
//  UNIFIED CARD DISPATCHER
// ══════════════════════════════════════════════════════════════

function buildCard(q, isArchived = false) {
  if (q.type === 'likert')  return buildLikertCard(q, isArchived);
  if (q.type === 'mc')      return buildMcCard(q, isArchived);
  if (q.type === 'comment') return buildCommentCard(q, isArchived);
  return '';
}

// ══════════════════════════════════════════════════════════════
//  CARD BUILDERS
// ══════════════════════════════════════════════════════════════

function buildArchivedMeta(deactivated_at) {
  const dateStr = deactivated_at
    ? new Date(deactivated_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
    : null;
  return `<p class="q-archived-note">
    <i class="fas fa-archive"></i>
    Archived${dateStr ? ` on ${dateStr}` : ''} — responses below were collected while this question was active.
  </p>`;
}

function buildLikertCard(q, isArchived = false) {
  const avg = q.total > 0
    ? (Object.entries(q.dist).reduce((s, [k, v]) => s + Number(k) * v, 0) / q.total).toFixed(1)
    : '—';
  const maxCount    = Math.max(...Object.values(q.dist), 1);
  const responsePct = Math.round((q.total / q.out_of) * 100);

  return `
    <div class="q-card q-card--likert ${isArchived ? 'q-card--archived' : ''}">
      <p class="q-title">${escapeHtml(q.text)}</p>
      ${isArchived ? buildArchivedMeta(q.deactivated_at) : ''}
      <p class="q-meta">${q.total} out of ${q.out_of} Responses &mdash; ${responsePct}% Response Rate</p>
      <div class="q-body">
        <div class="q-avg-box">
          <span class="q-avg-num">${avg}</span>
          <span class="q-avg-label">Average Rating</span>
        </div>
        <div class="q-bars">
          ${[5,4,3,2,1].map(star => {
            const c       = q.dist[star];
            const barPct  = Math.round((c / maxCount) * 100);
            const ofTotal = Math.round((c / q.out_of) * 100);
            return `
              <div class="q-bar-row">
                <span class="q-bar-label">${star}</span>
                <div class="q-bar-track">
                  <div class="q-bar-fill ${isArchived ? 'q-bar-fill--archived' : 'q-bar-fill--likert'}" style="width:${barPct}%"></div>
                </div>
                <span class="q-bar-count">${c}&nbsp;&nbsp;<span class="q-bar-pct">(${ofTotal}%)</span></span>
              </div>`;
          }).join('')}
          <p class="q-bar-note">Percentages are based on total submissions</p>
        </div>
      </div>
    </div>`;
}

function buildMcCard(q, isArchived = false) {
  const typeLabel = q.select_type === 'checkbox' ? 'Checkbox (multi-select)' : 'Single Choice';
  const maxCount  = Math.max(...q.options.map(o => o[1]), 1);

  return `
    <div class="q-card q-card--mc ${isArchived ? 'q-card--archived' : ''}">
      <p class="q-title">${escapeHtml(q.text)}</p>
      ${isArchived ? buildArchivedMeta(q.deactivated_at) : ''}
      <p class="q-meta">${q.total} Responses &mdash; ${typeLabel}</p>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${q.options.map(([label, c]) => {
          const pct      = Math.round((c / q.total) * 100);
          const barWidth = Math.round((c / maxCount) * 100);
          const checked  = c > 0;
          return `
            <div style="display:flex;align-items:center;gap:12px;">
              <span style="
                width:16px;height:16px;border-radius:4px;flex-shrink:0;
                border:2px solid ${checked ? (isArchived ? '#94a3b8' : '#22c55e') : '#cbd5e1'};
                background:${checked ? (isArchived ? '#94a3b8' : '#22c55e') : '#fff'};
                display:inline-flex;align-items:center;justify-content:center;">
                ${checked ? `<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
              </span>
              <span class="q-mc-label" style="color:${checked ? 'var(--text-dark)' : 'var(--text-light)'};">${escapeHtml(label)}</span>
              <div class="q-bar-track" style="flex:1;">
                <div class="q-bar-fill ${isArchived ? 'q-bar-fill--archived' : 'q-bar-fill--mc'}" style="width:${barWidth}%;background:${isArchived ? '' : checked ? 'linear-gradient(90deg,#22c55e,#4ade80)' : '#e8eaf0'};"></div>
              </div>
              <span class="q-bar-count">${c}&nbsp;&nbsp;<span class="q-bar-pct">(${pct}%)</span></span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

function buildCommentCard(q, isArchived = false) {
  const responsePct = q.out_of > 0 ? Math.round((q.total / q.out_of) * 100) : 0;

  return `
    <div class="q-card q-card--comment ${isArchived ? 'q-card--archived' : ''}">
      <p class="q-title">${escapeHtml(q.text)}</p>
      ${isArchived ? buildArchivedMeta(q.deactivated_at) : ''}
      <p class="q-meta">${q.total} out of ${q.out_of} Responses &mdash; ${responsePct}% Response Rate</p>
      <p class="q-comment-count">${q.comments.length} Comment${q.comments.length !== 1 ? 's' : ''}</p>
      ${q.comments.length === 0
        ? `<p style="color:var(--text-light);font-size:0.88rem;font-style:italic;">No comments submitted.</p>`
        : `<div class="q-comment-scroll">
            ${q.comments.map(c => `<div class="q-comment-bubble">${escapeHtml(c)}</div>`).join('')}
           </div>`}
    </div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ══════════════════════════════════════════════════════════════
//  INDIVIDUAL RESPONSES TAB
// ══════════════════════════════════════════════════════════════

let allSubmissions = []; // cache for search/filter

async function loadIndividualResponses(officeId) {
  const panel = document.getElementById('tab-analytics');
  panel.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-light);">Loading…</div>`;

  try {
    const { data: submissions, error } = await window.supabaseClient
      .from('v_submission_summary')
      .select('response_id, submitted_at, first_name, last_name, avg_likert_rating, client_type, gender')
      .eq('office_id', officeId)
      .order('submitted_at', { ascending: false });

    if (error) throw error;

    if (!submissions || submissions.length === 0) {
      panel.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-light);">No individual responses yet.</div>`;
      return;
    }

    allSubmissions = submissions;

// Derive unique years from submissions data
const uniqueYears = [...new Set(
  submissions
    .map(r => r.submitted_at ? new Date(r.submitted_at).getFullYear() : null)
    .filter(Boolean)
)].sort((a, b) => b - a); // descending

panel.innerHTML = `
  <!-- Search + Filter Bar -->
  <div class="ind-toolbar">
    <div class="ind-search-wrap">
      <i class="fas fa-search ind-search-icon"></i>
      <input
        type="text"
        id="indSearchInput"
        class="ind-search-input"
        placeholder="Search by name…"
        oninput="filterSubmissions()"
      />
    </div>
    <div class="ind-filters">
      <select id="indFilterClientType" class="ind-select" onchange="filterSubmissions()">
        <option value="">All Client Types</option>
        <option value="Mamamayan">Mamamayan</option>
        <option value="Negosyo">Negosyo</option>
        <option value="Gobyerno">Gobyerno</option>
      </select>
      <select id="indFilterMonth" class="ind-select" onchange="filterSubmissions()">
        <option value="">All Months</option>
        <option value="0">January</option>
        <option value="1">February</option>
        <option value="2">March</option>
        <option value="3">April</option>
        <option value="4">May</option>
        <option value="5">June</option>
        <option value="6">July</option>
        <option value="7">August</option>
        <option value="8">September</option>
        <option value="9">October</option>
        <option value="10">November</option>
        <option value="11">December</option>
      </select>
      <select id="indFilterYear" class="ind-select" onchange="filterSubmissions()">
        <option value="">All Years</option>
        ${uniqueYears.map(y => `<option value="${y}">${y}</option>`).join('')}
      </select>
      <select id="indFilterRating" class="ind-select" onchange="filterSubmissions()">
        <option value="">All Ratings</option>
        <option value="5">5.0</option>
        <option value="4">4.0 – 4.9</option>
        <option value="3">3.0 – 3.9</option>
        <option value="2">2.0 – 2.9</option>
        <option value="1">Below 2.0</option>
      </select>
    </div>
  </div>
  <!-- Results count -->
  <p class="ind-results-count" id="indResultsCount"></p>
  <!-- Cards Grid -->
  <div class="ind-list" id="indCardsGrid"></div>
`;

filterSubmissions();

  } catch (err) {
    console.error('loadIndividualResponses error:', err);
    panel.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444;">Failed to load responses.</div>`;
  }
}

function filterSubmissions() {
  const search     = (document.getElementById('indSearchInput')?.value || '').toLowerCase();
  const clientType = document.getElementById('indFilterClientType')?.value || '';
  const month      = document.getElementById('indFilterMonth')?.value ?? '';
  const year       = document.getElementById('indFilterYear')?.value || '';
  const ratingBand = document.getElementById('indFilterRating')?.value || '';

  const filtered = allSubmissions.filter(r => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ').toLowerCase();
    if (search && !name.includes(search)) return false;
    if (clientType && r.client_type !== clientType) return false;
    if (month !== '' || year) {
        const d = r.submitted_at ? new Date(r.submitted_at) : null;
    if (!d) return false;
    if (month !== '' && d.getMonth() !== Number(month)) return false;
    if (year && d.getFullYear() !== Number(year)) return false;
    }
    if (ratingBand) {
      const avg = r.avg_likert_rating != null ? Number(r.avg_likert_rating) : null;
      if (avg === null) return false;
      if (ratingBand === '5' && avg < 5.0) return false;
      if (ratingBand === '4' && (avg < 4.0 || avg >= 5.0)) return false;
      if (ratingBand === '3' && (avg < 3.0 || avg >= 4.0)) return false;
      if (ratingBand === '2' && (avg < 2.0 || avg >= 3.0)) return false;
      if (ratingBand === '1' && avg !== null && avg >= 2.0) return false;
    }
    return true;
  });

  const countEl = document.getElementById('indResultsCount');
  if (countEl) {
    countEl.textContent = filtered.length === allSubmissions.length
      ? `${allSubmissions.length} respondent${allSubmissions.length !== 1 ? 's' : ''}`
      : `${filtered.length} of ${allSubmissions.length} respondents`;
  }

  const grid = document.getElementById('indCardsGrid');
  if (!grid) return;

  if (filtered.length === 0) {
    grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-light);">No respondents match your search.</p>`;
    return;
  }

  grid.innerHTML = filtered.map(r => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Anonymous';

    const avg = r.avg_likert_rating != null ? Number(r.avg_likert_rating).toFixed(1) : null;
    const ratingColor = avg === null ? '#94a3b8'
      : avg >= 4.5 ? '#16a34a'
      : avg >= 3.5 ? '#22c55e'
      : avg >= 2.5 ? '#f59e0b'
      : '#ef4444';

    const dateStr = r.submitted_at
      ? new Date(r.submitted_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
      : '—';

    const timeStr = r.submitted_at
      ? new Date(r.submitted_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true })
      : '';

    const clientTypeBadge = r.client_type
      ? `<span class="ind-badge ind-badge--client">${escapeHtml(r.client_type)}</span>`
      : '';

    const genderBadge = r.gender
      ? `<span class="ind-badge ind-badge--gender">${escapeHtml(r.gender)}</span>`
      : '';

    return `
      <div class="ind-row" onclick="viewIndividualResponse('${r.response_id}')">
        <div class="ind-row-left">
          <p class="ind-row-name">${escapeHtml(name)}</p>
          <div class="ind-row-badges">
            ${clientTypeBadge}
            ${genderBadge}
          </div>
        </div>
        <div class="ind-row-mid">
          <span class="ind-row-datetime">
            <i class="far fa-calendar-alt"></i> ${dateStr}
          </span>
          ${timeStr ? `<span class="ind-row-datetime"><i class="far fa-clock"></i> ${timeStr}</span>` : ''}
        </div>
        <div class="ind-row-right">
          ${avg !== null ? `
            <span class="ind-rating-chip" style="background:${ratingColor}15;color:${ratingColor};">
              ${avg} avg
            </span>` : '<span style="color:var(--text-light);font-size:0.82rem;">No rating</span>'}
          <i class="fas fa-chevron-right ind-row-chevron"></i>
        </div>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
//  INDIVIDUAL RESPONSE DETAIL MODAL
// ══════════════════════════════════════════════════════════════

async function viewIndividualResponse(responseId) {
  const modal = document.getElementById('responseDetailModal');
  if (!modal) return;

  document.getElementById('responseDetailName').textContent = 'Loading…';
  document.getElementById('responseDetailDate').textContent = '';
  document.getElementById('responseDetailAnswers').innerHTML =
    `<div style="padding:20px;text-align:center;color:var(--text-light);">Fetching answers…</div>`;
  modal.style.display = 'flex';

  try {
    const [
      { data: likertAnswers  },
      { data: mcAnswers      },
      { data: commentAnswers },
      { data: surveyRow      },
    ] = await Promise.all([
      window.supabaseClient.from('v_likert_answers')
        .select('question_text, rating, page_order, question_order, is_active')
        .eq('response_id', responseId).order('page_order').order('question_order'),

      window.supabaseClient.from('v_mc_answers')
        .select('question_text, answer_text, select_type, page_order, question_order, question_id, is_active')
        .eq('response_id', responseId).order('page_order').order('question_order'),

      window.supabaseClient.from('v_comment_answers')
        .select('question_text, answer_text, page_order, question_order, is_active')
        .eq('response_id', responseId).order('page_order').order('question_order'),

      window.supabaseClient.from('survey_responses')
        .select('first_name, last_name, email, response_date, gender, age, client_type, region, transaction_type, submitted_at, cc1, cc2, cc3, suggestions')
        .eq('id', responseId).single(),
    ]);

    // ── Fetch full MC option lists for this response ───────
    const mcQuestionIds = (mcAnswers || []).map(a => a.question_id).filter(Boolean);
    let mcOptionsForModal = [];
    if (mcQuestionIds.length > 0) {
      const { data: optRows } = await window.supabaseClient
        .from('mc_options')
        .select('question_id, option_text, option_order')
        .in('question_id', mcQuestionIds)
        .order('option_order', { ascending: true });
      mcOptionsForModal = optRows || [];
    }
    const modalOptionsMap = new Map();
    mcOptionsForModal.forEach(opt => {
      if (!modalOptionsMap.has(opt.question_id)) modalOptionsMap.set(opt.question_id, []);
      modalOptionsMap.get(opt.question_id).push(opt.option_text);
    });

    const name = surveyRow
      ? [surveyRow.first_name, surveyRow.last_name].filter(Boolean).join(' ') || 'Anonymous'
      : 'Anonymous';

    const submittedDate = surveyRow?.submitted_at
      ? new Date(surveyRow.submitted_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
      : '—';
    const submittedTime = surveyRow?.submitted_at
      ? new Date(surveyRow.submitted_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true })
      : '';

    document.getElementById('responseDetailName').textContent = name;
    document.getElementById('responseDetailDate').textContent =
      submittedDate + (submittedTime ? ' · ' + submittedTime : '');

    // ── Personal Info Card ─────────────────────────────────
    const responseDate = surveyRow?.response_date
      ? new Date(surveyRow.response_date).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
      : null;

    const infoFields = [
      { icon: 'fa-envelope',       label: 'Email',                   value: surveyRow?.email           || null },
      { icon: 'fa-calendar-day',   label: 'Petsa',                   value: responseDate               || null },
      { icon: 'fa-venus-mars',     label: 'Kasarian',                 value: surveyRow?.gender          || null },
      { icon: 'fa-hashtag',        label: 'Edad',                     value: surveyRow?.age             || null },
      { icon: 'fa-user-tag',       label: 'Uri ng Kliyente',          value: surveyRow?.client_type     || null },
      { icon: 'fa-map-marker-alt', label: 'Rehiyon',                  value: surveyRow?.region          || null },
      { icon: 'fa-exchange-alt',   label: 'Uri ng Transaksyon',       value: surveyRow?.transaction_type|| null },
    ].filter(f => f.value !== null && String(f.value).trim() !== '');

    const personalInfoHtml = `
      <div class="modal-info-card">
        <div class="modal-info-header">
          <i class="fas fa-user-circle"></i>
          <span>Personal Information</span>
        </div>
        <div class="modal-info-grid">
          ${infoFields.map(f => `
            <div class="modal-info-field">
              <span class="modal-info-label">
                <i class="fas ${f.icon}"></i> ${f.label}
              </span>
              <span class="modal-info-value">${escapeHtml(String(f.value))}</span>
            </div>`).join('')}
          ${infoFields.length === 0
            ? `<p style="color:var(--text-light);font-size:0.85rem;font-style:italic;grid-column:1/-1;">No personal info provided.</p>`
            : ''}
        </div>
      </div>`;

    // ── Survey Answers ─────────────────────────────────────
    const likertLabels = { 5:'Very Satisfied', 4:'Satisfied', 3:'Neutral', 2:'Dissatisfied', 1:'Very Dissatisfied' };
    const likertColors = { 5:'#16a34a', 4:'#22c55e', 3:'#f59e0b', 2:'#ef4444', 1:'#dc2626' };

    const allAnswers = [
      ...(likertAnswers  || []).map(a => ({ ...a, type: 'likert'  })),
      ...(mcAnswers      || []).map(a => ({ ...a, type: 'mc'      })),
      ...(commentAnswers || []).map(a => ({ ...a, type: 'comment' })),
    ].sort((a, b) => a.page_order - b.page_order || a.question_order - b.question_order);

    const answersHtml = allAnswers.length === 0
      ? `<p style="color:var(--text-light);">No answers recorded.</p>`
      : `<div class="modal-answers-header">
           <i class="fas fa-clipboard-list"></i>
           <span>Survey Answers</span>
         </div>
         <div class="modal-answers-list">
           ${allAnswers.map(a => {
             if (a.type === 'likert') {
               if (a.rating === 'NA') return `
                 <div class="detail-answer-card">
                   <p class="detail-question">${escapeHtml(a.question_text)}</p>
                   <span style="color:var(--text-light);font-size:0.88rem;">N/A</span>
                 </div>`;
               const val   = parseInt(a.rating, 10);
               const stars = '★'.repeat(val) + '☆'.repeat(5 - val);
               return `
                 <div class="detail-answer-card">
                   <p class="detail-question">${escapeHtml(a.question_text)}</p>
                   <div class="detail-likert">
                     <span class="detail-stars" style="color:#f59e0b;">${stars}</span>
                     <span class="detail-likert-label" style="color:${likertColors[val]};">${likertLabels[val] || ''}</span>
                   </div>
                 </div>`;
             }
             if (a.type === 'mc') {
               const selectedVals = a.answer_text.split(',').map(v => v.trim()).filter(Boolean);
               const allOpts = modalOptionsMap.get(a.question_id) || selectedVals;
               return `
                 <div class="detail-answer-card">
                   <p class="detail-question">${escapeHtml(a.question_text)}</p>
                   <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px;">
                     ${allOpts.map(opt => {
                       const checked = selectedVals.includes(opt);
                       return `
                         <label style="display:flex;align-items:center;gap:10px;cursor:default;">
                           <span style="
                             width:16px;height:16px;border-radius:4px;flex-shrink:0;
                             border:2px solid ${checked ? '#22c55e' : '#cbd5e1'};
                             background:${checked ? '#22c55e' : '#fff'};
                             display:inline-flex;align-items:center;justify-content:center;">
                             ${checked ? `<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
                           </span>
                           <span style="font-size:0.875rem;color:${checked ? 'var(--text-dark)' : 'var(--text-light)'};font-weight:${checked ? '500' : '400'};">
                             ${escapeHtml(opt)}
                           </span>
                         </label>`;
                     }).join('')}
                   </div>
                 </div>`;
             }
             return `
               <div class="detail-answer-card">
                 <p class="detail-question">${escapeHtml(a.question_text)}</p>
                 <p class="detail-comment">${escapeHtml(a.answer_text)}</p>
               </div>`;
           }).join('')}
         </div>`;

    // ── CC Answers ─────────────────────────────────────────
    const ccQuestions = [
      {
        tag: 'CC1',
        question: 'Alin sa mga sumusunod ang naglalarawan sa iyong kaalaman sa CC?',
        value: surveyRow?.cc1 || '',
        options: [
          { value: '1', label: 'Alam ko ang CC at nakita ko ito sa napuntahang opisina' },
          { value: '2', label: 'Alam ko ang CC pero hindi ko ito nakita sa napuntahang opisina' },
          { value: '3', label: 'Nalaman ko ang CC nang makita ko ito sa napuntahang opisina' },
          { value: '4', label: 'Hindi ko alam kung ano ang CC at wala akong nakita sa napuntahang opisina' },
        ],
      },
      {
        tag: 'CC2',
        question: 'Kung alam ang CC, masasabi mo ba na ang CC nang napuntahang opisina ay…',
        value: surveyRow?.cc2 || '',
        options: [
          { value: '1', label: 'Madaling makita' },
          { value: '2', label: 'Medyo madaling makita' },
          { value: '3', label: 'Mahirap makita' },
          { value: '4', label: 'Hindi makita' },
          { value: '5', label: 'Hindi angkop' },
        ],
      },
      {
        tag: 'CC3',
        question: 'Kung alam ang CC, gaano nakatulong ang CC sa transaksyon mo?',
        value: surveyRow?.cc3 || '',
        options: [
          { value: '1', label: 'Sobrang nakatulong' },
          { value: '2', label: 'Nakatulong naman' },
          { value: '3', label: 'Hindi nakatulong' },
          { value: '4', label: 'Hindi angkop' },
        ],
      },
    ];

    const ccHtml = `
      <div class="modal-answers-header" style="margin-top:4px;">
        <i class="fas fa-id-card" style="color:#0891b2;"></i>
        <span>Citizen's Charter Answers</span>
      </div>
      <div class="modal-answers-list" style="margin-bottom:20px;">
        ${ccQuestions.map(cc => {
          const selected = cc.value
            ? cc.value.split(',').map(v => v.trim()).filter(Boolean)
            : [];
          return `
            <div class="detail-answer-card" style="padding:0;overflow:hidden;">
              <div style="display:flex;align-items:stretch;">

                <!-- Tag column -->
                <div style="background:#e0f2fe;display:flex;align-items:center;justify-content:center;padding:0 14px;flex-shrink:0;border-right:1px solid #bae6fd;">
                  <span style="color:#0369a1;font-size:0.78rem;font-weight:700;letter-spacing:0.04em;">${cc.tag}</span>
                </div>

                <!-- Question + options -->
                <div style="flex:1;padding:14px 16px;">
                  <p class="detail-question" style="margin:0 0 12px;">${escapeHtml(cc.question)}</p>
                  <div style="display:flex;flex-direction:column;gap:8px;">
                    ${cc.options.map(opt => {
                      const checked = selected.includes(opt.value);
                      return `
                        <label style="display:flex;align-items:center;gap:10px;cursor:default;">
                          <span style="
                            width:16px;height:16px;border-radius:4px;flex-shrink:0;
                            border:2px solid ${checked ? '#0891b2' : '#cbd5e1'};
                            background:${checked ? '#0891b2' : '#fff'};
                            display:inline-flex;align-items:center;justify-content:center;">
                            ${checked ? `<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
                          </span>
                            <span style="font-size:0.875rem;color:${checked ? 'var(--text-dark)' : 'var(--text-light)'};font-weight:${checked ? '500' : '400'};">                            ${escapeHtml(opt.label)}
                          </span>
                        </label>`;
                    }).join('')}
                  </div>
                  ${selected.length === 0 ? `<p style="margin:8px 0 0;font-size:0.78rem;color:var(--text-light);font-style:italic;">No answer provided.</p>` : ''}
                </div>

              </div>
            </div>`;
        }).join('')}
      </div>`;

    document.getElementById('responseDetailAnswers').innerHTML =
      personalInfoHtml + ccHtml + answersHtml;

  } catch (err) {
    console.error('viewIndividualResponse error:', err);
    document.getElementById('responseDetailAnswers').innerHTML =
      `<p style="color:#ef4444;">Failed to load this response.</p>`;
  }
}

// ══════════════════════════════════════════════════════════════
//  EXPORT TO EXCEL  (ExcelJS — full styling support)
// ══════════════════════════════════════════════════════════════

// ── Palette ──────────────────────────────────────────────────
const XL = {
  navy:      { argb: 'FF1E3A5F' },
  teal:      { argb: 'FF0891B2' },
  green:     { argb: 'FF16A34A' },
  lightBlue: { argb: 'FFE0F2FE' },
  lightGreen:{ argb: 'FFF0FDF4' },
  lightGrey: { argb: 'FFF8FAFC' },
  midGrey:   { argb: 'FFE8EAF0' },
  white:     { argb: 'FFFFFFFF' },
  textDark:  { argb: 'FF1E293B' },
  textMid:   { argb: 'FF64748B' },
};

function xlHeaderRow(ws, values, bgColor = XL.navy) {
  const row = ws.addRow(values);
  row.eachCell(cell => {
    cell.font = { name: 'Arial', bold: true, size: 10, color: XL.white };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: bgColor };
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    cell.border = {
      bottom: { style: 'thin', color: XL.midGrey },
    };
  });
  row.height = 22;
  return row;
}

function xlSubHeader(ws, values) {
  return xlHeaderRow(ws, values, XL.teal);
}

function xlDataRow(ws, values, shade = false) {
  const row = ws.addRow(values);
  row.eachCell(cell => {
    cell.font = { name: 'Arial', size: 10, color: XL.textDark };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: shade ? XL.lightGrey : XL.white };
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'hair', color: XL.midGrey } };
  });
  row.height = 18;
  return row;
}

function xlTitle(ws, text, colSpan) {
  ws.addRow([]);
  const row = ws.addRow([text]);
  const cell = row.getCell(1);
  cell.font = { name: 'Arial', bold: true, size: 13, color: XL.navy };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: XL.lightBlue };
  cell.alignment = { horizontal: 'left', vertical: 'middle' };
  if (colSpan > 1) ws.mergeCells(row.number, 1, row.number, colSpan);
  row.height = 28;
  ws.addRow([]);
  return row;
}

function xlSetColWidths(ws, widths) {
  ws.columns = widths.map(w => ({ width: w }));
}

// ── Auto-fit columns and rows ─────────────────────────────────
function xlAutoFit(ws) {
  // Auto column widths based on content
  ws.columns.forEach(col => {
    let maxLen = 10;
    col.eachCell({ includeEmpty: false }, cell => {
      const val = cell.value == null ? '' : String(cell.value);
      const lines = val.split('\n');
      const longest = Math.max(...lines.map(l => l.length));
      if (longest > maxLen) maxLen = longest;
    });
    col.width = Math.min(Math.max(maxLen + 2, col.width || 10), 80);
  });

  // Auto row heights based on wrap content
  ws.eachRow({ includeEmpty: false }, row => {
    let maxLines = 1;
    row.eachCell({ includeEmpty: false }, cell => {
      const val = cell.value == null ? '' : String(cell.value);
      const colWidth = ws.getColumn(cell.col).width || 20;
      const wrapped = cell.alignment?.wrapText
        ? Math.ceil(val.length / Math.max(colWidth - 2, 1))
        : 1;
      const newlines = (val.match(/\n/g) || []).length + 1;
      maxLines = Math.max(maxLines, wrapped, newlines);
    });
    if (maxLines > 1) row.height = Math.min(Math.max(maxLines * 15, row.height || 15), 120);
  });
}

function xlAddCoverSheet(wb, officeName, tabLabel) {
  const ws = wb.addWorksheet('Cover');
  ws.addRow([]);
  const titleRow = ws.addRow([`${officeName} — ${tabLabel} Export`]);
  titleRow.getCell(1).font = { name: 'Arial', bold: true, size: 16, color: XL.navy };
  titleRow.getCell(1).alignment = { horizontal: 'left' };
  titleRow.height = 32;

  ws.addRow([]);
  const dateRow = ws.addRow([`Generated: ${new Date().toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' })}`]);
  dateRow.getCell(1).font = { name: 'Arial', size: 10, color: XL.textMid };

  ws.addRow([`Office: ${officeName}`]).getCell(1).font = { name: 'Arial', size: 10, color: XL.textMid };
  ws.addRow([`Tab: ${tabLabel}`]).getCell(1).font     = { name: 'Arial', size: 10, color: XL.textMid };
  ws.columns = [{ width: 60 }];

  // Accent bar in column A rows 1–6
  for (let r = 1; r <= 6; r++) {
    const cell = ws.getCell(r, 1);
    if (r === 2) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: XL.lightBlue };
    }
  }
}

async function exportCurrentTab() {
  if (!currentOfficeId) return;
  const btn = document.getElementById('exportBtn');
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting…';
  btn.disabled = true;

  try {
    const officeName = document.getElementById('selectedOfficeTitle').textContent || 'Office';
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Luisiana CSS';
    wb.created = new Date();

    const tabNames = ['Overall Response', 'Individual Responses', 'Archived Response'];
    const label    = tabNames[currentTabIndex];

    if (currentTabIndex === 0)      await exportOverallTab(wb, officeName);
    else if (currentTabIndex === 1) await exportIndividualTab(wb, officeName);
    else if (currentTabIndex === 2) await exportArchivedTab(wb, officeName);

    // Download
    const buffer   = await wb.xlsx.writeBuffer();
    const blob     = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    a.href         = url;
    a.download     = `${officeName}_${label.replace(/ /g,'_')}_${new Date().toISOString().slice(0,10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);

  } catch (err) {
    console.error('Export error:', err);
    alert('Export failed. Please try again.');
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled  = false;
  }
}

// ── CC label helpers ──────────────────────────────────────────
const CC1_LABELS = {
  '1': 'Alam ko ang CC at nakita ko ito sa napuntahang opisina',
  '2': 'Alam ko ang CC pero hindi ko ito nakita sa napuntahang opisina',
  '3': 'Nalaman ko ang CC nang makita ko ito sa napuntahang opisina',
  '4': 'Hindi ko alam kung ano ang CC at wala akong nakita sa napuntahang opisina',
};
const CC2_LABELS = {
  '1': 'Madaling makita', '2': 'Medyo madaling makita',
  '3': 'Mahirap makita',  '4': 'Hindi makita', '5': 'Hindi angkop',
};
const CC3_LABELS = {
  '1': 'Sobrang nakatulong', '2': 'Nakatulong naman',
  '3': 'Hindi nakatulong',   '4': 'Hindi angkop',
};

function decodeCCValue(raw, labelMap) {
  if (!raw) return '';
  return raw.split(',').map(v => labelMap[v.trim()] || v.trim()).join('; ');
}

// ── Overall tab — single consolidated sheet ───────────────────
async function exportOverallTab(wb, officeName) {
  const { data: surveyRows } = await window.supabaseClient
    .from('survey_responses').select('id, cc1, cc2, cc3').eq('office_id', currentOfficeId);

  const total = (surveyRows || []).length;
  const { activeCards } = await fetchAggregatedCards(currentOfficeId, total);

  const ws = wb.addWorksheet('Overall Response');

  // ── COVER BLOCK ───────────────────────────────────────────
  const coverTitle = ws.addRow([`${officeName}`]);
  coverTitle.getCell(1).font = { name: 'Arial', bold: true, size: 16, color: XL.navy };
  coverTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: XL.lightBlue };
  coverTitle.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
  coverTitle.height = 34;
  ws.mergeCells(coverTitle.number, 1, coverTitle.number, 4);

  const genRow = ws.addRow([`Generated: ${new Date().toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' })}`]);
  genRow.getCell(1).font = { name: 'Arial', size: 10, color: XL.textMid };

  const offRow = ws.addRow([`Office: ${officeName}   |   Total Submissions: ${total}`]);
  offRow.getCell(1).font = { name: 'Arial', size: 10, color: XL.textMid };

  ws.addRow([]);

  // ── CC SUMMARY BLOCK ──────────────────────────────────────
  const ccSectionRow = ws.addRow(['CITIZEN\'S CHARTER (CC) RESPONSES']);
  ccSectionRow.getCell(1).font = { name: 'Arial', bold: true, size: 12, color: XL.white };
  ccSectionRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: XL.navy };
  ccSectionRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
  ccSectionRow.height = 26;
  ws.mergeCells(ccSectionRow.number, 1, ccSectionRow.number, 4);

  ws.addRow([]);

  const ccDefs = [
    { tag: 'CC1', q: 'Alin sa mga sumusunod ang naglalarawan sa iyong kaalaman sa CC?', labels: CC1_LABELS },
    { tag: 'CC2', q: 'Kung alam ang CC, masasabi mo ba na ang CC nang napuntahang opisina ay…', labels: CC2_LABELS },
    { tag: 'CC3', q: 'Kung alam ang CC, gaano nakatulong ang CC sa transaksyon mo?', labels: CC3_LABELS },
  ];

  ccDefs.forEach(({ tag, q, labels }) => {
    // Sub-header for each CC question
    const secRow = ws.addRow([`${tag}: ${q}`]);
    secRow.getCell(1).font = { name: 'Arial', bold: true, size: 10, color: XL.white };
    secRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: XL.teal };
    secRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    secRow.height = 22;
    ws.mergeCells(secRow.number, 1, secRow.number, 4);

    xlHeaderRow(ws, ['', 'Option', 'Count', 'Percentage']);

    const counts = {};
    Object.keys(labels).forEach(k => counts[k] = 0);
    let selTotal = 0;
    (surveyRows || []).forEach(r => {
      const val = r[tag.toLowerCase()];
      if (val) val.split(',').map(v => v.trim()).filter(Boolean).forEach(v => {
        if (counts[v] !== undefined) { counts[v]++; selTotal++; }
      });
    });

    Object.entries(labels).forEach(([val, label], i) => {
      const c   = counts[val] || 0;
      const pct = selTotal > 0 ? ((c / selTotal) * 100).toFixed(1) + '%' : '0%';
      const row = xlDataRow(ws, [tag, label, c, pct], i % 2 === 1);
      row.getCell(1).font = { name: 'Arial', bold: true, size: 10, color: XL.teal };
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
    });

    ws.addRow([]);
  });

  // ── SURVEY QUESTIONS BLOCK ────────────────────────────────
  if (activeCards.length > 0) {
    const qSectionRow = ws.addRow(['SURVEY QUESTIONS & RESPONSES']);
    qSectionRow.getCell(1).font = { name: 'Arial', bold: true, size: 12, color: XL.white };
    qSectionRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: XL.navy };
    qSectionRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    qSectionRow.height = 26;
    ws.mergeCells(qSectionRow.number, 1, qSectionRow.number, 4);

    ws.addRow([]);

    activeCards.forEach((q, qi) => {
      // Question title row
      const qTitleRow = ws.addRow([`Q${qi + 1}: ${q.text}`]);
      qTitleRow.getCell(1).font = { name: 'Arial', bold: true, size: 11, color: XL.navy };
      qTitleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: XL.lightBlue };
      qTitleRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      qTitleRow.height = 22;
      ws.mergeCells(qTitleRow.number, 1, qTitleRow.number, 4);

      if (q.type === 'likert') {
        const avg = q.total > 0
          ? (Object.entries(q.dist).reduce((s, [k, v]) => s + Number(k) * v, 0) / q.total).toFixed(2)
          : 'N/A';
        const responsePct = q.out_of > 0 ? ((q.total / q.out_of) * 100).toFixed(1) + '%' : '0%';

        // Meta row
        const metaRow = ws.addRow([`Responses: ${q.total} / ${q.out_of}  (${responsePct} response rate)   |   Average Rating: ${avg}`]);
        metaRow.getCell(1).font = { name: 'Arial', italic: true, size: 9, color: XL.textMid };
        ws.mergeCells(metaRow.number, 1, metaRow.number, 4);

        xlHeaderRow(ws, ['Rating', 'Label', 'Count', '% of Submissions']);

        const labels = { 5:'Very Satisfied', 4:'Satisfied', 3:'Neutral', 2:'Dissatisfied', 1:'Very Dissatisfied' };
        const colors = { 5:'FF16A34A', 4:'FF22C55E', 3:'FFF59E0B', 2:'FFEF4444', 1:'FFDC2626' };

        [5,4,3,2,1].forEach((star, i) => {
          const c   = q.dist[star];
          const pct = q.out_of > 0 ? ((c / q.out_of) * 100).toFixed(1) + '%' : '0%';
          const row = xlDataRow(ws, [star, labels[star], c, pct], i % 2 === 1);
          row.getCell(1).font = { name: 'Arial', bold: true, size: 11, color: { argb: colors[star] } };
          row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
          row.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
          row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
        });

      } else if (q.type === 'mc') {
        const typeLabel = q.select_type === 'checkbox' ? 'Multi-select' : 'Single Choice';
        const metaRow = ws.addRow([`Type: ${typeLabel}   |   Total Responses: ${q.total}`]);
        metaRow.getCell(1).font = { name: 'Arial', italic: true, size: 9, color: XL.textMid };
        ws.mergeCells(metaRow.number, 1, metaRow.number, 4);

        xlHeaderRow(ws, ['', 'Option', 'Count', 'Percentage']);

        q.options.forEach(([label, c], i) => {
          const pct = q.total > 0 ? ((c / q.total) * 100).toFixed(1) + '%' : '0%';
          const row = xlDataRow(ws, ['', label, c, pct], i % 2 === 1);
          row.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
          row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
          if (c > 0) row.getCell(2).font = { name: 'Arial', bold: true, size: 10, color: XL.green };
        });

      } else if (q.type === 'comment') {
        const responsePct = q.out_of > 0 ? ((q.total / q.out_of) * 100).toFixed(1) + '%' : '0%';
        const metaRow = ws.addRow([`Comments: ${q.comments.length}   |   Responses: ${q.total} / ${q.out_of}  (${responsePct} response rate)`]);
        metaRow.getCell(1).font = { name: 'Arial', italic: true, size: 9, color: XL.textMid };
        ws.mergeCells(metaRow.number, 1, metaRow.number, 4);

        xlHeaderRow(ws, ['#', 'Comment', '', '']);

        q.comments.forEach((c, i) => {
          const row = xlDataRow(ws, [i + 1, c, '', ''], i % 2 === 1);
          row.getCell(1).alignment = { horizontal: 'center', vertical: 'top' };
          row.getCell(2).alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
        });

        if (q.comments.length === 0) {
          const emptyRow = ws.addRow(['', 'No comments submitted.', '', '']);
          emptyRow.getCell(2).font = { name: 'Arial', italic: true, size: 9, color: XL.textMid };
        }
      }

      ws.addRow([]);
    });
  }

  // ── Set base column widths then auto-fit ──────────────────
  ws.columns = [
    { width: 10 },  // col A: tag / rating / number
    { width: 55 },  // col B: main label / option / comment
    { width: 12 },  // col C: count
    { width: 18 },  // col D: percentage / extra
  ];

  xlAutoFit(ws);

    ws.views = [{ state: 'frozen', ySplit: 4, zoomScale: 69 }];
    ws.sheetProtection = { sheet: true, formatCells: false, formatColumns: false, formatRows: false };
}

// ── Individual tab ────────────────────────────────────────────
async function exportIndividualTab(wb, officeName) {
  const { data: responses } = await window.supabaseClient
    .from('survey_responses')
    .select('id, first_name, last_name, email, response_date, gender, age, client_type, region, transaction_type, submitted_at, cc1, cc2, cc3, suggestions')
    .eq('office_id', currentOfficeId)
    .order('submitted_at', { ascending: false });

  if (!responses || responses.length === 0) {
    const ws = wb.addWorksheet('Individual Responses');
    ws.addRow(['No responses found.']);
    return;
  }

  const responseIds = responses.map(r => r.id);
  const [{ data: allLikert }, { data: allMc }, { data: allComments }] = await Promise.all([
    window.supabaseClient.from('v_likert_answers')
      .select('response_id, question_text, rating, page_order, question_order')
      .in('response_id', responseIds).order('page_order').order('question_order'),
    window.supabaseClient.from('v_mc_answers')
      .select('response_id, question_text, answer_text, page_order, question_order')
      .in('response_id', responseIds).order('page_order').order('question_order'),
    window.supabaseClient.from('v_comment_answers')
      .select('response_id, question_text, answer_text, page_order, question_order')
      .in('response_id', responseIds).order('page_order').order('question_order'),
  ]);

  const questionCols = [];
  const seenQ = new Set();
  [...(allLikert || []), ...(allMc || []), ...(allComments || [])]
    .sort((a, b) => a.page_order - b.page_order || a.question_order - b.question_order)
    .forEach(a => { if (!seenQ.has(a.question_text)) { seenQ.add(a.question_text); questionCols.push(a.question_text); } });

  const likertMap = {}, mcMap = {}, commentMap = {};
  (allLikert   || []).forEach(a => { if (!likertMap[a.response_id])  likertMap[a.response_id]  = {}; likertMap[a.response_id][a.question_text]  = a.rating === 'NA' ? 'N/A' : a.rating; });
  (allMc       || []).forEach(a => { if (!mcMap[a.response_id])      mcMap[a.response_id]      = {}; mcMap[a.response_id][a.question_text]      = a.answer_text; });
  (allComments || []).forEach(a => { if (!commentMap[a.response_id]) commentMap[a.response_id] = {}; commentMap[a.response_id][a.question_text] = a.answer_text; });

  const ws = wb.addWorksheet('Individual Responses');
  xlTitle(ws, `Individual Responses — ${officeName}`, 13 + questionCols.length);

  const fixedHeaders = ['Name', 'Email', 'Date Submitted', 'Response Date', 'Gender', 'Age', 'Client Type', 'Region', 'Transaction Type', 'CC1', 'CC2', 'CC3', 'Suggestions'];
  xlHeaderRow(ws, [...fixedHeaders, ...questionCols]);

  // Column widths
  const fixedWidths = [22, 28, 20, 16, 10, 8, 14, 22, 28, 55, 30, 28, 30];
  ws.columns = [...fixedWidths, ...questionCols.map(() => 30)].map(w => ({ width: w }));

  responses.forEach((r, i) => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Anonymous';
    const row  = xlDataRow(ws, [
      name,
      r.email || '',
      r.submitted_at ? new Date(r.submitted_at).toLocaleString('en-PH') : '',
      r.response_date ? new Date(r.response_date).toLocaleDateString('en-PH') : '',
      r.gender || '', r.age || '', r.client_type || '', r.region || '', r.transaction_type || '',
      decodeCCValue(r.cc1, CC1_LABELS),
      decodeCCValue(r.cc2, CC2_LABELS),
      decodeCCValue(r.cc3, CC3_LABELS),
      r.suggestions || '',
      ...questionCols.map(q => likertMap[r.id]?.[q] ?? mcMap[r.id]?.[q] ?? commentMap[r.id]?.[q] ?? ''),
    ], i % 2 === 1);

    // Highlight name cell
    row.getCell(1).font = { name: 'Arial', bold: true, size: 10, color: XL.navy };
  });

    xlAutoFit(ws);
  // Freeze header
  ws.views = [{ state: 'frozen', ySplit: 4, xSplit: 1 }];
    ws.sheetProtection = { sheet: true, formatCells: false, formatColumns: false, formatRows: false };
}

// ── Archived tab ──────────────────────────────────────────────
async function exportArchivedTab(wb, officeName) {
  const { data: surveyRows } = await window.supabaseClient
    .from('survey_responses').select('id').eq('office_id', currentOfficeId);
  const total = (surveyRows || []).length;
  const { archivedCards } = await fetchAggregatedCards(currentOfficeId, total);

  if (!archivedCards.length) {
    const ws = wb.addWorksheet('Archived');
    ws.addRow(['No archived questions.']);
    return;
  }

  archivedCards.forEach((q, qi) => {
    const ws = wb.addWorksheet(`ARC-Q${qi + 1}`);
    const archivedOn = q.deactivated_at
      ? new Date(q.deactivated_at).toLocaleDateString('en-PH')
      : 'Unknown';

    xlTitle(ws, q.text, 3);

    // Archived badge row
    const badge = ws.addRow([`⚠ Archived on ${archivedOn}`]);
    badge.getCell(1).font = { name: 'Arial', italic: true, size: 9, color: { argb: 'FF94A3B8' } };
    badge.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    ws.addRow([]);

    if (q.type === 'likert') {
      const avg = q.total > 0
        ? (Object.entries(q.dist).reduce((s, [k, v]) => s + Number(k) * v, 0) / q.total).toFixed(2)
        : 'N/A';
      xlSetColWidths(ws, [10, 22, 12, 20]);
      xlSubHeader(ws, ['Rating', 'Label', 'Count', '% of Responses']);
      const labels = { 5:'Very Satisfied', 4:'Satisfied', 3:'Neutral', 2:'Dissatisfied', 1:'Very Dissatisfied' };
      [5,4,3,2,1].forEach((star, i) => {
        const c   = q.dist[star];
        const pct = q.total > 0 ? ((c / q.total) * 100).toFixed(1) + '%' : '0%';
        const row = xlDataRow(ws, [star, labels[star], c, pct], i % 2 === 1);
        row.getCell(1).alignment = { horizontal: 'center' };
        row.getCell(3).alignment = { horizontal: 'center' };
        row.getCell(4).alignment = { horizontal: 'center' };
      });
      ws.addRow([]);
      xlDataRow(ws, ['Average Rating', avg]);

    } else if (q.type === 'mc') {
      xlSetColWidths(ws, [55, 12, 16]);
      xlSubHeader(ws, ['Option', 'Count', 'Percentage']);
      q.options.forEach(([label, c], i) => {
        const pct = q.total > 0 ? ((c / q.total) * 100).toFixed(1) + '%' : '0%';
        const row = xlDataRow(ws, [label, c, pct], i % 2 === 1);
        row.getCell(2).alignment = { horizontal: 'center' };
        row.getCell(3).alignment = { horizontal: 'center' };
      });

    } else if (q.type === 'comment') {
      xlSetColWidths(ws, [6, 80]);
      xlSubHeader(ws, ['#', 'Comment']);
      q.comments.forEach((c, i) => {
        const row = xlDataRow(ws, [i + 1, c], i % 2 === 1);
        row.getCell(1).alignment = { horizontal: 'center' };
        row.height = Math.min(80, Math.max(18, Math.ceil(c.length / 80) * 15));
      });
    }
    xlAutoFit(ws);

    ws.views = [{ state: 'frozen', ySplit: 4 }];
    ws.sheetProtection = { sheet: true, formatCells: false, formatColumns: false, formatRows: false };
  });
}
document.addEventListener('DOMContentLoaded', () => {
  fetchOffices();
});