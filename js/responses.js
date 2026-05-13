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
//  ARCHIVED RESPONSE TAB — FULL DATA DISPLAY
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
//  ARCHIVED RESPONSE TAB — FULL DATA DISPLAY WITH QUESTION TEXT
// ══════════════════════════════════════════════════════════════

async function loadArchivedResponse(officeId) {
  const panel = document.getElementById('tab-archived');
  panel.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-light);">
    <i class="fas fa-spinner fa-spin" style="font-size:2rem;"></i><br><br>Loading archived surveys...
  </div>`;

  try {
    const { data: archives, error } = await window.supabaseClient
      .from('survey_archives')
      .select('id, archived_at, total_responses, pages, responses, office_id')
      .eq('office_id', officeId)
      .order('archived_at', { ascending: false });

    if (error) throw error;

    if (!archives || archives.length === 0) {
      panel.innerHTML = `
        <div style="padding:80px;text-align:center;color:var(--text-light);">
          <i class="fas fa-archive" style="font-size:4rem;opacity:0.2;margin-bottom:20px;"></i>
          <h3>No Archived Surveys Yet</h3>
          <p>When you edit a survey with responses, the old version + all answers will be archived here.</p>
        </div>`;
      return;
    }

    let html = `<p class="ind-results-count">${archives.length} archived survey version${archives.length > 1 ? 's' : ''}</p>`;

    archives.forEach(archive => {
      const date = new Date(archive.archived_at).toLocaleDateString('en-PH', {
        year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });

      const pages = typeof archive.pages === 'string' ? JSON.parse(archive.pages) : archive.pages || [];
      const totalQ = pages.reduce((sum, p) => sum + (p.questions?.length || 0), 0);
      const respCount = archive.total_responses || 0;

      html += `
        <div class="ind-row archived-survey-row" data-archive-id="${archive.id}" style="cursor:pointer;">
          <div class="ind-row-left">
            <p class="ind-row-name">
              <i class="fas fa-archive" style="color:#f59e0b;"></i>
              Survey Version • ${date}
            </p>
            <div class="ind-row-badges">
              <span class="ind-badge ind-badge--client">${totalQ} questions</span>
              <span class="ind-badge" style="background:#64748b15;color:#64748b;">${respCount} responses</span>
            </div>
          </div>
          <div class="ind-row-right">
            <i class="fas fa-chevron-right"></i>
          </div>
        </div>`;
    });

    panel.innerHTML = html;

    document.querySelectorAll('.archived-survey-row').forEach(row => {
      row.addEventListener('click', () => {
        const archive = archives.find(a => a.id === row.dataset.archiveId);
        if (archive) showArchivedSurveyModal(archive);
      });
    });

  } catch (err) {
    console.error(err);
    panel.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444;">Failed to load archived data.</div>`;
  }
}

// ══════════════════════════════════════════════════════════════
//  ARCHIVED RESPONSE MODAL  — Full Overall + Individual
// ══════════════════════════════════════════════════════════════
// Add this function before showArchivedSurveyModal
function addArchiveRowStyles() {
  if (!document.getElementById('archiveRowStyles')) {
    const style = document.createElement('style');
    style.id = 'archiveRowStyles';
    style.textContent = `
      .archived-survey-row {
        transition: all 0.2s ease;
      }
      .archived-survey-row:hover {
        background: #f1f5f9 !important;
        transform: translateX(4px);
      }
      .archived-survey-row:active {
        background: #e0f2fe !important;
        border-left: 3px solid #0891b2;
      }
      .ind-row {
        transition: all 0.2s ease;
        cursor: pointer;
      }
      .ind-row:hover {
        background: #f8fafc !important;
        transform: translateX(2px);
      }
      .ind-row:active {
        background: #e0f2fe !important;
        border-left: 3px solid #0891b2;
      }
    `;
    document.head.appendChild(style);
  }
}
function showArchivedSurveyModal(archive) {
  const old = document.getElementById('archivedSurveyModal');
  if (old) old.remove();

  // Add the row styles
  addArchiveRowStyles();

  const modalHTML = `
    <div id="archivedSurveyModal" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:30000;display:flex;align-items:center;justify-content:center;">
      <div style="background:white;border-radius:16px;width:95%;max-width:1250px;max-height:92vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 25px 60px rgba(0,0,0,0.35);">
        <!-- Header -->
        <div style="padding:1.1rem 1.5rem;background:#0054dd;color:white;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
          <div>
            <h2 style="margin:0;font-size:1.25rem;font-weight:700;">
              <i class="fas fa-archive" style="color:#fff8ed;margin-right:8px;"></i>
              Archived Survey Version
            </h2>
            <p style="margin:4px 0 0;opacity:0.75;font-size:0.85rem;">
              ${new Date(archive.archived_at).toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' })}
              &nbsp;·&nbsp; ${archive.total_responses || 0} responses
            </p>
          </div>
          <div style="display:flex;gap:10px;">
            <button onclick="exportArchivedSurvey()"
                    style="background:rgba(255,255,255,0.12);border:none;color:white;width:36px;height:36px;border-radius:8px;font-size:1rem;cursor:pointer;"
                    title="Export to Excel">
              <i class="fas fa-download"></i>
            </button>
            <button onclick="document.getElementById('archivedSurveyModal').remove()"
                    style="background:rgba(255,255,255,0.12);border:none;color:white;width:36px;height:36px;border-radius:8px;font-size:1.3rem;cursor:pointer;">×</button>
          </div>
        </div>

        <!-- Tabs -->
        <div style="display:flex;border-bottom:2px solid #e2e8f0;flex-shrink:0;background:#f8fafc;">
          <button onclick="switchArchiveTab(0)" id="archiveTab0" class="archive-tab-btn active"
                  style="flex:1;padding:13px 16px;font-weight:600;font-size:0.9rem;border:none;background:none;cursor:pointer;color:#1e293b;">
            <i class="fas fa-chart-bar"></i> Overall Responses
          </button>
          <button onclick="switchArchiveTab(1)" id="archiveTab1" class="archive-tab-btn"
                  style="flex:1;padding:13px 16px;font-weight:600;font-size:0.9rem;border:none;background:none;cursor:pointer;color:#64748b;">
            <i class="fas fa-users"></i> Individual Responses
          </button>
        </div>

        <div id="archivedModalContent" style="flex:1;overflow-y:auto;padding:0;"></div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHTML);

  if (!document.getElementById('archiveTabStyle')) {
    const style = document.createElement('style');
    style.id = 'archiveTabStyle';
    style.textContent = `.archive-tab-btn.active { color: #1e3a5f !important; border-bottom: 3px solid #1e3a5f !important; background: white !important; }`;
    document.head.appendChild(style);
  }

  window.currentArchivedData = archive;
  setTimeout(() => switchArchiveTab(0), 30);
};

// Tab Switcher
window.switchArchiveTab = function(tabIndex) {
  const archive = window.currentArchivedData;
  if (!archive) return;

  document.querySelectorAll('.archive-tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === tabIndex);
  });

  const content = document.getElementById('archivedModalContent');

  if (tabIndex === 0) {
    renderArchiveOverallTab(content, archive);
  } else {
    renderArchiveIndividualTab(content, archive);
  }
};
// ─────────────────────────────────────────────────────────────
//  OVERALL TAB — FULL FIX (Question Text + Response Statistics)
// ─────────────────────────────────────────────────────────────
async function renderArchiveOverallTab(content, archive) {
  content.innerHTML = `<div style="padding:60px;text-align:center;">
    <i class="fas fa-spinner fa-spin" style="font-size:2rem;"></i>
    <p style="margin-top:12px;">Loading archived overall responses...</p>
  </div>`;

  try {
    console.log("📊 Full Archive Object:", archive);

    // Parse Pages (original structure from survey_question.js)
    let pages = [];
    if (archive.pages) {
      pages = typeof archive.pages === 'string'
        ? JSON.parse(archive.pages)
        : Array.isArray(archive.pages) ? archive.pages : [];
    }

    const respData = typeof archive.responses === 'string'
      ? JSON.parse(archive.responses)
      : archive.responses || {};

    const surveyResps = respData.survey_responses || [];
    const totalSubmissions = archive.total_responses || surveyResps.length || 0;

    // ============================================================
    // Build a proper question list from pages in the exact order
    // Each question gets a unique index that matches how responses are stored
    // ============================================================

    const allQuestions = [];
    let globalIndex = 0;

    pages.forEach((page, pageIdx) => {
      const pageQuestions = page.questions || [];
      pageQuestions.forEach((q, qIdx) => {
        const qText = q.question_text || q.text || q.question || '';
        if (qText) {
          allQuestions.push({
            id: globalIndex,
            text: qText,
            page_order: pageIdx,
            question_order: qIdx,
            type: page.type,
            select_type: q.selectType || (page.type === 'multiple-choice' ? (q.selectType || 'radio') : null),
            options: q.options || []
          });
          globalIndex++;
        }
      });
    });

    console.log(`📝 Found ${allQuestions.length} questions in pages:`, allQuestions.map(q => ({ text: q.text, type: q.type })));

    // ============================================================
    // For each response type, we need to match by the actual question text
    // Since the response data might not have proper order info, we'll match by
    // the sequence of questions as they appear in the pages
    // ============================================================

    // Get likert questions from pages (in order)
    const likertQuestionsFromPages = allQuestions.filter(q => q.type === 'likert');
    const mcQuestionsFromPages = allQuestions.filter(q => q.type === 'multiple-choice');
    const commentQuestionsFromPages = allQuestions.filter(q => q.type === 'comment');

    console.log("Likert questions from pages:", likertQuestionsFromPages.map(q => q.text));
    console.log("MC questions from pages:", mcQuestionsFromPages.map(q => q.text));
    console.log("Comment questions from pages:", commentQuestionsFromPages.map(q => q.text));

    // Process likert responses - map by index order (since they come in the same order as pages)
    const likertRows = (respData.likert_responses || []).map((r, idx) => {
      // Match by index position if available, otherwise use the sequence
      const matchedQuestion = likertQuestionsFromPages[idx];

      return {
        ...r,
        question_text: matchedQuestion?.text || r.question_text || `Likert Question ${idx + 1}`,
        page_order: matchedQuestion?.page_order || r.page_order || 0,
        question_order: matchedQuestion?.question_order || r.question_order || idx,
        question_id: r.question_id || `likert_${idx}`
      };
    });

    // Process MC responses - map by index order
    const mcRows = (respData.mc_responses || []).map((r, idx) => {
      const matchedQuestion = mcQuestionsFromPages[idx];

      return {
        ...r,
        question_text: matchedQuestion?.text || r.question_text || `MC Question ${idx + 1}`,
        select_type: matchedQuestion?.select_type || r.select_type || 'radio',
        page_order: matchedQuestion?.page_order || r.page_order || 0,
        question_order: matchedQuestion?.question_order || r.question_order || idx,
        question_id: r.question_id || `mc_${idx}`
      };
    });

    // Process comment responses - map by index order
    const commentRows = (respData.comment_responses || []).map((r, idx) => {
      const matchedQuestion = commentQuestionsFromPages[idx];

      return {
        ...r,
        question_text: matchedQuestion?.text || r.question_text || `Comment Question ${idx + 1}`,
        page_order: matchedQuestion?.page_order || r.page_order || 0,
        question_order: matchedQuestion?.question_order || r.question_order || idx,
        question_id: r.question_id || `comment_${idx}`
      };
    });

    console.log(`📄 Pages: ${pages.length} | Responses: ${totalSubmissions}`);
    console.log(`📊 Likert responses after mapping:`, likertRows.map(r => ({ text: r.question_text, rating: r.rating })));
    console.log(`📊 MC responses after mapping:`, mcRows.map(r => ({ text: r.question_text, answer: r.answer_text })));
    console.log(`📊 Comment responses after mapping:`, commentRows.map(r => ({ text: r.question_text, comment: r.answer_text })));

    // Generate cards with statistics using the enriched data
    const likertCards = aggregateLikert(likertRows, totalSubmissions);
    const mcCards = aggregateMC(mcRows, new Map());
    const commentCards = aggregateComments(commentRows, totalSubmissions);

    let allCards = [...likertCards, ...mcCards, ...commentCards];

    // Sort cards by original order (page_order then question_order)
    allCards.sort((a, b) => {
      const orderA = a.page_order || 0;
      const orderB = b.page_order || 0;
      if (orderA !== orderB) return orderA - orderB;
      return (a.q_order || 0) - (b.q_order || 0);
    });

    console.log("📋 Generated cards:", allCards.map(c => ({ text: c.text, type: c.type })));

    let cardsHtml = '';
    if (allCards.length > 0) {
      console.log("✅ Showing aggregated cards with statistics");
      cardsHtml = allCards.map(q => buildCard({ ...q, is_active: false }, true)).join('');
    }
    else if (pages.length > 0) {
      console.log("⚠️ Falling back to pages only");
      pages.forEach((page, pIdx) => {
        cardsHtml += `<div style="margin:20px 0;padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;">`;
        cardsHtml += `<strong>Page ${pIdx+1} — ${page.type || 'Unknown'}</strong><br><br>`;

        (page.questions || []).forEach((q, qIdx) => {
          const qText = q.question_text || q.text || q.question || 'Untitled Question';
          cardsHtml += `<div style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
            <strong>Q${qIdx+1}:</strong> ${escapeHtml(qText)}
          </div>`;
        });
        cardsHtml += `</div>`;
      });
    }

    const ccHtml = surveyResps.length > 0 ? buildCCSection(surveyResps, totalSubmissions) : '';

    // Removed the historical snapshot box
    content.innerHTML = `
      <div style="padding:28px 32px;">
        ${ccHtml}
        ${cardsHtml || '<p style="text-align:center;color:#64748b;padding:60px;">No data found.</p>'}
      </div>`;

  } catch (err) {
    console.error('❌ renderArchiveOverallTab error:', err);
    content.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444;">
      Failed to load archived data.<br><small>${err.message}</small>
    </div>`;
  }
}
// ══════════════════════════════════════════════════════════════
//  EXPORT ARCHIVED SURVEY TO EXCEL
// ══════════════════════════════════════════════════════════════

window.exportArchivedSurvey = async function() {
  const archive = window.currentArchivedData;
  if (!archive) {
    alert("No archive data to export.");
    return;
  }

  // Check which tab is active in the modal
  const activeTabBtn = document.querySelector('#archivedSurveyModal .archive-tab-btn.active');
  let activeTabIndex = 0; // Default to Overall
  if (activeTabBtn) {
    if (activeTabBtn.textContent.includes('Individual')) {
      activeTabIndex = 1;
    }
  }

  const btn = event?.target?.closest('button');
  const originalHtml = btn ? btn.innerHTML : '<i class="fas fa-download"></i>';
  if (btn) {
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;
  }

  try {
    const officeName = document.getElementById('selectedOfficeTitle')?.textContent || 'Archived Survey';
    const archiveDate = new Date(archive.archived_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Luisiana CSS';
    wb.created = new Date();

    const respData = typeof archive.responses === 'string'
      ? JSON.parse(archive.responses)
      : archive.responses || {};

    const surveyResps = respData.survey_responses || [];
    const totalSubmissions = archive.total_responses || surveyResps.length || 0;

    // Parse pages
    let pages = [];
    if (archive.pages) {
      pages = typeof archive.pages === 'string'
        ? JSON.parse(archive.pages)
        : Array.isArray(archive.pages) ? archive.pages : [];
    }

    // Export based on active tab
    if (activeTabIndex === 0) {
      // Export ONLY Overall Responses sheet
      await exportArchivedOverallSheet(wb, archive, pages, respData, surveyResps, totalSubmissions, officeName, archiveDate);
    } else {
      // Export ONLY Individual Responses sheet (like the regular Individual tab)
      await exportArchivedIndividualSheetOnly(wb, archive, pages, respData, surveyResps, officeName, archiveDate);
    }

    // Download
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const tabName = activeTabIndex === 0 ? 'Overall' : 'Individual';
    a.href = url;
    a.download = `${officeName}_Archived_${tabName}_${archiveDate.replace(/ /g, '_')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);

  } catch (err) {
    console.error('Export archived error:', err);
    alert('Export failed: ' + err.message);
  } finally {
    if (btn) {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
    }
  }
};

// ── Export Individual Sheet Only (matches regular Individual tab format) ──
async function exportArchivedIndividualSheetOnly(wb, archive, pages, respData, surveyResps, officeName, archiveDate) {
  const ws = wb.addWorksheet('Individual Responses');

  // Title
  const titleRow = ws.addRow([`${officeName} - Archived Individual Responses`]);
  titleRow.getCell(1).font = { name: 'Arial', bold: true, size: 16, color: XL.navy };
  titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: XL.lightBlue };
  titleRow.height = 32;
  ws.mergeCells(titleRow.number, 1, titleRow.number, 13);

  ws.addRow([`Archived on: ${new Date(archive.archived_at).toLocaleString('en-PH')}`]);
  ws.addRow([`Total Responses: ${surveyResps.length}`]);
  ws.addRow([]);

  // ============================================================
  // Build proper question lists from pages in the exact order
  // ============================================================

  // Collect all questions from pages with their order
  const allLikertQuestions = [];
  const allMCQuestions = [];
  const allCommentQuestions = [];

  pages.forEach((page, pageIdx) => {
    const pageQuestions = page.questions || [];
    pageQuestions.forEach((q, qIdx) => {
      const qText = q.question_text || q.text || q.question || '';
      if (qText) {
        const questionInfo = {
          text: qText,
          page_order: pageIdx,
          question_order: qIdx,
          type: page.type,
          select_type: q.selectType || (page.type === 'multiple-choice' ? (q.selectType || 'radio') : null),
          options: q.options || []
        };

        if (page.type === 'likert') {
          allLikertQuestions.push(questionInfo);
        } else if (page.type === 'multiple-choice') {
          allMCQuestions.push(questionInfo);
        } else if (page.type === 'comment') {
          allCommentQuestions.push(questionInfo);
        }
      }
    });
  });

  console.log("Export - Likert questions:", allLikertQuestions.map(q => q.text));
  console.log("Export - MC questions:", allMCQuestions.map(q => q.text));
  console.log("Export - Comment questions:", allCommentQuestions.map(q => q.text));

  // Build ordered questions list for headers (in correct order by page and question)
  const orderedQuestions = [];
  pages.forEach(page => {
    const pageQuestions = page.questions || [];
    pageQuestions.forEach(q => {
      const qText = q.question_text || q.text || q.question || '';
      if (qText) {
        orderedQuestions.push(qText);
      }
    });
  });

  // Map each response to its question text by index order
  const likertResponses = respData.likert_responses || [];
  const mcResponses = respData.mc_responses || [];
  const commentResponses = respData.comment_responses || [];

  // Create enriched response maps for lookup by response_id
  const enrichedLikertMap = {};
  likertResponses.forEach((resp, idx) => {
    const matchedQuestion = allLikertQuestions[idx];
    const qText = matchedQuestion?.text || resp.question_text || `Likert Question ${idx + 1}`;
    if (!enrichedLikertMap[resp.response_id]) enrichedLikertMap[resp.response_id] = {};
    enrichedLikertMap[resp.response_id][qText] = resp.rating === 'NA' ? 'N/A' : resp.rating;
  });

  const enrichedMCMap = {};
  mcResponses.forEach((resp, idx) => {
    const matchedQuestion = allMCQuestions[idx];
    const qText = matchedQuestion?.text || resp.question_text || `MC Question ${idx + 1}`;
    if (!enrichedMCMap[resp.response_id]) enrichedMCMap[resp.response_id] = {};
    enrichedMCMap[resp.response_id][qText] = resp.answer_text;
  });

  const enrichedCommentMap = {};
  commentResponses.forEach((resp, idx) => {
    const matchedQuestion = allCommentQuestions[idx];
    const qText = matchedQuestion?.text || resp.question_text || `Comment Question ${idx + 1}`;
    if (!enrichedCommentMap[resp.response_id]) enrichedCommentMap[resp.response_id] = {};
    enrichedCommentMap[resp.response_id][qText] = resp.answer_text;
  });

  // Headers (same as regular Individual tab)
  const fixedHeaders = ['Name', 'Email', 'Date Submitted', 'Response Date', 'Gender', 'Age', 'Client Type', 'Region', 'Transaction Type', 'CC1', 'CC2', 'CC3', 'Suggestions'];
  const allHeaders = [...fixedHeaders, ...orderedQuestions];
  xlHeaderRow(ws, allHeaders);

  // Column widths (same as regular Individual tab)
  const fixedWidths = [22, 28, 20, 16, 10, 8, 14, 22, 28, 55, 30, 28, 30];
  ws.columns = [...fixedWidths, ...orderedQuestions.map(() => 30)].map(w => ({ width: w }));

  // Data rows (same format as exportIndividualTab)
  surveyResps.forEach((r, i) => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Anonymous';

    // Build answers for each question in order
    const answers = orderedQuestions.map(q => {
      return enrichedLikertMap[r.id]?.[q] ?? enrichedMCMap[r.id]?.[q] ?? enrichedCommentMap[r.id]?.[q] ?? '';
    });

    const rowData = [
      name,
      r.email || '',
      r.submitted_at ? new Date(r.submitted_at).toLocaleString('en-PH') : '',
      r.response_date ? new Date(r.response_date).toLocaleDateString('en-PH') : '',
      r.gender || '',
      r.age || '',
      r.client_type || '',
      r.region || '',
      r.transaction_type || '',
      decodeCCValue(r.cc1, CC1_LABELS),
      decodeCCValue(r.cc2, CC2_LABELS),
      decodeCCValue(r.cc3, CC3_LABELS),
      r.suggestions || '',
      ...answers
    ];
    const row = xlDataRow(ws, rowData, i % 2 === 1);
    row.getCell(1).font = { name: 'Arial', bold: true, size: 10, color: XL.navy };
  });

  xlAutoFit(ws);
  ws.views = [{ state: 'frozen', ySplit: 4, xSplit: 1 }];
}

async function exportArchivedOverallSheet(wb, archive, pages, respData, surveyResps, totalSubmissions, officeName, archiveDate) {
  const ws = wb.addWorksheet('Overall Responses');

  // Title
  const titleRow = ws.addRow([`${officeName} - Archived Survey`]);
  titleRow.getCell(1).font = { name: 'Arial', bold: true, size: 16, color: XL.navy };
  titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: XL.lightBlue };
  titleRow.height = 32;
  ws.mergeCells(titleRow.number, 1, titleRow.number, 4);

  ws.addRow([`Archived on: ${new Date(archive.archived_at).toLocaleString('en-PH')}`]);
  ws.addRow([`Total Responses: ${totalSubmissions}`]);
  ws.addRow([]);

  // Build question text map
  const questionTextMap = new Map();
  if (pages.length > 0) {
    pages.forEach(page => {
      (page.questions || []).forEach((q, idx) => {
        const qText = q.question_text || q.text || q.question || '';
        if (qText) {
          const questionKey = q.question_id || `q_${idx}`;
          questionTextMap.set(questionKey, qText);
        }
      });
    });
  }

  // Enrich response data
  const likertRows = (respData.likert_responses || []).map(r => ({
    ...r,
    question_text: r.question_text || questionTextMap.get(r.question_id) || 'Untitled Question'
  }));

  const mcRows = (respData.mc_responses || []).map(r => ({
    ...r,
    question_text: r.question_text || questionTextMap.get(r.question_id) || 'Untitled Question'
  }));

  const commentRows = (respData.comment_responses || []).map(r => ({
    ...r,
    question_text: r.question_text || questionTextMap.get(r.question_id) || 'Untitled Question'
  }));

  // Generate cards
  const likertCards = aggregateLikert(likertRows, totalSubmissions);
  const mcCards = aggregateMC(mcRows, new Map());
  const commentCards = aggregateComments(commentRows, totalSubmissions);
  const allCards = [...likertCards, ...mcCards, ...commentCards];

  // CC Section
  if (surveyResps.length > 0) {
    const ccSectionRow = ws.addRow(['CITIZEN\'S CHARTER (CC) RESPONSES']);
    ccSectionRow.getCell(1).font = { name: 'Arial', bold: true, size: 12, color: XL.white };
    ccSectionRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: XL.navy };
    ccSectionRow.height = 26;
    ws.mergeCells(ccSectionRow.number, 1, ccSectionRow.number, 4);
    ws.addRow([]);

    // CC1
    const cc1Counts = { '1': 0, '2': 0, '3': 0, '4': 0 };
    let cc1Total = 0;
    surveyResps.forEach(r => {
      if (r.cc1) {
        r.cc1.split(',').forEach(v => {
          const val = v.trim();
          if (cc1Counts[val] !== undefined) { cc1Counts[val]++; cc1Total++; }
        });
      }
    });

    const cc1Row = ws.addRow(['CC1: Alin sa mga sumusunod ang naglalarawan sa iyong kaalaman sa CC?']);
    cc1Row.getCell(1).font = { name: 'Arial', bold: true, size: 10, color: XL.white };
    cc1Row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: XL.teal };
    ws.mergeCells(cc1Row.number, 1, cc1Row.number, 4);

    xlHeaderRow(ws, ['Option', 'Count', 'Percentage']);
    const cc1Labels = {
      '1': 'Alam ko ang CC at nakita ko ito sa napuntahang opisina',
      '2': 'Alam ko ang CC pero hindi ko ito nakita sa napuntahang opisina',
      '3': 'Nalaman ko ang CC nang makita ko ito sa napuntahang opisina',
      '4': 'Hindi ko alam kung ano ang CC at wala akong nakita sa napuntahang opisina'
    };
    Object.entries(cc1Labels).forEach(([val, label], i) => {
      const c = cc1Counts[val] || 0;
      const pct = cc1Total > 0 ? ((c / cc1Total) * 100).toFixed(1) + '%' : '0%';
      xlDataRow(ws, [label, c, pct], i % 2 === 1);
    });
    ws.addRow([]);

    // Add CC2 and CC3 similarly (abbreviated for brevity)
    // CC2
    const cc2Counts = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    let cc2Total = 0;
    surveyResps.forEach(r => {
      if (r.cc2) {
        r.cc2.split(',').forEach(v => {
          const val = v.trim();
          if (cc2Counts[val] !== undefined) { cc2Counts[val]++; cc2Total++; }
        });
      }
    });

    const cc2Row = ws.addRow(['CC2: Kung alam ang CC, masasabi mo ba na ang CC nang napuntahang opisina ay…']);
    cc2Row.getCell(1).font = { name: 'Arial', bold: true, size: 10, color: XL.white };
    cc2Row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: XL.teal };
    ws.mergeCells(cc2Row.number, 1, cc2Row.number, 4);

    xlHeaderRow(ws, ['Option', 'Count', 'Percentage']);
    const cc2Labels = {
      '1': 'Madaling makita', '2': 'Medyo madaling makita',
      '3': 'Mahirap makita', '4': 'Hindi makita', '5': 'Hindi angkop'
    };
    Object.entries(cc2Labels).forEach(([val, label], i) => {
      const c = cc2Counts[val] || 0;
      const pct = cc2Total > 0 ? ((c / cc2Total) * 100).toFixed(1) + '%' : '0%';
      xlDataRow(ws, [label, c, pct], i % 2 === 1);
    });
    ws.addRow([]);

    // CC3
    const cc3Counts = { '1': 0, '2': 0, '3': 0, '4': 0 };
    let cc3Total = 0;
    surveyResps.forEach(r => {
      if (r.cc3) {
        r.cc3.split(',').forEach(v => {
          const val = v.trim();
          if (cc3Counts[val] !== undefined) { cc3Counts[val]++; cc3Total++; }
        });
      }
    });

    const cc3Row = ws.addRow(['CC3: Kung alam ang CC, gaano nakatulong ang CC sa transaksyon mo?']);
    cc3Row.getCell(1).font = { name: 'Arial', bold: true, size: 10, color: XL.white };
    cc3Row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: XL.teal };
    ws.mergeCells(cc3Row.number, 1, cc3Row.number, 4);

    xlHeaderRow(ws, ['Option', 'Count', 'Percentage']);
    const cc3Labels = {
      '1': 'Sobrang nakatulong', '2': 'Nakatulong naman',
      '3': 'Hindi nakatulong', '4': 'Hindi angkop'
    };
    Object.entries(cc3Labels).forEach(([val, label], i) => {
      const c = cc3Counts[val] || 0;
      const pct = cc3Total > 0 ? ((c / cc3Total) * 100).toFixed(1) + '%' : '0%';
      xlDataRow(ws, [label, c, pct], i % 2 === 1);
    });
    ws.addRow([]);
  }

  // Survey Questions
  if (allCards.length > 0) {
    const qSectionRow = ws.addRow(['SURVEY QUESTIONS & RESPONSES']);
    qSectionRow.getCell(1).font = { name: 'Arial', bold: true, size: 12, color: XL.white };
    qSectionRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: XL.navy };
    qSectionRow.height = 26;
    ws.mergeCells(qSectionRow.number, 1, qSectionRow.number, 4);
    ws.addRow([]);

    allCards.forEach((q, qi) => {
      const qTitleRow = ws.addRow([`Q${qi + 1}: ${q.text}`]);
      qTitleRow.getCell(1).font = { name: 'Arial', bold: true, size: 11, color: XL.navy };
      qTitleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: XL.lightBlue };
      ws.mergeCells(qTitleRow.number, 1, qTitleRow.number, 4);

      if (q.type === 'likert') {
        const avg = q.total > 0
          ? (Object.entries(q.dist).reduce((s, [k, v]) => s + Number(k) * v, 0) / q.total).toFixed(2)
          : 'N/A';
        const responsePct = q.out_of > 0 ? ((q.total / q.out_of) * 100).toFixed(1) + '%' : '0%';

        const metaRow = ws.addRow([`Responses: ${q.total} / ${q.out_of} (${responsePct}) | Average Rating: ${avg}`]);
        metaRow.getCell(1).font = { name: 'Arial', italic: true, size: 9, color: XL.textMid };
        ws.mergeCells(metaRow.number, 1, metaRow.number, 4);

        xlHeaderRow(ws, ['Rating', 'Label', 'Count', '% of Submissions']);
        const labels = { 5:'Very Satisfied', 4:'Satisfied', 3:'Neutral', 2:'Dissatisfied', 1:'Very Dissatisfied' };
        [5,4,3,2,1].forEach((star, i) => {
          const c = q.dist[star];
          const pct = q.out_of > 0 ? ((c / q.out_of) * 100).toFixed(1) + '%' : '0%';
          xlDataRow(ws, [star, labels[star], c, pct], i % 2 === 1);
        });
      } else if (q.type === 'mc') {
        const typeLabel = q.select_type === 'checkbox' ? 'Multi-select' : 'Single Choice';
        const metaRow = ws.addRow([`Type: ${typeLabel} | Total Responses: ${q.total}`]);
        metaRow.getCell(1).font = { name: 'Arial', italic: true, size: 9, color: XL.textMid };
        ws.mergeCells(metaRow.number, 1, metaRow.number, 4);

        xlHeaderRow(ws, ['Option', 'Count', 'Percentage']);
        q.options.forEach(([label, c], i) => {
          const pct = q.total > 0 ? ((c / q.total) * 100).toFixed(1) + '%' : '0%';
          xlDataRow(ws, [label, c, pct], i % 2 === 1);
        });
      } else if (q.type === 'comment') {
        const responsePct = q.out_of > 0 ? ((q.total / q.out_of) * 100).toFixed(1) + '%' : '0%';
        const metaRow = ws.addRow([`Comments: ${q.comments.length} | Responses: ${q.total} / ${q.out_of} (${responsePct})`]);
        metaRow.getCell(1).font = { name: 'Arial', italic: true, size: 9, color: XL.textMid };
        ws.mergeCells(metaRow.number, 1, metaRow.number, 4);

        xlHeaderRow(ws, ['#', 'Comment']);
        q.comments.forEach((c, i) => {
          xlDataRow(ws, [i + 1, c], i % 2 === 1);
        });
      }
      ws.addRow([]);
    });
  }

  ws.columns = [{ width: 10 }, { width: 55 }, { width: 12 }, { width: 18 }];
  xlAutoFit(ws);
  ws.views = [{ state: 'frozen', ySplit: 4 }];
}

async function exportArchivedIndividualSheet(wb, archive, pages, respData, surveyResps, officeName, archiveDate) {
  const ws = wb.addWorksheet('Individual Responses');

  const titleRow = ws.addRow([`${officeName} - Archived Individual Responses`]);
  titleRow.getCell(1).font = { name: 'Arial', bold: true, size: 16, color: XL.navy };
  titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: XL.lightBlue };
  titleRow.height = 32;
  ws.mergeCells(titleRow.number, 1, titleRow.number, 13);

  ws.addRow([`Archived on: ${new Date(archive.archived_at).toLocaleString('en-PH')}`]);
  ws.addRow([`Total Responses: ${surveyResps.length}`]);
  ws.addRow([]);

  // Build question text map
  const questionTextMap = new Map();
  const orderedQuestions = [];
  if (pages.length > 0) {
    pages.forEach(page => {
      (page.questions || []).forEach((q, idx) => {
        const qText = q.question_text || q.text || q.question || '';
        if (qText) {
          orderedQuestions.push(qText);
          const questionKey = q.question_id || `q_${idx}`;
          questionTextMap.set(questionKey, qText);
        }
      });
    });
  }

  // Build answer maps
  const likertMap = {}, mcMap = {}, commentMap = {};
  (respData.likert_responses || []).forEach(a => {
    const qText = a.question_text || questionTextMap.get(a.question_id) || 'Untitled Question';
    if (!likertMap[a.response_id]) likertMap[a.response_id] = {};
    likertMap[a.response_id][qText] = a.rating === 'NA' ? 'N/A' : a.rating;
  });
  (respData.mc_responses || []).forEach(a => {
    const qText = a.question_text || questionTextMap.get(a.question_id) || 'Untitled Question';
    if (!mcMap[a.response_id]) mcMap[a.response_id] = {};
    mcMap[a.response_id][qText] = a.answer_text;
  });
  (respData.comment_responses || []).forEach(a => {
    const qText = a.question_text || questionTextMap.get(a.question_id) || 'Untitled Question';
    if (!commentMap[a.response_id]) commentMap[a.response_id] = {};
    commentMap[a.response_id][qText] = a.answer_text;
  });

  // Headers
  const fixedHeaders = ['Name', 'Email', 'Date Submitted', 'Response Date', 'Gender', 'Age', 'Client Type', 'Region', 'Transaction Type', 'CC1', 'CC2', 'CC3', 'Suggestions'];
  const allHeaders = [...fixedHeaders, ...orderedQuestions];
  xlHeaderRow(ws, allHeaders);

  // Column widths
  const fixedWidths = [22, 28, 20, 16, 10, 8, 14, 22, 28, 55, 30, 28, 30];
  ws.columns = [...fixedWidths, ...orderedQuestions.map(() => 30)].map(w => ({ width: w }));

  // Data rows
  surveyResps.forEach((r, i) => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Anonymous';
    const rowData = [
      name,
      r.email || '',
      r.submitted_at ? new Date(r.submitted_at).toLocaleString('en-PH') : '',
      r.response_date ? new Date(r.response_date).toLocaleDateString('en-PH') : '',
      r.gender || '', r.age || '', r.client_type || '', r.region || '', r.transaction_type || '',
      decodeCCValue(r.cc1, CC1_LABELS),
      decodeCCValue(r.cc2, CC2_LABELS),
      decodeCCValue(r.cc3, CC3_LABELS),
      r.suggestions || '',
      ...orderedQuestions.map(q => likertMap[r.id]?.[q] ?? mcMap[r.id]?.[q] ?? commentMap[r.id]?.[q] ?? '')
    ];
    const row = xlDataRow(ws, rowData, i % 2 === 1);
    row.getCell(1).font = { name: 'Arial', bold: true, size: 10, color: XL.navy };
  });

  xlAutoFit(ws);
  ws.views = [{ state: 'frozen', ySplit: 4, xSplit: 1 }];
}
window.filterArchiveIndividual = function () {
  const resps      = window._archiveIndividualData || [];
  const search     = (document.getElementById('archIndSearch')?.value     || '').toLowerCase();
  const clientType =  document.getElementById('archIndClientType')?.value  || '';
  const month      =  document.getElementById('archIndMonth')?.value       ?? '';
  const year       =  document.getElementById('archIndYear')?.value        || '';
  const ratingBand =  document.getElementById('archIndRating')?.value      || '';

  const filtered = resps.filter(r => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ').toLowerCase();
    if (search && !name.includes(search)) return false;
    if (clientType && r.client_type !== clientType) return false;

    const dateRaw = r.submitted_at || r.created_at;
    if ((month !== '' || year) && dateRaw) {
      const d = new Date(dateRaw);
      if (month !== '' && d.getMonth() !== Number(month)) return false;
      if (year && d.getFullYear() !== Number(year)) return false;
    }

    if (ratingBand) {
      const avg = r.avg_likert_rating != null ? Number(r.avg_likert_rating) : null;
      if (avg === null) return false;
      if (ratingBand === '5' && avg < 5.0)         return false;
      if (ratingBand === '4' && (avg < 4.0 || avg >= 5.0)) return false;
      if (ratingBand === '3' && (avg < 3.0 || avg >= 4.0)) return false;
      if (ratingBand === '2' && (avg < 2.0 || avg >= 3.0)) return false;
      if (ratingBand === '1' && avg >= 2.0)         return false;
    }

    return true;
  });

  const countEl = document.getElementById('archIndCount');
  if (countEl) {
    countEl.textContent = filtered.length === resps.length
      ? `${resps.length} respondent${resps.length !== 1 ? 's' : ''}`
      : `${filtered.length} of ${resps.length} respondents`;
  }

  const list = document.getElementById('archIndList');
  if (!list) return;

  if (filtered.length === 0) {
    list.innerHTML = `
      <p style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-light,#94a3b8);">
        No respondents match your search.
      </p>`;
    return;
  }

  list.innerHTML = filtered.map(r => {
    const name    = [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Anonymous';
    const dateRaw = r.submitted_at || r.created_at;
    const dateStr = dateRaw
      ? new Date(dateRaw).toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' })
      : '—';
    const timeStr = dateRaw
      ? new Date(dateRaw).toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit', hour12:true })
      : '';

    const avg = r.avg_likert_rating != null ? Number(r.avg_likert_rating) : null;
    const ratingColor = avg === null ? '#94a3b8'
      : avg >= 4.5 ? '#16a34a'
      : avg >= 3.5 ? '#22c55e'
      : avg >= 2.5 ? '#f59e0b'
      : '#ef4444';

    const clientTypeBadge = r.client_type
      ? `<span class="ind-badge ind-badge--client">${escapeHtml(r.client_type)}</span>` : '';
    const genderBadge = r.gender
      ? `<span class="ind-badge ind-badge--gender">${escapeHtml(r.gender)}</span>` : '';

    return `
      <div class="ind-row" onclick="viewArchiveIndividualDetail('${r.id}')">
        <div class="ind-row-left">
          <p class="ind-row-name">${escapeHtml(name)}</p>
          <div class="ind-row-badges">${clientTypeBadge}${genderBadge}</div>
        </div>
        <div class="ind-row-mid">
          <span class="ind-row-datetime">
            <i class="far fa-calendar-alt"></i> ${dateStr}
          </span>
          ${timeStr ? `<span class="ind-row-datetime"><i class="far fa-clock"></i> ${timeStr}</span>` : ''}
        </div>
        <div class="ind-row-right">
          ${avg !== null
            ? `<span class="ind-rating-chip" style="background:${ratingColor}15;color:${ratingColor};">
                ${avg.toFixed(1)} avg
               </span>`
            : '<span style="color:var(--text-light,#94a3b8);font-size:0.82rem;">No rating</span>'}
          <i class="fas fa-chevron-right ind-row-chevron"></i>
        </div>
      </div>`;
  }).join('');
};


async function renderArchiveIndividualTab(content, archive) {
  try {
    const respData = typeof archive.responses === 'string'
      ? JSON.parse(archive.responses)
      : archive.responses || {};

    const surveyResps = respData.survey_responses || [];

    // Parse pages to get question text mapping
    let pages = [];
    if (archive.pages) {
      pages = typeof archive.pages === 'string'
        ? JSON.parse(archive.pages)
        : Array.isArray(archive.pages) ? archive.pages : [];
    }

    // ============================================================
    // Build proper question lists from pages in the exact order
    // ============================================================

    // Collect all questions from pages with their order
    const allLikertQuestions = [];
    const allMCQuestions = [];
    const allCommentQuestions = [];

    pages.forEach((page, pageIdx) => {
      const pageQuestions = page.questions || [];
      pageQuestions.forEach((q, qIdx) => {
        const qText = q.question_text || q.text || q.question || '';
        if (qText) {
          const questionInfo = {
            text: qText,
            page_order: pageIdx,
            question_order: qIdx,
            type: page.type,
            select_type: q.selectType || (page.type === 'multiple-choice' ? (q.selectType || 'radio') : null),
            options: q.options || []
          };

          if (page.type === 'likert') {
            allLikertQuestions.push(questionInfo);
          } else if (page.type === 'multiple-choice') {
            allMCQuestions.push(questionInfo);
          } else if (page.type === 'comment') {
            allCommentQuestions.push(questionInfo);
          }
        }
      });
    });

    console.log("Likert questions from pages:", allLikertQuestions.map(q => q.text));
    console.log("MC questions from pages:", allMCQuestions.map(q => q.text));
    console.log("Comment questions from pages:", allCommentQuestions.map(q => q.text));

    if (surveyResps.length === 0) {
      content.innerHTML = `
        <div style="padding:80px;text-align:center;color:var(--text-light,#94a3b8);">
          <i class="fas fa-users" style="font-size:3rem;opacity:0.2;display:block;margin-bottom:16px;"></i>
          <h3 style="margin:0 0 8px;color:#475569;">No Individual Responses</h3>
          <p style="margin:0;font-size:0.88rem;">No response data was stored in this archive.</p>
        </div>`;
      return;
    }

    // Calculate average ratings for each response with proper question mapping
    const likertResponses = respData.likert_responses || [];
    const mcResponses = respData.mc_responses || [];
    const commentResponses = respData.comment_responses || [];

    // Map each response to its question text by index order
    const enrichedLikertResponses = likertResponses.map((resp, idx) => ({
      ...resp,
      question_text: allLikertQuestions[idx]?.text || resp.question_text || `Likert Question ${idx + 1}`,
      page_order: allLikertQuestions[idx]?.page_order || 0,
      question_order: allLikertQuestions[idx]?.question_order || idx
    }));

    const enrichedMCResponses = mcResponses.map((resp, idx) => ({
      ...resp,
      question_text: allMCQuestions[idx]?.text || resp.question_text || `MC Question ${idx + 1}`,
      select_type: allMCQuestions[idx]?.select_type || resp.select_type || 'radio',
      page_order: allMCQuestions[idx]?.page_order || 0,
      question_order: allMCQuestions[idx]?.question_order || idx,
      options: allMCQuestions[idx]?.options || []
    }));

    const enrichedCommentResponses = commentResponses.map((resp, idx) => ({
      ...resp,
      question_text: allCommentQuestions[idx]?.text || resp.question_text || `Comment Question ${idx + 1}`,
      page_order: allCommentQuestions[idx]?.page_order || 0,
      question_order: allCommentQuestions[idx]?.question_order || idx
    }));

    // Calculate average ratings for each response
    const enhancedResponses = surveyResps.map(resp => {
      const respLikerts = enrichedLikertResponses.filter(l => l.response_id === resp.id);
      let totalRating = 0;
      let ratingCount = 0;
      respLikerts.forEach(l => {
        if (l.rating !== 'NA') {
          const rating = parseInt(l.rating, 10);
          if (!isNaN(rating)) {
            totalRating += rating;
            ratingCount++;
          }
        }
      });
      const avgRating = ratingCount > 0 ? totalRating / ratingCount : null;
      return { ...resp, avg_likert_rating: avgRating };
    });

    const uniqueYears = [...new Set(
      enhancedResponses
        .map(r => (r.submitted_at || r.created_at)
          ? new Date(r.submitted_at || r.created_at).getFullYear()
          : null)
        .filter(Boolean)
    )].sort((a, b) => b - a);

    content.innerHTML = `
      <div class="ind-toolbar" style="
          position:sticky;top:0;z-index:10;
          background:#fff;border-bottom:1px solid #e2e8f0;padding:12px 20px;">
        <div class="ind-search-wrap">
          <i class="fas fa-search ind-search-icon"></i>
          <input
            type="text"
            id="archIndSearch"
            class="ind-search-input"
            placeholder="Search by name…"
            oninput="filterArchiveIndividual()"
          />
        </div>
        <div class="ind-filters">
          <select id="archIndClientType" class="ind-select" onchange="filterArchiveIndividual()">
            <option value="">All Client Types</option>
            <option value="Mamamayan">Mamamayan</option>
            <option value="Negosyo">Negosyo</option>
            <option value="Gobyerno">Gobyerno</option>
          </select>
          <select id="archIndMonth" class="ind-select" onchange="filterArchiveIndividual()">
            <option value="">All Months</option>
            <option value="0">January</option><option value="1">February</option>
            <option value="2">March</option><option value="3">April</option>
            <option value="4">May</option><option value="5">June</option>
            <option value="6">July</option><option value="7">August</option>
            <option value="8">September</option><option value="9">October</option>
            <option value="10">November</option><option value="11">December</option>
          </select>
          <select id="archIndYear" class="ind-select" onchange="filterArchiveIndividual()">
            <option value="">All Years</option>
            ${uniqueYears.map(y => `<option value="${y}">${y}</option>`).join('')}
          </select>
          <select id="archIndRating" class="ind-select" onchange="filterArchiveIndividual()">
            <option value="">All Ratings</option>
            <option value="5">5.0</option>
            <option value="4">4.0 – 4.9</option>
            <option value="3">3.0 – 3.9</option>
            <option value="2">2.0 – 2.9</option>
            <option value="1">Below 2.0</option>
          </select>
        </div>
      </div>

      <p class="ind-results-count" id="archIndCount" style="padding:12px 24px 0;"></p>
      <div class="ind-list" id="archIndList" style="padding:0 20px 24px;"></div>`;

    // Store enhanced data for detail view
    window._archiveIndividualData = enhancedResponses;
    window._archiveEnrichedLikert = enrichedLikertResponses;
    window._archiveEnrichedMC = enrichedMCResponses;
    window._archiveEnrichedComment = enrichedCommentResponses;
    window._archivePages = pages;
    filterArchiveIndividual();

  } catch (err) {
    console.error('renderArchiveIndividualTab error:', err);
    content.innerHTML = `
      <div style="padding:40px;text-align:center;color:#ef4444;">
        Failed to load individual responses.<br><small>${err.message}</small>
      </div>`;
  }
}

// View full archived individual response - Enhanced version with proper mapping
window.viewArchiveIndividualDetail = function(responseId) {
  const archive = window.currentArchivedData;
  if (!archive) {
    alert("Archive data not available.");
    return;
  }

  const respData = typeof archive.responses === 'string'
    ? JSON.parse(archive.responses)
    : archive.responses || {};

  const surveyRow = (respData.survey_responses || []).find(r => r.id === responseId);
  if (!surveyRow) {
    alert("Response not found in this archive.");
    return;
  }

  // Parse pages to get question text mapping
  let pages = [];
  if (archive.pages) {
    pages = typeof archive.pages === 'string'
      ? JSON.parse(archive.pages)
      : Array.isArray(archive.pages) ? archive.pages : [];
  }

  // ============================================================
  // Build proper question lists from pages by type
  // ============================================================
  const allLikertQuestions = [];
  const allMCQuestions = [];
  const allCommentQuestions = [];

  pages.forEach((page, pageIdx) => {
    const pageQuestions = page.questions || [];
    pageQuestions.forEach((q, qIdx) => {
      const qText = q.question_text || q.text || q.question || '';
      if (qText) {
        const questionInfo = {
          text: qText,
          page_order: pageIdx,
          question_order: qIdx,
          type: page.type,
          select_type: q.selectType || (page.type === 'multiple-choice' ? (q.selectType || 'radio') : null),
          options: q.options || []
        };

        if (page.type === 'likert') {
          allLikertQuestions.push(questionInfo);
        } else if (page.type === 'multiple-choice') {
          allMCQuestions.push(questionInfo);
        } else if (page.type === 'comment') {
          allCommentQuestions.push(questionInfo);
        }
      }
    });
  });

  // Get responses for this specific response
  const likertResponses = (respData.likert_responses || []).filter(a => a.response_id === responseId);
  const mcResponses = (respData.mc_responses || []).filter(a => a.response_id === responseId);
  const commentResponses = (respData.comment_responses || []).filter(a => a.response_id === responseId);

  // Map each response to its question text by index order
  const likertAnswers = likertResponses.map((resp, idx) => ({
    ...resp,
    question_text: allLikertQuestions[idx]?.text || resp.question_text || `Likert Question ${idx + 1}`,
    page_order: allLikertQuestions[idx]?.page_order || 0,
    question_order: allLikertQuestions[idx]?.question_order || idx
  }));

  const mcAnswers = mcResponses.map((resp, idx) => ({
    ...resp,
    question_text: allMCQuestions[idx]?.text || resp.question_text || `MC Question ${idx + 1}`,
    select_type: allMCQuestions[idx]?.select_type || resp.select_type || 'radio',
    page_order: allMCQuestions[idx]?.page_order || 0,
    question_order: allMCQuestions[idx]?.question_order || idx,
    options: allMCQuestions[idx]?.options || []
  }));

  const commentAnswers = commentResponses.map((resp, idx) => ({
    ...resp,
    question_text: allCommentQuestions[idx]?.text || resp.question_text || `Comment Question ${idx + 1}`,
    page_order: allCommentQuestions[idx]?.page_order || 0,
    question_order: allCommentQuestions[idx]?.question_order || idx
  }));

  // Build MC options map for this response
  const mcOptionsMap = new Map();
  allMCQuestions.forEach(q => {
    if (q.options && Array.isArray(q.options)) {
      mcOptionsMap.set(q.text, q.options);
    }
  });

  // Open the existing detail modal
  const modal = document.getElementById('responseDetailModal');
  if (!modal) return;

  modal.style.zIndex = '40000';
  modal.style.display = 'flex';

  document.getElementById('responseDetailName').textContent =
    [surveyRow.first_name, surveyRow.last_name].filter(Boolean).join(' ') || 'Anonymous';

  const submittedDate = surveyRow.submitted_at
    ? new Date(surveyRow.submitted_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';
  const submittedTime = surveyRow.submitted_at
    ? new Date(surveyRow.submitted_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true })
    : '';

  document.getElementById('responseDetailDate').textContent =
    submittedDate + (submittedTime ? ' · ' + submittedTime : '');

  // Personal Info Card
  const responseDate = surveyRow.response_date
    ? new Date(surveyRow.response_date).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const infoFields = [
    { icon: 'fa-envelope',       label: 'Email',                   value: surveyRow.email           || null },
    { icon: 'fa-calendar-day',   label: 'Petsa',                   value: responseDate               || null },
    { icon: 'fa-venus-mars',     label: 'Kasarian',                value: surveyRow.gender          || null },
    { icon: 'fa-hashtag',        label: 'Edad',                    value: surveyRow.age             || null },
    { icon: 'fa-user-tag',       label: 'Uri ng Kliyente',         value: surveyRow.client_type     || null },
    { icon: 'fa-map-marker-alt', label: 'Rehiyon',                 value: surveyRow.region          || null },
    { icon: 'fa-exchange-alt',   label: 'Uri ng Transaksyon',      value: surveyRow.transaction_type|| null },
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

  // Survey Answers
  const likertLabels = { 5:'Very Satisfied', 4:'Satisfied', 3:'Neutral', 2:'Dissatisfied', 1:'Very Dissatisfied' };
  const likertColors = { 5:'#16a34a', 4:'#22c55e', 3:'#f59e0b', 2:'#ef4444', 1:'#dc2626' };

  const allAnswers = [
    ...likertAnswers.map(a => ({ ...a, type: 'likert' })),
    ...mcAnswers.map(a => ({ ...a, type: 'mc' })),
    ...commentAnswers.map(a => ({ ...a, type: 'comment' })),
  ].sort((a, b) => (a.page_order || 0) - (b.page_order || 0) || (a.question_order || 0) - (b.question_order || 0));

  const answersHtml = allAnswers.length === 0
    ? `<p style="color:var(--text-light);">No answers recorded.</p>`
    : `<div class="modal-answers-header">
         <i class="fas fa-clipboard-list"></i>
         <span>Archived Survey Answers</span>
       </div>
       <div class="modal-answers-list">
         ${allAnswers.map(a => {
           if (a.type === 'likert') {
             if (a.rating === 'NA') return `
               <div class="detail-answer-card">
                 <p class="detail-question">${escapeHtml(a.question_text)}</p>
                 <span style="color:var(--text-light);font-size:0.88rem;">N/A</span>
               </div>`;
             const val = parseInt(a.rating, 10);
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
             const allOpts = a.options && a.options.length > 0 ? a.options : mcOptionsMap.get(a.question_text) || selectedVals;
             return `
               <div class="detail-answer-card">
                 <p class="detail-question">${escapeHtml(a.question_text)}</p>
                 <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px;">
                   ${(allOpts.length > 0 ? allOpts : selectedVals).map(opt => {
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
               <p class="detail-comment">${escapeHtml(a.answer_text || '')}</p>
             </div>`;
         }).join('')}
       </div>`;

  // CC Answers
  const ccQuestions = [
    {
      tag: 'CC1',
      question: 'Alin sa mga sumusunod ang naglalarawan sa iyong kaalaman sa CC?',
      value: surveyRow.cc1 || '',
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
      value: surveyRow.cc2 || '',
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
      value: surveyRow.cc3 || '',
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
              <div style="background:#e0f2fe;display:flex;align-items:center;justify-content:center;padding:0 14px;flex-shrink:0;border-right:1px solid #bae6fd;">
                <span style="color:#0369a1;font-size:0.78rem;font-weight:700;letter-spacing:0.04em;">${cc.tag}</span>
              </div>
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
                        <span style="font-size:0.875rem;color:${checked ? 'var(--text-dark)' : 'var(--text-light)'};font-weight:${checked ? '500' : '400'};">${escapeHtml(opt.label)}</span>
                      </label>`;
                  }).join('')}
                </div>
                ${selected.length === 0 ? `<p style="margin:8px 0 0;font-size:0.78rem;color:var(--text-light);font-style:italic;">No answer provided.</p>` : ''}
              </div>
            </div>
          </div>`;
      }).join('')}
    </div>`;

  document.getElementById('responseDetailAnswers').innerHTML = personalInfoHtml + ccHtml + answersHtml;
};


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