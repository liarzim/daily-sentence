'use strict';

/* ---------- קבועים ---------- */
const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const DAY_NAMES = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];
const RELATIONS = { partner: 'זוגיות', parent: 'הורה', child: 'ילד או ילדה', friend: 'חבר או חברה', other: 'אחר' };
const REASONS = {
  day_off: 'יום ללא שליחה',
  skipped_by_user: 'דילגת על היום',
  shabbat: 'שבת',
  blocked_date: 'תאריך שחסמת',
  holiday: 'חג או יום זיכרון',
  window_passed: 'חלון השעות עבר',
  no_sentence: 'לא נמצא משפט מתאים במאגר',
};
const KIND_LABEL = { holiday: 'חג', holiday_eve: 'ערב חג', memorial: 'יום זיכרון' };
const LEVELS = ['', 'רמז עדין', 'רומנטי וקרוב', 'חושני וברור', 'נועז', 'ישיר ונועז מאוד'];
const TABS = {
  settings: ['משפט יומי', 'הגדרות שליחה'],
  bank: ['מאגר משפטים', 'המשפטים שלך לצד משפטים שנוצרו ב-AI'],
  history: ['היסטוריה ודירוג', 'מה נשלח, איך הגיבו, ומה דעתך'],
};
const THUMB = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 10v10H4V10h3zm0 0l4-7a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7"></path></svg>';
const THUMB_DOWN = THUMB.replace('<path', '<g transform="rotate(180 12 12)"><path').replace('</path>', '</path></g>');

/* ---------- מצב ---------- */
const state = {
  sb: null, user: null, settings: null, style: null,
  categories: [], userCats: {}, sentences: [], sends: [], holidays: [], blocked: [],
  tab: 'settings', bankFilter: 'all', editing: null, confirmDelete: null, peek: false,
};

/* ---------- עזרים ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tz = () => (state.settings && state.settings.timezone) || 'Asia/Jerusalem';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: tz() }).format(new Date());
const fmtDate = (d) => { const [y, m, day] = String(d).slice(0, 10).split('-'); return `${+day}.${+m}.${y}`; };
const fmtTime = (ts) => new Intl.DateTimeFormat('he-IL', { timeZone: tz(), hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
const hour = (h) => `${String(h).padStart(2, '0')}:00`;
const pressed = (el) => el.getAttribute('aria-pressed') === 'true';

async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

let toastTimer = null;
function toast(message, isError) {
  const el = $('#toast');
  el.textContent = message;
  el.className = isError ? 'toast error' : 'toast';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 5000 : 2200);
}

function fail(err) {
  console.error(err);
  toast('הפעולה נכשלה: ' + ((err && err.message) || 'שגיאה לא ידועה'), true);
}

function show(id) {
  ['screen-loading', 'screen-login', 'screen-app'].forEach((s) => { $('#' + s).hidden = s !== id; });
}

/* ---------- אתחול והתחברות ---------- */
async function boot() {
  try {
    const cfg = await (await fetch('/api/config')).json();
    if (!cfg.url || !cfg.key) throw new Error('missing config');
    state.sb = window.supabase.createClient(cfg.url, cfg.key);
  } catch (err) {
    console.error(err);
    $('#loading-text').textContent = 'לא ניתן להתחבר למסד הנתונים. ודא שהמסד מחובר לפרויקט ב-Vercel.';
    return;
  }
  // לא מבצעים קריאות למסד מתוך ההאזנה עצמה, רק אחריה.
  state.sb.auth.onAuthStateChange((_event, session) => { setTimeout(() => onSession(session), 0); });
  const { data } = await state.sb.auth.getSession();
  onSession(data.session);
}

async function onSession(session) {
  const user = (session && session.user) || null;
  if (!user) {
    state.user = null;
    show('screen-login');
    return;
  }
  if (state.user && state.user.id === user.id) return;
  state.user = user;
  $('#loading-text').textContent = 'טוען…';
  show('screen-loading');
  try {
    await loadAll();
    show('screen-app');
    renderAll();
  } catch (err) {
    console.error(err);
    $('#loading-text').textContent = 'טעינת הנתונים נכשלה: ' + ((err && err.message) || '');
  }
}

async function loadAll() {
  const sb = state.sb;
  const uid = state.user.id;

  let settings = await q(sb.from('settings').select('*').eq('user_id', uid).maybeSingle());
  if (!settings) settings = await q(sb.from('settings').insert({ user_id: uid }).select().single());
  state.settings = settings;

  const [categories, userCats, style] = await Promise.all([
    q(sb.from('categories').select('*').order('created_at').order('name')),
    q(sb.from('user_categories').select('*').eq('user_id', uid)),
    q(sb.from('style_profiles').select('*').eq('user_id', uid).maybeSingle()),
  ]);
  state.categories = categories;
  state.style = style;

  // משתמש חדש: מפעילים את כל קטגוריות המערכת חוץ מתוכן למבוגרים.
  let rows = userCats;
  if (!rows.length) {
    const defaults = categories.filter((c) => !c.user_id).map((c) => ({ user_id: uid, category_id: c.id, enabled: !c.is_adult }));
    if (defaults.length) rows = await q(sb.from('user_categories').insert(defaults).select());
  }
  state.userCats = {};
  rows.forEach((r) => { state.userCats[r.category_id] = r.enabled; });

  await Promise.all([loadSentences(), loadSends(), loadBlocked()]);
}

async function loadSentences() {
  state.sentences = await q(state.sb.from('sentences').select('*').eq('user_id', state.user.id).order('created_at', { ascending: false }));
}

async function loadSends() {
  state.sends = await q(state.sb.from('sends')
    .select('*, sentences(text, source, categories(name))')
    .eq('user_id', state.user.id)
    .order('send_date', { ascending: false })
    .limit(40));
}

async function loadBlocked() {
  const [holidays, blocked] = await Promise.all([
    q(state.sb.from('holidays').select('*').gte('holiday_date', today()).order('holiday_date').limit(10)),
    q(state.sb.from('blocked_dates').select('*').eq('user_id', state.user.id).order('blocked_date')),
  ]);
  state.holidays = holidays;
  state.blocked = blocked;
}

/* ---------- ציור ---------- */
function renderAll() {
  renderHeader();
  renderSettings();
  renderBank();
  renderHistory();
}

function renderHeader() {
  const [title, sub] = TABS[state.tab];
  $('#page-title').textContent = title;
  $('#page-sub').textContent = sub;
  const btn = $('#active-toggle');
  const on = !!state.settings.is_active;
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? 'השליחה פעילה' : 'השליחה כבויה';
  $$('nav.tabs button').forEach((b) => {
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  ['settings', 'bank', 'history'].forEach((t) => { $('#tab-' + t).hidden = t !== state.tab; });
}

const pill = (group, value, label, on, aria) =>
  `<button type="button" class="pill" data-action="press" data-group="${group}" data-value="${esc(value)}" aria-pressed="${on ? 'true' : 'false'}"${aria ? ` aria-label="${esc(aria)}"` : ''}>${esc(label)}</button>`;

const toggleRow = (id, label, on) =>
  `<div class="between"><span>${esc(label)}</span>
   <button type="button" id="${id}" class="pill status" data-action="press-toggle" aria-pressed="${on ? 'true' : 'false'}">${on ? 'פעיל' : 'כבוי'}</button></div>`;

const hourOptions = (from, to, selected) => {
  let out = '';
  for (let h = from; h <= to; h += 1) out += `<option value="${h}"${h === selected ? ' selected' : ''}>${hour(h)}</option>`;
  return out;
};

function renderSettings() {
  const s = state.settings;
  const days = DAYS.map((d, i) => pill('day', i, d, (s.send_days || []).includes(i), DAY_NAMES[i])).join('');
  const rel = Object.keys(RELATIONS).map((k) => `<option value="${k}"${s.relationship_type === k ? ' selected' : ''}>${RELATIONS[k]}</option>`).join('');

  $('#tab-settings').innerHTML = `
  <div style="display:flex;flex-direction:column;gap:12px">
    <section class="card">
      <h2>נמען</h2>
      <div class="field"><label for="f-name">שם לפנייה</label>
        <input id="f-name" type="text" value="${esc(s.recipient_name)}"></div>
      <div class="field"><label for="f-phone">טלפון לשליחה</label>
        <input id="f-phone" type="tel" dir="ltr" inputmode="tel" value="${esc(s.recipient_phone)}" style="text-align:right" placeholder="972501234567"></div>
      <div class="field"><span class="label">אני כותב בלשון</span>
        <div class="row wrap">${pill('sender', 'male', 'זכר', s.sender_gender === 'male')}${pill('sender', 'female', 'נקבה', s.sender_gender === 'female')}</div></div>
      <div class="field"><span class="label">הפנייה אל הנמען בלשון</span>
        <div class="row wrap">${pill('recipient', 'male', 'זכר', s.recipient_gender === 'male')}${pill('recipient', 'female', 'נקבה', s.recipient_gender === 'female')}</div></div>
      <div class="field"><label for="f-rel">סוג הקשר</label><select id="f-rel">${rel}</select></div>
    </section>

    <section class="card">
      <h2>ימי שליחה</h2>
      <div class="days">${days}</div>
    </section>

    <section class="card">
      <h2>חלון שעות</h2>
      <div class="row">
        <div class="field"><label for="f-start">מהשעה</label><select id="f-start">${hourOptions(0, 23, s.window_start_hour)}</select></div>
        <div class="field"><label for="f-end">עד השעה</label><select id="f-end">${hourOptions(1, 24, s.window_end_hour)}</select></div>
      </div>
      <p class="hint">בכל יום נבחרת שעה אקראית בתוך החלון, כך שההודעה לא מגיעה בשעה קבועה.</p>
    </section>

    <section class="card">
      <h2>ימים ללא שליחה</h2>
      ${toggleRow('f-holidays', 'חגי ישראל', s.block_holidays)}
      ${toggleRow('f-eves', 'ערבי חג', s.block_holiday_eves)}
      ${toggleRow('f-memorial', 'ימי זיכרון ותשעה באב', s.block_memorial_days)}
      ${toggleRow('f-shabbat', 'שבתות', s.block_shabbat)}
      <div id="s-blocked" class="divider" style="display:flex;flex-direction:column;gap:8px"></div>
    </section>

    <section class="card">
      <h2>סוגי משפטים</h2>
      <div id="s-cats" style="display:flex;flex-direction:column;gap:12px"></div>
    </section>

    <section class="card">
      <h2>ארוטיקה</h2>
      <p class="hint">כבויה כברירת מחדל. מיועדת לקשר זוגי בלבד, ונשלחת בחלון שעות נפרד כדי שלא תגיע באמצע יום עבודה.</p>
      <label class="check"><input id="f-adult" type="checkbox"${s.adult_confirmed ? ' checked' : ''}> אני מעל גיל 18</label>
      ${toggleRow('f-erotica', 'משפטים ארוטיים', s.erotica_enabled)}
      <div class="field"><label for="f-level">רמה: <span id="f-level-label">${s.erotica_level}, ${LEVELS[s.erotica_level]}</span></label>
        <input id="f-level" type="range" min="1" max="5" step="1" value="${s.erotica_level}"></div>
      <div class="row">
        <div class="field"><label for="f-estart">מהשעה</label><select id="f-estart">${hourOptions(0, 23, s.erotica_start_hour)}</select></div>
        <div class="field"><label for="f-eend">עד השעה</label><select id="f-eend">${hourOptions(1, 24, s.erotica_end_hour)}</select></div>
      </div>
      <p class="hint">ההגדרות נשמרות כבר עכשיו. השליחה עצמה של משפטים ארוטיים תופעל בגרסה הבאה.</p>
    </section>

    <button type="button" class="btn primary block" data-action="save-settings">שמירת ההגדרות</button>
    <div class="between"><span class="meta">${esc(state.user.email || '')}</span>
      <button type="button" class="link muted" data-action="logout">התנתקות</button></div>
  </div>`;

  renderBlocked();
  renderCats();
}

function renderBlocked() {
  const overrides = {};
  state.blocked.filter((b) => b.send_anyway).forEach((b) => { overrides[b.blocked_date] = b.id; });
  const manual = state.blocked.filter((b) => b.source === 'manual' && !b.send_anyway && b.blocked_date >= today());

  const holidays = state.holidays.map((h) => {
    const anyway = !!overrides[h.holiday_date];
    return `<div class="between"><span>${esc(h.name)} · ${fmtDate(h.holiday_date)} · <span class="meta">${KIND_LABEL[h.kind]}</span></span>
      <button type="button" class="link" data-action="holiday-toggle" data-date="${h.holiday_date}">${anyway ? 'ביטול: לא לשלוח' : 'לשלוח בכל זאת'}</button></div>`;
  }).join('') || '<p class="hint">אין חגים קרובים בלוח.</p>';

  const mine = manual.map((b) =>
    `<div class="between"><span>${fmtDate(b.blocked_date)}${b.description ? ' · ' + esc(b.description) : ''}</span>
      <button type="button" class="link" data-action="blocked-remove" data-id="${b.id}">הסרה</button></div>`).join('');

  $('#s-blocked').innerHTML = `
    <h3>חגים קרובים</h3>${holidays}
    <h3>תאריכים שחסמת</h3>${mine || '<p class="hint">עוד לא הוספת תאריכים.</p>'}
    <div class="row">
      <div class="field"><label for="f-bdate">תאריך</label><input id="f-bdate" type="date" min="${today()}"></div>
      <div class="field"><label for="f-bdesc">תיאור (לא חובה)</label><input id="f-bdesc" type="text"></div>
    </div>
    <button type="button" class="btn block" data-action="blocked-add">הוספת תאריך ללא שליחה</button>`;
}

function visibleCategories() {
  const s = state.settings;
  return state.categories.filter((c) => {
    if (c.is_adult && !(s.erotica_enabled && s.adult_confirmed)) return false;
    if (c.partner_only && s.relationship_type !== 'partner') return false;
    return true;
  });
}

function renderCats() {
  const chips = visibleCategories().map((c) =>
    `<button type="button" class="pill" data-action="cat-toggle" data-id="${c.id}" aria-pressed="${state.userCats[c.id] ? 'true' : 'false'}" title="${esc(c.description)}">${esc(c.name)}</button>`).join('');
  const own = state.categories.filter((c) => c.user_id).map((c) =>
    `<div class="between"><span>${esc(c.name)}${c.description ? ' · <span class="meta">' + esc(c.description) + '</span>' : ''}</span>
      <button type="button" class="link muted" data-action="cat-delete" data-id="${c.id}">מחיקה</button></div>`).join('');

  $('#s-cats').innerHTML = `
    <div class="row wrap">${chips}</div>
    ${own ? '<h3>קטגוריות שהוספת</h3>' + own : ''}
    <div class="divider" style="display:flex;flex-direction:column;gap:8px">
      <h3>קטגוריה משלך</h3>
      <div class="field"><label for="f-cname">שם</label><input id="f-cname" type="text" maxlength="30"></div>
      <div class="field"><label for="f-cdesc">תיאור קצר, ישמש גם להנחיית ה-AI</label><input id="f-cdesc" type="text" maxlength="120"></div>
      <button type="button" class="btn block" data-action="cat-add">הוספת קטגוריה</button>
    </div>`;
}

function categoryName(id) {
  const c = state.categories.find((x) => x.id === id);
  return c ? c.name : '';
}

function renderBank() {
  const cats = visibleCategories();
  const options = cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const filters = [['all', 'הכול'], ['manual', 'שלי'], ['ai', 'AI'], ['paused', 'מושהים']].map(([k, label]) =>
    `<button type="button" class="pill dark" data-action="bank-filter" data-filter="${k}" aria-pressed="${state.bankFilter === k ? 'true' : 'false'}">${label}</button>`).join('');

  const list = state.sentences.filter((se) => {
    if (state.bankFilter === 'paused') return se.status === 'paused';
    if (state.bankFilter === 'manual' || state.bankFilter === 'ai') return se.source === state.bankFilter;
    return true;
  });

  const items = list.map((se) => {
    const paused = se.status === 'paused';
    let note;
    if (paused) note = `<span class="note-warn">מושהה${se.score <= -2 ? ', דורג נמוך' : ''}</span>`;
    else if (se.score > 0) note = '<span class="note-good">דורג גבוה</span>';
    else if (se.last_sent_at) note = `<span class="note-muted">נשלח ${fmtDate(se.last_sent_at)}</span>`;
    else note = '<span class="note-muted">טרם נשלח</span>';

    let body;
    let actions;
    if (state.editing === se.id) {
      body = `<div class="field"><label for="e-${se.id}">עריכת המשפט</label><textarea id="e-${se.id}">${esc(se.text)}</textarea></div>`;
      actions = `<button type="button" class="link" data-action="sent-save" data-id="${se.id}">שמירה</button>
                 <button type="button" class="link muted" data-action="sent-cancel">ביטול</button>`;
    } else if (state.confirmDelete === se.id) {
      body = `<p class="sentence${paused ? ' paused' : ''}">${esc(se.text)}</p>`;
      actions = `<span class="meta">למחוק את המשפט?</span>
                 <button type="button" class="link" data-action="sent-delete" data-id="${se.id}">כן, למחוק</button>
                 <button type="button" class="link muted" data-action="sent-cancel">לא</button>`;
    } else {
      body = `<p class="sentence${paused ? ' paused' : ''}">${esc(se.text)}</p>`;
      actions = `<button type="button" class="link" data-action="sent-edit" data-id="${se.id}">עריכה</button>
                 <button type="button" class="link muted" data-action="sent-status" data-id="${se.id}">${paused ? 'החזרה למאגר' : 'השהיה'}</button>
                 <button type="button" class="link muted" data-action="sent-ask-delete" data-id="${se.id}">מחיקה</button>`;
    }
    return `<article class="card">
      <div class="row wrap" style="align-items:center">
        <span class="tag${se.source === 'ai' ? ' dark' : ''}">${se.source === 'ai' ? 'AI' : 'שלי'}</span>
        <span class="tag">${esc(categoryName(se.category_id))}</span>${note}
      </div>${body}<div class="row wrap" style="align-items:center;gap:4px">${actions}</div></article>`;
  }).join('') || '<section class="card"><p class="hint">אין משפטים להצגה בסינון הזה.</p></section>';

  const st = state.style || {};
  $('#tab-bank').innerHTML = `
  <div style="display:flex;flex-direction:column;gap:12px">
    <section class="card">
      <h2>משפט חדש</h2>
      <div class="field"><label for="b-text">הטקסט</label><textarea id="b-text" maxlength="400"></textarea></div>
      <div class="field"><label for="b-cat">קטגוריה</label><select id="b-cat">${options}</select></div>
      <div class="row">
        <button type="button" class="btn primary" style="flex:1" data-action="sent-add">הוספה למאגר</button>
        <button type="button" class="btn" style="flex:1" disabled title="יופעל בגרסה הבאה">יצירה ב-AI, בקרוב</button>
      </div>
    </section>
    <div class="row wrap">${filters}</div>
    <p class="meta">${list.length} משפטים</p>
    ${items}
    <section class="card">
      <h2>הסגנון שלך, עבור ה-AI</h2>
      <div class="field"><label for="st-base">הנחיות בסיס</label><textarea id="st-base">${esc(st.base_instructions)}</textarea></div>
      <div class="field"><label for="st-learned">מה נלמד מהדירוגים</label>
        <textarea id="st-learned" placeholder="יתמלא אוטומטית כשה-AI יופעל. אפשר גם לכתוב כאן בעצמך.">${esc(st.learned_summary)}</textarea></div>
      <button type="button" class="btn block" data-action="style-save">שמירת הסגנון</button>
    </section>
  </div>`;
}

function renderHistory() {
  const s = state.settings;
  const t = today();
  const row = state.sends.find((x) => x.send_date === t);
  let text;
  let canSkip = true;
  let canPeek = false;

  if (!s.is_active) { text = 'השליחה כבויה כרגע.'; canSkip = false; }
  else if (s.skip_date === t && (!row || row.status === 'planned')) { text = 'ביקשת לדלג על היום.'; canSkip = false; }
  else if (!row) text = `היום, בשעה אקראית בין ${hour(s.window_start_hour)} ל-${hour(s.window_end_hour)}, אם היום הוא יום שליחה.`;
  else if (row.status === 'planned') {
    canPeek = true;
    text = state.peek ? `היום, סביב השעה ${hour(row.planned_hour)}.` : 'היום. השעה כבר הוגרלה ונשארת הפתעה.';
  } else if (row.status === 'sent' || row.status === 'sending') {
    text = `ההודעה של היום נשלחה${row.sent_at ? ' בשעה ' + fmtTime(row.sent_at) : ''}.`;
    canSkip = false;
  } else { text = 'היום לא נשלחת הודעה: ' + (REASONS[row.skip_reason] || 'סיבה לא ידועה') + '.'; canSkip = false; }

  const buttons = (canPeek && !state.peek ? '<button type="button" class="btn" style="flex:1" data-action="peek">הצצה לשעה</button>' : '')
    + (canSkip ? '<button type="button" class="btn" style="flex:1" data-action="skip-today">דילוג על היום</button>' : '');

  const items = state.sends.filter((x) => x.status !== 'planned').map((x) => {
    const se = x.sentences;
    if (x.status === 'skipped' || x.status === 'failed') {
      return `<article class="card" style="flex-direction:row;align-items:center;justify-content:space-between">
        <span class="meta">${fmtDate(x.send_date)} · לא נשלח · ${esc(REASONS[x.skip_reason] || '')}</span>
        <span class="tag">${x.status === 'failed' ? 'נכשל' : 'דילוג'}</span></article>`;
    }
    const meta = [fmtDate(x.send_date), x.sent_at ? fmtTime(x.sent_at) : '', se && se.categories ? se.categories.name : '', se ? (se.source === 'ai' ? 'AI' : 'שלי') : '']
      .filter(Boolean).map(esc).join(' · ');
    const reaction = x.recipient_reaction
      ? `תגובת הנמען: ${esc(x.recipient_reaction)}${x.recipient_replied ? ', וגם ענה להודעה' : ''}`
      : (x.recipient_replied ? 'תגובת הנמען: ענה להודעה' : 'תגובת הנמען: אין תגובה');
    return `<article class="card">
      <div class="between" style="min-height:0"><span class="meta">${meta}</span>
        <span class="${x.status === 'sent' ? 'note-good' : 'note-muted'}">${x.status === 'sent' ? 'נשלח' : 'בשליחה'}</span></div>
      <p class="sentence">${se ? esc(se.text) : '<span class="meta">המשפט נמחק מהמאגר</span>'}</p>
      <div class="meta">${reaction}</div>
      <div class="between divider"><span style="font-size:14px;font-weight:500">הדירוג שלך</span>
        <div class="row" style="gap:8px">
          <button type="button" class="rate up" data-action="rate" data-id="${x.id}" data-value="1" aria-pressed="${x.user_rating === 1}" aria-label="משפט טוב">${THUMB}</button>
          <button type="button" class="rate down" data-action="rate" data-id="${x.id}" data-value="-1" aria-pressed="${x.user_rating === -1}" aria-label="משפט פחות טוב">${THUMB_DOWN}</button>
        </div></div>
      <div class="field"><label for="n-${x.id}">הערה (לא חובה)</label>
        <input id="n-${x.id}" type="text" data-note="${x.id}" value="${esc(x.user_note)}" maxlength="200"></div>
    </article>`;
  }).join('') || '<section class="card"><p class="hint">עוד לא נשלחו הודעות.</p></section>';

  $('#tab-history').innerHTML = `
  <div style="display:flex;flex-direction:column;gap:12px">
    <section class="card dark">
      <h2>ההודעה הבאה</h2>
      <p class="sentence" style="font-weight:500">${text}</p>
      ${buttons ? `<div class="row" style="gap:8px">${buttons}</div>` : ''}
    </section>
    ${items}
  </div>`;
}

/* ---------- פעולות ---------- */
function normalizePhone(raw) {
  let p = String(raw || '').replace(/\D/g, '');
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('0')) p = '972' + p.slice(1);
  return p;
}

async function saveSettings() {
  const groupValue = (g) => { const b = $$(`[data-group="${g}"]`).find(pressed); return b ? b.dataset.value : null; };
  const start = +$('#f-start').value;
  const end = +$('#f-end').value;
  const estart = +$('#f-estart').value;
  const eend = +$('#f-eend').value;
  if (end <= start || eend <= estart) { toast('שעת הסיום חייבת להיות אחרי שעת ההתחלה', true); return; }

  const phone = normalizePhone($('#f-phone').value);
  if (phone && (phone.length < 10 || phone.length > 15)) { toast('מספר הטלפון לא נראה תקין', true); return; }

  const adult = $('#f-adult').checked;
  const rel = $('#f-rel').value;
  let erotica = pressed($('#f-erotica'));
  let message = 'ההגדרות נשמרו';
  if (erotica && (!adult || rel !== 'partner')) {
    erotica = false;
    message = 'נשמר. ארוטיקה נשארה כבויה: נדרשים אישור גיל וקשר זוגי.';
  }

  const patch = {
    recipient_name: $('#f-name').value.trim() || null,
    recipient_phone: phone || null,
    sender_gender: groupValue('sender'),
    recipient_gender: groupValue('recipient'),
    relationship_type: rel,
    send_days: $$('[data-group="day"]').filter(pressed).map((b) => +b.dataset.value),
    window_start_hour: start,
    window_end_hour: end,
    block_holidays: pressed($('#f-holidays')),
    block_holiday_eves: pressed($('#f-eves')),
    block_memorial_days: pressed($('#f-memorial')),
    block_shabbat: pressed($('#f-shabbat')),
    adult_confirmed: adult,
    erotica_enabled: erotica,
    erotica_level: +$('#f-level').value,
    erotica_start_hour: estart,
    erotica_end_hour: eend,
    updated_at: new Date().toISOString(),
  };
  if (!phone) patch.is_active = false;

  state.settings = await q(state.sb.from('settings').update(patch).eq('user_id', state.user.id).select().single());
  renderAll();
  toast(message);
}

async function toggleActive() {
  const next = !state.settings.is_active;
  if (next && !state.settings.recipient_phone) { toast('קודם צריך לשמור מספר טלפון של הנמען', true); return; }
  state.settings = await q(state.sb.from('settings').update({ is_active: next }).eq('user_id', state.user.id).select().single());
  renderHeader();
  renderHistory();
  toast(next ? 'השליחה הופעלה' : 'השליחה כובתה');
}

const actions = {
  tab(el) { state.tab = el.dataset.tab; renderHeader(); window.scrollTo(0, 0); },

  press(el) {
    const group = el.dataset.group;
    if (group === 'day') { el.setAttribute('aria-pressed', String(!pressed(el))); return; }
    $$(`[data-group="${group}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
  },

  'press-toggle'(el) {
    const on = !pressed(el);
    el.setAttribute('aria-pressed', String(on));
    el.textContent = on ? 'פעיל' : 'כבוי';
  },

  'save-settings': saveSettings,
  'toggle-active': toggleActive,

  async 'login-google'() {
    const { error } = await state.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (error) throw error;
  },

  async logout() { await state.sb.auth.signOut(); },

  async 'holiday-toggle'(el) {
    const date = el.dataset.date;
    const existing = state.blocked.find((b) => b.blocked_date === date && b.send_anyway);
    if (existing) await q(state.sb.from('blocked_dates').delete().eq('id', existing.id));
    else await q(state.sb.from('blocked_dates').insert({ user_id: state.user.id, blocked_date: date, source: 'holiday', send_anyway: true }));
    await loadBlocked();
    renderBlocked();
  },

  async 'blocked-add'() {
    const date = $('#f-bdate').value;
    if (!date) { toast('בחר תאריך', true); return; }
    await q(state.sb.from('blocked_dates').upsert(
      { user_id: state.user.id, blocked_date: date, source: 'manual', description: $('#f-bdesc').value.trim() || null, send_anyway: false },
      { onConflict: 'user_id,blocked_date,source' }));
    await loadBlocked();
    renderBlocked();
    toast('התאריך נוסף');
  },

  async 'blocked-remove'(el) {
    await q(state.sb.from('blocked_dates').delete().eq('id', el.dataset.id));
    await loadBlocked();
    renderBlocked();
  },

  async 'cat-toggle'(el) {
    const id = el.dataset.id;
    const enabled = !state.userCats[id];
    await q(state.sb.from('user_categories').upsert({ user_id: state.user.id, category_id: id, enabled }, { onConflict: 'user_id,category_id' }));
    state.userCats[id] = enabled;
    el.setAttribute('aria-pressed', String(enabled));
  },

  async 'cat-add'() {
    const name = $('#f-cname').value.trim();
    if (!name) { toast('תן שם לקטגוריה', true); return; }
    const cat = await q(state.sb.from('categories').insert({ user_id: state.user.id, name, description: $('#f-cdesc').value.trim() || null }).select().single());
    await q(state.sb.from('user_categories').insert({ user_id: state.user.id, category_id: cat.id, enabled: true }));
    state.categories.push(cat);
    state.userCats[cat.id] = true;
    renderCats();
    renderBank();
    toast('הקטגוריה נוספה');
  },

  async 'cat-delete'(el) {
    const id = el.dataset.id;
    if (state.sentences.some((se) => se.category_id === id)) { toast('יש משפטים בקטגוריה הזאת. מחק או העבר אותם קודם.', true); return; }
    await q(state.sb.from('categories').delete().eq('id', id));
    state.categories = state.categories.filter((c) => c.id !== id);
    delete state.userCats[id];
    renderCats();
    renderBank();
  },

  'bank-filter'(el) { state.bankFilter = el.dataset.filter; state.editing = null; state.confirmDelete = null; renderBank(); },

  async 'sent-add'() {
    const text = $('#b-text').value.trim();
    const categoryId = $('#b-cat').value;
    if (!text) { toast('כתוב משפט', true); return; }
    if (!categoryId) { toast('בחר קטגוריה', true); return; }
    const cat = state.categories.find((c) => c.id === categoryId);
    await q(state.sb.from('sentences').insert({
      user_id: state.user.id, category_id: categoryId, text, source: 'manual',
      erotica_level: cat && cat.is_adult ? state.settings.erotica_level : null,
    }));
    await loadSentences();
    renderBank();
    toast('המשפט נוסף למאגר');
  },

  'sent-edit'(el) { state.editing = el.dataset.id; state.confirmDelete = null; renderBank(); },
  'sent-ask-delete'(el) { state.confirmDelete = el.dataset.id; state.editing = null; renderBank(); },
  'sent-cancel'() { state.editing = null; state.confirmDelete = null; renderBank(); },

  async 'sent-save'(el) {
    const id = el.dataset.id;
    const text = $('#e-' + id).value.trim();
    if (!text) { toast('המשפט ריק', true); return; }
    await q(state.sb.from('sentences').update({ text }).eq('id', id));
    state.editing = null;
    await loadSentences();
    renderBank();
    toast('המשפט עודכן');
  },

  async 'sent-status'(el) {
    const se = state.sentences.find((x) => x.id === el.dataset.id);
    const patch = se.status === 'paused' ? { status: 'active', score: Math.max(se.score, 0) } : { status: 'paused' };
    await q(state.sb.from('sentences').update(patch).eq('id', se.id));
    await loadSentences();
    renderBank();
  },

  async 'sent-delete'(el) {
    await q(state.sb.from('sentences').delete().eq('id', el.dataset.id));
    state.confirmDelete = null;
    await Promise.all([loadSentences(), loadSends()]);
    renderBank();
    renderHistory();
    toast('המשפט נמחק');
  },

  async 'style-save'() {
    state.style = await q(state.sb.from('style_profiles').upsert({
      user_id: state.user.id,
      base_instructions: $('#st-base').value.trim() || null,
      learned_summary: $('#st-learned').value.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' }).select().single());
    toast('הסגנון נשמר');
  },

  peek() { state.peek = true; renderHistory(); },

  async 'skip-today'() {
    state.settings = await q(state.sb.from('settings').update({ skip_date: today() }).eq('user_id', state.user.id).select().single());
    renderHistory();
    toast('היום לא תישלח הודעה');
  },

  async rate(el) {
    const row = state.sends.find((x) => x.id === el.dataset.id);
    const value = +el.dataset.value;
    const next = row.user_rating === value ? null : value;
    await q(state.sb.from('sends').update({ user_rating: next }).eq('id', row.id));
    row.user_rating = next;
    renderHistory();
    await loadSentences();
    renderBank();
  },
};

/* ---------- האזנה לאירועים ---------- */
document.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const handler = actions[el.dataset.action];
  if (!handler) return;
  try { await handler(el); } catch (err) { fail(err); }
});

document.addEventListener('change', async (event) => {
  const el = event.target;
  if (el.dataset && el.dataset.note) {
    try {
      const note = el.value.trim() || null;
      await q(state.sb.from('sends').update({ user_note: note }).eq('id', el.dataset.note));
      const row = state.sends.find((x) => x.id === el.dataset.note);
      if (row) row.user_note = note;
      toast('ההערה נשמרה');
    } catch (err) { fail(err); }
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'f-level') {
    const v = +event.target.value;
    $('#f-level-label').textContent = `${v}, ${LEVELS[v]}`;
  }
});

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const { error } = await state.sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-password').value });
    if (error) throw error;
  } catch (err) {
    console.error(err);
    toast('ההתחברות נכשלה. בדוק את האימייל והסיסמה.', true);
  }
});

boot();
