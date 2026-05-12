// dashboard.js
// Fetches respondents (name, office, submitted_at) from survey_responses
// and renders them into the Recent Feedback table.


// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format a UTC timestamp string into a human-readable local date + time.
 * e.g. "May 12, 2026 03:45 PM"
 */
function formatDateTime(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Build a display name from first_name / last_name.
 * Falls back to "Anonymous" when both are blank/null.
 */
function buildName(firstName, lastName) {
  const full = [firstName, lastName]
    .map(s => (s || '').trim())
    .filter(Boolean)
    .join(' ');
  return full || 'Anonymous';
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

/**
 * Retrieves the 10 most recent survey responses (name, office, submitted_at).
 * Uses the Supabase REST API directly — no SDK required.
 *
 * @param {number} limit  Number of rows to fetch (default 10).
 * @returns {Promise<Array>}
 */
async function fetchRecentRespondents(limit = 10) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/survey_responses`);

  // Select columns + join offices table via office_id foreign key.
  // Supabase PostgREST syntax: offices(name) embeds the related row.
  // If your offices table's name column is different (e.g. "office_name"),
  // update "offices(name)" to "offices(office_name)" accordingly.
  url.searchParams.set('select', 'first_name,last_name,offices(name),submitted_at');

  // Most recent first
  url.searchParams.set('order', 'submitted_at.desc');

  // Row limit
  url.searchParams.set('limit', String(limit));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Supabase error ${response.status}: ${err}`);
  }

  return response.json(); // Array of row objects
}

// ─── Render ──────────────────────────────────────────────────────────────────

/**
 * Clears and repopulates the <tbody> of .feedback-table with fresh data.
 *
 * @param {Array} rows  Rows from survey_responses.
 */
function renderFeedbackTable(rows) {
  const tbody = document.querySelector('.feedback-table tbody');
  if (!tbody) return;

  tbody.innerHTML = ''; // Clear existing / placeholder rows

  if (rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" style="text-align:center; color: var(--text-light); padding: 24px;">
          No responses yet.
        </td>
      </tr>`;
    return;
  }

  rows.forEach(row => {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.textContent = buildName(row.first_name, row.last_name);

    const officeTd = document.createElement('td');
    const officeSpan = document.createElement('span');
    officeSpan.className = 'office-tag';
    // PostgREST returns the joined row as: { offices: { name: "LYDO" } }
    const officeName = row.offices?.name || 'N/A';
    officeSpan.textContent = officeName.length > 60
      ? officeName.slice(0, 60) + '…'
      : officeName;
    officeSpan.title = officeName; // show full name on hover
    officeTd.appendChild(officeSpan);

    const dateTd = document.createElement('td');
    dateTd.className = 'date-cell';
    dateTd.textContent = formatDateTime(row.submitted_at);

    tr.appendChild(nameTd);
    tr.appendChild(officeTd);
    tr.appendChild(dateTd);

    tbody.appendChild(tr);
  });
}

// ─── Stats card helper ───────────────────────────────────────────────────────

/**
 * Updates the "Total Responses" stat card with the real count from Supabase.
 * Uses the Prefer: count=exact header to get the total without fetching all rows.
 */
async function updateTotalResponsesCard() {
  const url = new URL(`${SUPABASE_URL}/rest/v1/survey_responses`);
  url.searchParams.set('select', 'id');

  const response = await fetch(url.toString(), {
    method: 'HEAD',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: 'count=exact',
    },
  });

  if (response.ok) {
    const range = response.headers.get('Content-Range'); // e.g. "0-9/325"
    if (range) {
      const total = range.split('/')[1];
      const card = document.querySelector('.stat-blue .stat-value');
      if (card && total) card.textContent = Number(total).toLocaleString();
    }
  }
}

/**
 * Updates the "Weekly Responses" stat card with submissions in the last 7 days.
 */
async function updateWeeklyResponsesCard() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const url = new URL(`${SUPABASE_URL}/rest/v1/survey_responses`);
  url.searchParams.set('select', 'id');
  url.searchParams.set('submitted_at', `gte.${sevenDaysAgo}`);

  const response = await fetch(url.toString(), {
    method: 'HEAD',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: 'count=exact',
    },
  });

  if (response.ok) {
    const range = response.headers.get('Content-Range');
    if (range) {
      const total = range.split('/')[1];
      const card = document.querySelector('.stat-purple .stat-value');
      if (card && total) card.textContent = Number(total).toLocaleString();
    }
  }
}

/**
 * Calculates the average likert rating across ALL likert_responses,
 * excluding 'NA' answers, and updates the Average Satisfaction card.
 *
 * rating is stored as TEXT ('1'–'5' or 'NA'), so we filter out 'NA'
 * then average the numeric values client-side.
 *
 * PostgREST does not support AVG() directly, so we fetch all
 * non-NA ratings (just the rating column — lightweight) and compute here.
 */
async function updateAvgSatisfactionCard() {
  const url = new URL(`${SUPABASE_URL}/rest/v1/likert_responses`);

  // Only fetch the rating column, exclude 'NA' rows
  url.searchParams.set('select', 'rating');
  url.searchParams.set('rating', 'neq.NA');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) return;

  const rows = await response.json(); // [{ rating: "4" }, { rating: "5" }, ...]

  const card = document.querySelector('.stat-pink .stat-value');
  if (!card) return;

  if (rows.length === 0) {
    card.textContent = '—';
    return;
  }

  // Sum all numeric ratings and divide
  const sum = rows.reduce((acc, r) => acc + Number(r.rating), 0);
  const avg = sum / rows.length;

  // Display as "X.XX / 5"
  card.textContent = `${avg.toFixed(2)} / 5`;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function initDashboard() {
  try {
    // Run all fetches in parallel for speed
    const [rows] = await Promise.all([
      fetchRecentRespondents(),
      updateTotalResponsesCard(),
      updateWeeklyResponsesCard(),
      updateAvgSatisfactionCard(),
    ]);

    renderFeedbackTable(rows);
  } catch (error) {
    console.error('Dashboard init failed:', error);

    const tbody = document.querySelector('.feedback-table tbody');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="3" style="text-align:center; color:#ef4444; padding: 24px;">
            Failed to load responses. Check console for details.
          </td>
        </tr>`;
    }
  }
}

// Run after the DOM is ready
document.addEventListener('DOMContentLoaded', initDashboard);