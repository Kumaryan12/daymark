'use strict';

const model = window.Daymark;
const $ = selector => document.querySelector(selector);
const dialog = $('#dialog');
const stateKey = 'daymark-plan-v1';
const standalone = Boolean(window.DAYMARK_STANDALONE);
let state = load();
let boardTab = 'open';
let selectedDate = '';
let weekOffset = 0;
let replayState = null;
let mode = 'file';
let processing = false;
let importDraft = [];
let demoDraft = false;
let dialogTrigger;
let toastTimer;
let worker;
let ocrMessage = '';
let ocrError = null;

const icons = {
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 10h16m-12 4h3v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  alert: '<path d="M10.3 4.8a2 2 0 0 1 3.4 0l6.7 12a2 2 0 0 1-1.7 3H5.3a2 2 0 0 1-1.7-3l6.7-12Z"/><path d="M12 9v4m0 3h.01"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  circle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.4 2.5 5-5"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6h5l2 3h4l2-3h5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  text: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8m-8 3h8m-8 3h4"/>',
  spark: '<path d="M11 3 9 9l-6 2 6 2 2 6 2-6 6-2-6-2-2-6Zm7 12 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z"/>',
  shield: '<path d="M12 3 5 6v5c0 4 2.5 7.1 7 10 4.5-2.9 7-6 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  wallet: '<rect x="4" y="6" width="16" height="13" rx="2"/><path d="m5 6 12-3v3m3 5h-5v4h5"/>',
  file: '<path d="M5 3h9l5 5v13H5V3Zm9 0v6h5M8 13h8m-8 4h6"/>',
  return: '<path d="M5 5h10l4 4v10H5V5Zm10 0v5h4M8 14h7m-4-3-3 3 3 3"/>',
  repeat: '<path d="M4 9h14l-3-3m3 3-3 3M20 15H6l3-3m-3 3 3 3"/>',
  list: '<path d="M8 6h11M8 12h11M8 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  edit: '<path d="m13 6 5 5M5 19l4-1 10-10a2.8 2.8 0 0 0-4-4L5 14l-1 5Z"/>',
  play: '<path d="m9 5 11 7-11 7V5Z"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  message: '<path d="M20 11a7 7 0 0 1-7 7H7l-4 3v-9a8 8 0 0 1 8-8h2a7 7 0 0 1 7 7Z"/><path d="M8 9h7m-7 4h5"/>',
  history: '<path d="M3 12a9 9 0 1 1 3 7m-3-7V7m0 5h5m4-5v5l3 2"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3m3 0-1 15H7L6 6m4 4v7m4-7v7"/>',
};
const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.file}</svg>`;
const icon = name => `<i data-icon="${name}">${svg(name)}</i>`;
const esc = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const identifier = () => [...crypto.getRandomValues(new Uint8Array(12))].map(n => n.toString(16).padStart(2, '0')).join('');
const find = id => state.find(item => item.id === id);
const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999');

function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(stateKey));
    if (Array.isArray(stored) && stored.every(item => item?.id && item.source && Array.isArray(item.history))) return stored;
  } catch { /* Start with a sample plan if storage is unavailable. */ }
  return model.seed();
}

function save(items) {
  try { localStorage.setItem(stateKey, JSON.stringify(items)); }
  catch { notify('This browser could not save the changes. Free some browser storage and try again.'); return false; }
  state = items;
  render();
  window.dispatchEvent(new Event('daymark-plan-changed'));
  return true;
}

function notify(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000);
}

function dueDescription(item) {
  if (!item.due) return 'No deadline';
  const days = model.daysUntil(item.due);
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `In ${days} days`;
}

const typeIcon = category => `<span class="type-icon type-${esc(category)}">${icon(model.categories[category]?.icon || 'list')}</span>`;
const isSoon = item => !item.done && item.due && model.daysUntil(item.due) >= 0 && model.daysUntil(item.due) <= 7;
const isReview = item => Boolean(!item.done && (item.pending || !item.due));

function changeLabel(item) {
  if (item.pending?.cancelled) return 'Cancellation proposed';
  if (item.pending?.due && item.due !== item.pending.due) return 'Deadline changed';
  return 'Amount changed';
}

function renderSpotlight(open) {
  const spotlight = $('#spotlight');
  if (!spotlight) return;
  const item = [...open].filter(row => row.due).sort(byDue)[0];
  if (!item) {
    spotlight.innerHTML = `<div class="next-card next-empty">
      <span class="next-icon">${icon('circle')}</span><div><small>YOUR PLAN</small>
      <strong>No scheduled deadlines</strong><span>Add a notice to schedule an action.</span></div>
    </div>`;
    return;
  }
  spotlight.innerHTML = `<button class="next-card" data-action="${item.pending ? 'review' : 'details'}" data-id="${esc(item.id)}">
    <span class="next-icon">${icon(model.categories[item.category]?.icon || 'calendar')}</span>
    <span class="next-info"><small>NEXT DEADLINE</small><strong>${esc(item.title)}</strong>
    <span>${model.fmtDate(item.due)} · ${item.pending ? 'Change to review' : dueDescription(item)}</span></span>
    <span class="next-arrow">${icon('arrow')}</span>
  </button>`;
}

function renderTimeline(open) {
  const timeline = $('#timeline');
  if (!timeline) return;
  const focused = timeline.contains(document.activeElement) ? document.activeElement.dataset : null;
  const today = model.dayKey();
  const start = model.dateAt(today, weekOffset * 7);
  const end = model.dateAt(start, 6);
  const dayNames = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' });
  const days = Array.from({ length: 7 }, (_, index) => model.dateAt(start, index));
  const counts = new Map();
  for (const item of open) {
    const current = counts.get(item.due) || { due: 0, changes: 0 };
    if (item.due) {
      current.due++;
      counts.set(item.due, current);
    }
    const proposed = item.pending?.due;
    if (proposed && proposed !== item.due) {
      const date = counts.get(proposed) || { due: 0, changes: 0 };
      date.changes++;
      counts.set(proposed, date);
    }
  }
  timeline.innerHTML = `
    <header class="schedule-head">
      <div><h2 id="timeline-title">${weekOffset === 0 ? 'Week ahead' : 'Deadline calendar'}</h2><p>${model.fmtDate(start)} – ${model.fmtDate(end, true)}</p></div>
      <div class="week-controls">
        ${weekOffset ? '<button class="today-button" data-action="week" data-shift="0">Today</button>' : ''}
        <button class="week-arrow" data-action="week" data-shift="-1" aria-label="Previous week">${icon('left')}</button>
        <button class="week-arrow" data-action="week" data-shift="1" aria-label="Next week">${icon('chevron')}</button>
      </div>
    </header>
    <div class="calendar-days" role="group" aria-label="Filter by deadline">
      ${days.map(date => {
        const { due, changes } = counts.get(date) || { due: 0, changes: 0 };
        const label = `${model.fmtDate(date, true)}${date === today ? ', today' : ''}, ${due} due, ${changes} proposed`;
        return `<button class="calendar-day ${date === today ? 'calendar-today' : ''}" data-action="date" data-date="${date}" aria-label="${label}" aria-pressed="${selectedDate === date}">
          <span>${date === today ? 'Today' : dayNames.format(new Date(date + 'T00:00:00Z'))}</span><strong>${Number(date.slice(-2))}</strong>
          <span class="day-marks" aria-hidden="true">${due ? `<b class="day-due">${due}</b>` : ''}${changes ? `<b class="day-proposal">${changes}</b>` : ''}</span>
        </button>`;
      }).join('')}
    </div>
    <div class="calendar-legend"><span><b class="day-due"></b> Saved deadline</span><span><b class="day-proposal"></b> Proposed date</span>
    ${selectedDate ? '<button class="text-button" data-action="clear-date">Clear date filter</button>' : ''}</div>`;
  if (focused) {
    const buttons = [...timeline.querySelectorAll('button')];
    const same = buttons.find(button => button.dataset.action === focused.action &&
      button.dataset.date === focused.date && button.dataset.shift === focused.shift);
    (same || timeline.querySelector('[data-action="date"]'))?.focus({ preventScroll: true });
  }
}

function render() {
  $('#today').textContent = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date());
  const open = state.filter(item => !item.done);
  const done = state.filter(item => item.done);
  const reviews = open.filter(isReview);
  renderSpotlight(open);
  renderTimeline(open);
  const stats = [
    ['soon', open.filter(isSoon).length, 'Due within 7 days', 'clock', ''],
    ['updates', reviews.length, 'Needs review', 'alert', 'warn'],
    ['done', done.length, 'Completed', 'circle', 'complete'],
  ];
  if (!$('#stats').childElementCount) {
    $('#stats').innerHTML = stats.map(([key, , label, symbol, color]) =>
      `<button class="stat" data-action="tab" data-stat="${key}">
        <span class="stat-icon ${color}">${icon(symbol)}</span><span class="stat-value"><strong></strong><small>${label}</small></span>${icon('chevron')}
      </button>`).join('');
  }
  for (const [key, value] of stats) {
    const stat = document.querySelector(`[data-stat="${key}"]`);
    stat.querySelector('strong').textContent = value;
    stat.setAttribute('aria-pressed', String(!selectedDate && boardTab === key));
  }
  const dateMatches = item => item.due === selectedDate || item.pending?.due === selectedDate;
  const filtered = selectedDate ? open.filter(dateMatches) :
    boardTab === 'done' ? done : boardTab === 'updates' ? reviews : boardTab === 'soon' ? open.filter(isSoon) : open;
  const label = selectedDate ? 'on ' + model.fmtDate(selectedDate) : { open: 'open', done: 'completed', updates: 'to review', soon: 'due soon' }[boardTab];
  $('#board-summary').textContent = `${filtered.length} ${filtered.length === 1 ? 'action' : 'actions'} ${label}${state.some(item => item.demo) ? ' · Sample notices included' : ''}`;
  $('#tabs').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(!selectedDate && button.dataset.tab === boardTab)));
  const rows = [...filtered].sort(byDue);
  if (!rows.length) {
    const emptyText = selectedDate ? ['No deadlines on ' + model.fmtDate(selectedDate), 'Choose another date or clear the date filter.'] : {
      open: ['Your action plan is clear', 'Add a notice to start tracking what’s due.'],
      soon: ['Nothing due soon', 'Upcoming deadlines within seven days will appear here.'],
      updates: ['Nothing to review', 'Missing dates and changes to saved notices will appear here.'],
      done: ['No completed actions yet', 'Mark an action done to find it here.'],
    }[boardTab];
    $('#actions').innerHTML = `<div class="empty"><h3>${emptyText[0]}</h3><p>${emptyText[1]}</p>${selectedDate ? '<button class="button outline" data-action="clear-date">See all open actions</button>' : boardTab === 'open' ? '<button class="button outline" data-action="add">Add a notice</button>' : ''}</div>`;
    return;
  }
  $('#actions').innerHTML = `<div class="action-list">${rows.map(item => `
    <article class="action-row ${item.pending ? 'changed' : ''}">
      ${typeIcon(item.category)}
      <div>
        <div class="row-main"><button class="row-title" data-action="details" data-id="${esc(item.id)}">${esc(item.title)}</button>
        ${item.pending ? `<span class="badge warn">${icon('alert')}${changeLabel(item)}</span>` : item.cancelled ? '<span class="badge">Cancelled</span>' : ''}</div>
        <p class="row-sub">${esc([item.source.name, model.currency(item.amount)].filter(Boolean).join(' · '))}</p>
        ${selectedDate && item.pending?.due === selectedDate && item.due !== selectedDate ? '<p class="row-sub proposed-line">Proposed for this date</p>' : ''}
      </div>
      <div class="row-end">
        ${item.cancelled ? '' : `<span class="due-cluster ${!item.done && model.daysUntil(item.due) < 0 ? 'overdue' : ''}"><strong>${model.fmtDate(item.due)}</strong><small>${item.done ? 'Done' : dueDescription(item)}</small></span>`}
        ${item.pending ? `<button class="button outline row-button" data-action="review" data-id="${esc(item.id)}">Review change</button>` : item.cancelled ? '' : `<button class="row-check" data-action="done" data-id="${esc(item.id)}" aria-pressed="${item.done}" aria-label="${item.done ? 'Reopen' : 'Mark done'}: ${esc(item.title)}" title="${item.done ? 'Reopen' : 'Mark done'}">${icon('check')}</button>`}
      </div>
    </article>`).join('')}</div>`;
}

function openDialog(title, subtitle, body, symbol = '') {
  if (!dialog.open) dialogTrigger = document.activeElement;
  dialog.innerHTML = `<div class="dialog-wrap"><header class="dialog-head">${symbol}<div><h2 id="dialog-title" tabindex="-1">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
    <button class="icon-button" type="button" data-action="close" aria-label="Close dialog">${icon('x')}</button>
    </header>${body}</div>`;
  if (!dialog.open) dialog.showModal();
  $('#dialog-title').focus();
}

dialog.addEventListener('close', () => {
  if (dialogTrigger?.isConnected) dialogTrigger.focus({ preventScroll: true });
  else {
    $('#plan-title').setAttribute('tabindex', '-1');
    $('#plan-title').focus({ preventScroll: true });
  }
  dialogTrigger = null;
});

const fullSource = (source, title = 'Read extracted notice text') =>
  `<details><summary>${esc(title)}</summary><div class="source-text">${source.sentAt ? 'Message dated ' + esc(source.sentAt.replace('T', ' · ')) + '\n\n' : ''}${esc(source.text)}</div></details>`;
const quotes = source => source.quotes.length ? `<blockquote>${esc(source.quotes.join('\n'))}</blockquote>` : '';
const detail = (label, value) => `<div class="detail"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`;

function details(item) {
  if (!item) return;
  openDialog(item.title, [item.issuer, item.reference].filter(Boolean).join(' · ') || item.source.name, `
    ${item.pending ? `<p class="review-note">${changeLabel(item)}. <button class="text-button" data-action="review" data-id="${esc(item.id)}">Compare the notices</button></p>` : ''}
    <div class="detail-grid">${detail('Due date', item.cancelled ? 'Cancelled' : model.fmtDate(item.due, true))}${detail('Amount', model.currency(item.amount) || '—')}</div>
    <h3>Source text</h3>${quotes(item.source)}${fullSource(item.source)}
    ${item.history.map((entry, index) => fullSource(entry.source, 'Previous notice ' + (index + 1) + ' · ' + model.fmtDate(entry.due, true))).join('')}
    ${!item.done && !item.cancelled ? '<div class="reminder-line">' + icon('clock') + (item.reminder ? 'Reminder at ' + esc(item.reminder.time) + ' on the due date' : 'No reminder set') + ' <button class="text-button" data-action="reminders">Manage reminders</button></div>' : ''}
    <div class="dialog-actions">
      <button type="button" class="button danger" data-action="delete" data-id="${esc(item.id)}">${icon('trash')} Remove action</button>
      ${item.cancelled ? '' : `<button type="button" class="button outline" data-action="edit" data-id="${esc(item.id)}">${icon('edit')} Edit action</button>`}
      <button type="button" class="button dark" data-action="close">Done</button>
    </div>`, typeIcon(item.category));
}

function dateShift(current, proposed) {
  if (!current || !proposed || current === proposed) return '';
  const offset = model.daysUntil(proposed, current);
  const days = Math.abs(offset);
  return days + (days === 1 ? ' day ' : ' days ') + (offset > 0 ? 'later' : 'earlier');
}

function dateComparison(current, proposed) {
  const shift = dateShift(current, proposed);
  if (!shift) return '';
  return `<div class="date-comparison">
    <span><small>Saved</small><strong>${model.fmtDate(current)}</strong></span>
    ${icon('arrow')}
    <span><small>Proposed</small><strong>${model.fmtDate(proposed)}</strong></span>
    <b>${shift}</b>
  </div>`;
}

function startReplay() {
  const today = model.dayKey();
  const original = 'Campus accounts\nRef CF-104\nPlease pay semester fees of ₹2,500 by ' + model.fmtDate(today, true) + '.';
  const [first] = model.parse(original, 'Sample · College notice', { sender: 'Campus accounts', sentAt: model.dateAt(today, -1) + 'T09:00' });
  const [correction] = model.parse('Guys, semester fees extended to Friday.', 'Sample · Class group', { sender: 'Campus accounts', sentAt: model.dateAt(today, 1) + 'T11:30' });
  const second = model.dateEvidence(correction);
  const initial = model.merge([], first, 'replay-notice').items;
  const [item] = model.merge(initial, { ...second, targetId: 'replay-notice' }, 'replay-revision').items;
  replayState = { step: 0, item, result: null, accepted: false };
  renderReplay();
}

function replayNotice(source, heading, variant = '') {
  return `<article class="replay-message ${variant}">
    <span class="replay-avatar" aria-hidden="true">MR</span>
    <div><header><strong>Campus accounts</strong><span>${heading}</span></header>
    ${quotes(source)}<small>${source.sentAt ? esc(source.sentAt.replace('T', ' · ')) : 'Sample notice'}</small></div>
  </article>`;
}

function renderReplay() {
  const { step, item, result, accepted } = replayState;
  const proposed = item.pending.due;
  const steps = ['Original notice', 'Correction arrives', 'Your decision'];
  const stepper = `<ol class="replay-steps" aria-label="Replay progress">${steps.map((label, index) =>
    `<li class="${index <= step ? 'reached' : ''}" ${index === step ? 'aria-current="step"' : ''}><span>${index < step ? icon('check') : index + 1}</span>${label}</li>`
  ).join('')}</ol>`;
  let content;
  if (step === 0) {
    content = `<p class="replay-intro">A semester fee notice arrives from college accounts. Daymark finds the due date and keeps the original wording beside it.</p>
      ${replayNotice(item.source, 'Original notice')}
      <div class="replay-facts">${detail('Action', 'Pay semester fees')}${detail('Due date', model.fmtDate(item.due, true))}${detail('Amount', model.currency(item.amount))}</div>
      <div class="dialog-actions"><button class="button dark" data-action="replay-arrive">Reveal the follow-up ${icon('arrow')}</button></div>`;
  } else if (step === 1) {
    content = `<p class="replay-intro">The class group says “extended to Friday” and omits the notice number. Sender, topic and message date help connect the correction.</p>
      <div class="replay-pair">${replayNotice(item.source, 'Saved notice')}${replayNotice(item.pending.source, 'New message', 'replay-arrived')}</div>
      <div class="match-evidence">${item.pending.evidence.map(value => '<span>' + icon('check') + esc(value) + '</span>').join('')}</div>
      <p class="dialog-copy">${esc(item.pending.interpretation || '')}</p>
      ${dateComparison(item.due, proposed)}
      <div class="dialog-actions">
        <button class="button outline" data-choice="original" data-action="replay-decision">Keep original date</button>
        <button class="button dark" data-choice="updated" data-action="replay-decision">${icon('check')} Use ${model.fmtDate(proposed)}</button>
      </div>`;
  } else {
    content = `<div class="replay-result">
      <span class="replay-result-icon">${icon(accepted ? 'circle' : 'history')}</span>
      <h3>${accepted ? 'Deadline updated' : 'Saved deadline kept'}</h3>
      <p>The sample action is due <strong>${model.fmtDate(result.due, true)}</strong>.</p>
      <p>${accepted ? 'The earlier notice is available in its source history.' : 'The original notice stays attached to the action.'}</p>
    </div>
    <div class="dialog-actions"><button class="button outline" data-action="replay">Replay again</button>
    <button class="button dark" data-action="close">Back to my plan</button></div>`;
  }
  openDialog('Deadline replay', 'Try it with a sample notice. Your own plan stays separate.', `<div class="replay-board">${stepper}${content}</div>`,
    `<span class="tool-icon">${icon('play')}</span>`);
}

function review(item) {
  if (!item?.pending) return;
  const next = item.pending;
  const proposed = next.cancelled ? 'Cancelled' : model.fmtDate(next.due || item.due, true);
  const pane = (kind, heading, date, amount, source) => `<div class="compare-pane ${kind}"><small>${heading}</small><strong>${esc(date)}</strong>
    ${amount !== '' ? `<p>${esc(model.currency(amount))}</p>` : ''}${quotes(source)}${fullSource(source, 'Full notice')}</div>`;
  openDialog(changeLabel(item), [item.title, item.reference].filter(Boolean).join(' · '), `
    <p class="dialog-copy">Compare the saved notice with the proposed change. Your plan updates when you approve it.</p>
    ${next.evidence?.length ? '<div class="match-evidence">' + next.evidence.map(value => '<span>' + icon('check') + esc(value) + '</span>').join('') + '</div>' : ''}
    ${next.source.sentAt ? '<p class="dialog-copy">Message dated ' + esc(next.source.sentAt.replace('T', ' · ')) + '</p>' : ''}
    ${dateComparison(item.due, next.due)}
    <div class="compare">${pane('', 'Saved in your plan', model.fmtDate(item.due, true), item.amount, item.source)}
      ${pane('proposed', 'Proposed change', proposed, next.cancelled ? '' : next.amount === '' ? item.amount : next.amount, next.source)}</div>
    <div class="dialog-actions">
      <button class="button outline" data-action="reject" data-id="${esc(item.id)}">Keep saved notice</button>
      <button class="button dark" data-action="accept" data-id="${esc(item.id)}">${icon('check')} ${next.cancelled ? 'Confirm cancellation' : 'Use updated notice'}</button>
    </div>`, typeIcon(item.category));
}

function formFields(item, index) {
  return `<label class="field">Action<input name="title-${index}" value="${esc(item.title)}" maxlength="100" required></label>
    <div class="detail-grid"><label class="field">Due date<input type="date" name="due-${index}" value="${esc(item.due)}" min="2000-01-01" max="2199-12-31"></label>
    <label class="field">Amount (₹)<input type="number" name="amount-${index}" value="${esc(item.amount)}" step="0.01" min="0" max="999999999" placeholder="Optional"></label>
    <label class="field">Sender<input name="issuer-${index}" value="${esc(item.issuer)}" maxlength="80" placeholder="Optional"></label>
    <label class="field">Reference<input name="reference-${index}" value="${esc(item.reference)}" maxlength="40" placeholder="Optional"></label></div>`;
}

function beginDraft(text, sourceName, isDemo = false) {
  const drafts = model.parse(text, sourceName);
  importDraft = drafts;
  demoDraft = isDemo;
  if (!drafts.length) throw new Error('No notice text could be read. Paste the text and try again.');
  openDialog('Review extracted actions', `${sourceName} · ${drafts.length} ${drafts.length === 1 ? 'action' : 'actions'}`, `
    <form id="draft-form">
      ${drafts.map((candidate, index) => `<fieldset class="draft" data-draft="${index}"><legend>${esc(model.categories[candidate.category].label)}</legend>
          ${formFields(candidate, index)}
          <label class="field">Original message date and time
            <input type="datetime-local" name="sent-${index}" value="${esc(candidate.source.sentAt)}">
            <small>Use the time on the message. Relative dates are interpreted from this date.</small>
          </label>
          <div class="draft-issues" data-issues="${index}">${candidate.issues.map(issue => `<p class="review-note">${esc(issue)}</p>`).join('')}</div>
          <div class="match-options" data-matches="${index}"></div>
          ${quotes(candidate.source)}
          ${candidate.cancelled ? `<label class="check-field"><input type="checkbox" name="cancelled-${index}" checked> This notice cancels the earlier action</label>` : ''}
        </fieldset>`).join('')}
      ${fullSource(drafts[0].source)}
      <p class="dialog-error" role="alert" hidden></p>
      <div class="dialog-actions"><button type="button" class="button outline" data-action="close">Cancel</button><button class="button dark" type="submit">${icon('check')} Save to action plan</button></div>
    </form>`);
  drafts.forEach((candidate, index) => updateDraftMatches(index));
}

function updateDraftMatches(index) {
  const form = $('#draft-form');
  if (!form) return;
  const candidate = importDraft[index];
  const data = new FormData(form);
  const fields = fieldValues(data, index);
  const sentAt = String(data.get('sent-' + index) || '');
  const proposal = model.dateEvidence({ ...candidate, ...fields, source: { ...candidate.source, sentAt } });
  const dateInput = form.elements['due-' + index];
  const autoDate = dateInput.dataset.inferred || '';
  if (!candidate.due && (!dateInput.value || dateInput.value === autoDate)) {
    const interpretation = model.relativeDate(candidate.source.quotes.join(' ') || candidate.source.text, sentAt);
    dateInput.value = interpretation?.due || '';
    dateInput.dataset.inferred = dateInput.value;
    proposal.due = dateInput.value;
  }
  const target = form.querySelector('[data-matches="' + index + '"]');
  const previous = target.querySelector('input:checked')?.value;
  const matches = model.matchCandidates(state, proposal).slice(0, 5);
  const inferred = model.relativeDate(candidate.source.quotes.join(' ') || candidate.source.text, sentAt);
  const notes = [...candidate.issues.filter(issue => !inferred || !/relative date|No explicit deadline/.test(issue))];
  if (inferred) notes.push(inferred.explanation);
  form.querySelector('[data-issues="' + index + '"]').innerHTML = notes.map(issue => '<p class="review-note">' + esc(issue) + '</p>').join('');
  if (!matches.length) {
    target.innerHTML = '<p class="dialog-copy">No related action found. This will create a new action.</p>';
    return;
  }
  const defaultId = matches.length === 1 && matches[0].exact ? matches[0].id : '';
  const selected = previous || defaultId;
  target.innerHTML = '<h3>Does this belong to an existing action?</h3>' + matches.map(match => `
    <label class="match-choice"><input type="radio" name="target-${index}" value="${esc(match.id)}" ${selected === match.id ? 'checked' : ''} required>
    <span><strong>${esc(match.title)}</strong><small>${match.evidence.map(esc).join(' · ')}</small>
    ${match.older ? '<b class="badge warn">Older notice · will go into source history</b>' : ''}</span></label>`).join('') +
    `<label class="match-choice"><input type="radio" name="target-${index}" value="new" ${selected === 'new' ? 'checked' : ''} required><span><strong>Create a separate action</strong></span></label>`;
}

function fieldValues(form, index) {
  const read = key => String(form.get(key + '-' + index) || '').trim();
  const amount = read('amount');
  return {
    title: read('title'),
    due: read('due'),
    amount: amount === '' ? '' : String(Number(amount)),
    issuer: read('issuer'),
    reference: read('reference').toUpperCase().replaceAll(' ', '-'),
  };
}

function showFormError(message) {
  const error = dialog.querySelector('.dialog-error');
  if (error) { error.textContent = message; error.hidden = false; }
  else notify(message);
}

function edit(item) {
  openDialog('Edit action', 'The original notice text stays attached.', `<form id="edit-form" data-id="${esc(item.id)}">
    ${formFields(item, 0)}<p class="dialog-error" role="alert" hidden></p>
    <div class="dialog-actions"><button class="button outline" type="button" data-action="details" data-id="${esc(item.id)}">Back</button><button class="button dark" type="submit">Save changes</button></div></form>`);
}

function privacy() {
  openDialog('Data & privacy', 'Your action plan is stored in this browser.', `
    <p class="dialog-copy">Daymark reads files on your device. Saved actions include the extracted notice text so you can trace each field back to its source. Anyone using this browser profile can open the plan.</p>
    <p class="dialog-copy">When you enable device reminders, the AWS service stores the selected action titles, reminder times and a push subscription for this browser. Disable reminders in the Reminders panel to remove that device record. Calendar exports include titles, dates and amounts for reviewed actions. Opening an export in a calendar can sync those details with that calendar provider.</p>
    <div class="dialog-actions"><button class="button outline" data-action="remove-samples">Remove sample actions</button><button class="button danger" data-action="clear-plan">Clear this plan</button><button class="button dark" data-action="close">Done</button></div>`, `<span class="tool-icon">${icon('shield')}</span>`);
}

function confirmRemoval(id) {
  const item = find(id);
  if (id && !item) return;
  openDialog(id ? 'Remove this action?' : 'Clear this plan?', '', `
    <p class="dialog-copy">${item ? esc(item.title) + ' and its saved notice text will be removed from this browser.' : 'All actions and saved notice text will be removed from this browser.'}</p>
    <div class="dialog-actions"><button class="button outline" data-action="close">Cancel</button><button class="button danger" data-action="remove-confirm" ${id ? `data-id="${esc(id)}"` : ''}>${id ? 'Remove action' : 'Clear plan'}</button></div>`);
}

function openImporter() {
  $('#add-notice').scrollIntoView({ block: 'nearest' });
  $('#add-title').focus({ preventScroll: true });
}

function setMode(next) {
  mode = next;
  $('#file-pane').hidden = mode !== 'file';
  $('#text-pane').hidden = mode !== 'text';
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
}

function importStatus(message, isError = false) {
  const status = $('#import-status');
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle('error', isError);
}

function progress(active) {
  processing = active;
  document.querySelectorAll('[data-mode], [data-action="sample"], #drop-zone, #text-pane button').forEach(button => button.disabled = active);
}

const assetUrl = path => new URL('assets/vendor/' + path, document.baseURI).href;
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = resolve;
    script.onerror = () => { script.remove(); reject(new Error('The image reader could not load. Try again or paste the notice text.')); };
    document.head.append(script);
  });
}

async function readImage(image) {
  if (!window.Tesseract) await loadScript(assetUrl('ocr/tesseract.min.js'));
  if (!worker) {
    const workerLoad = window.Tesseract.createWorker('eng', 1, {
      workerPath: assetUrl('ocr/worker.min.js'),
      corePath: assetUrl('ocr/tesseract-core-lstm.wasm.js'),
      langPath: assetUrl('ocr/'),
      workerBlobURL: false,
      logger: event => {
        if (event.status === 'recognizing text') importStatus(ocrMessage + ' ' + Math.round(event.progress * 100) + '%');
      },
      errorHandler: error => { if (ocrError) ocrError(error instanceof Error ? error : new Error(String(error))); },
    });
    worker = await new Promise((resolve, reject) => {
      ocrError = reject;
      workerLoad.then(resolve, reject);
    }).finally(() => { ocrError = null; });
  }
  try {
    const recognition = worker.recognize(image);
    const result = await new Promise((resolve, reject) => {
      ocrError = reject;
      recognition.then(resolve, reject);
    });
    return result.data.text;
  } catch (error) {
    await worker.terminate().catch(() => {});
    worker = null;
    throw error;
  } finally { ocrError = null; }
}

async function readPdf(file) {
  const pdfjs = await import(assetUrl('pdf/pdf.min.mjs'));
  pdfjs.GlobalWorkerOptions.workerSrc = assetUrl('pdf/pdf.worker.min.mjs');
  const task = pdfjs.getDocument({
    data: await file.arrayBuffer(),
    isEvalSupported: false,
    useSystemFonts: true,
    cMapUrl: assetUrl('pdf/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('pdf/standard_fonts/'),
    wasmUrl: assetUrl('pdf/wasm/'),
    iccUrl: assetUrl('pdf/iccs/'),
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 12) throw new Error('Choose a PDF with up to 12 pages, or paste the relevant section.');
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      importStatus(`Reading PDF page ${i} of ${pdf.numPages}…`);
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let lastY;
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5];
        if (lastY !== undefined && Math.abs(y - lastY) > 3 && !text.endsWith('\n')) text += '\n';
        else if (text && !text.endsWith('\n')) text += ' ';
        text += item.str + (item.hasEOL ? '\n' : '');
        lastY = y;
      }
      if (text.trim().length < 30) {
        const natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2.1, 1900 / Math.max(natural.width, natural.height)) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
        ocrMessage = `Reading scanned page ${i} of ${pdf.numPages}…`;
        text = await readImage(canvas);
      }
      pages.push(text.trim());
      page.cleanup();
    }
    return pages.join('\n');
  } finally { await task.destroy(); }
}

async function processFile(file) {
  if (!file || processing) return;
  if (file.size > 15 * 1024 * 1024) { importStatus('Choose a file up to 15 MB.', true); return; }
  const fileName = file.name;
  const isText = file.type === 'text/plain' || /\.txt$/i.test(fileName);
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(fileName);
  const isPicture = /^image\/(png|jpeg|webp)$/.test(file.type) || /\.(?:png|jpe?g|webp)$/i.test(fileName);
  if (!isText && !isPdf && !isPicture) { importStatus('Choose a PNG, JPG, WEBP, PDF or TXT.', true); return; }
  if (standalone && !isText) { importStatus('Use the hosted app to read screenshots or PDFs, or paste the notice text here.', true); return; }
  progress(true);
  importStatus('Reading ' + fileName + '…');
  try {
    ocrMessage = 'Reading screenshot…';
    const text = isText ? await file.text() : isPdf ? await readPdf(file) : await readImage(file);
    if (!text.trim()) throw new Error('No text was found. Try a sharper image or paste the notice text.');
    beginDraft(text, fileName);
    importStatus(text.length > 30000 ? 'Showing the first 30,000 characters. Review longer notices in sections.' : '');
  } catch (error) {
    const message = error?.name === 'PasswordException' ? 'Open the password-protected PDF and paste the relevant text.' :
      error instanceof Error ? error.message : 'This file could not be read. Try pasting the text.';
    importStatus(message, true);
  } finally { progress(false); $('#file-picker').value = ''; }
}

function exportCalendar() {
  const actions = state.filter(item => item.due && !item.done && !item.pending);
  if (!actions.length) { notify('Add a date or review outstanding changes before exporting.'); return; }
  const blob = new Blob([model.makeCalendar(actions)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'daymark-deadlines.ics';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify(`Calendar exported with ${actions.length} ${actions.length === 1 ? 'deadline' : 'deadlines'}.`);
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id, tab, stat, mode: next } = button.dataset;
  const item = id ? find(id) : null;
  switch (action) {
    case 'add': openImporter(); break;
    case 'phone-capture': window.DaymarkDevice?.showCapture(); break;
    case 'reminders': window.DaymarkDevice?.showReminders(); break;
    case 'tab': boardTab = tab || stat; selectedDate = ''; render(); break;
    case 'week': {
      const shift = Number(button.dataset.shift);
      weekOffset = shift === 0 ? 0 : weekOffset + shift;
      selectedDate = '';
      render();
      break;
    }
    case 'date': selectedDate = selectedDate === button.dataset.date ? '' : button.dataset.date; boardTab = 'open'; render(); break;
    case 'clear-date': {
      const callButton = button.closest('#actions');
      selectedDate = '';
      boardTab = 'open';
      render();
      if (callButton) $('#tabs button').focus({ preventScroll: true });
      break;
    }
    case 'replay': startReplay(); break;
    case 'replay-arrive': replayState.step = 1; renderReplay(); break;
    case 'replay-decision': {
      const accepted = button.dataset.choice === 'updated';
      replayState.result = model.resolve([replayState.item], replayState.item.id, accepted)[0];
      replayState.accepted = accepted;
      replayState.step = 2;
      renderReplay();
      break;
    }
    case 'input': setMode(next); break;
    case 'select-file': $('#file-picker').click(); break;
    case 'sample': beginDraft(model.sample('school'), 'School message · Sample', true); break;
    case 'close': dialog.close(); break;
    case 'details': details(item); break;
    case 'review': review(item); break;
    case 'edit': if (item) edit(item); break;
    case 'export': exportCalendar(); break;
    case 'privacy': privacy(); break;
    case 'done':
      if (item && save(state.map(row => row.id === id ? { ...row, done: !row.done } : row))) {
        const nextButton = document.querySelector(`[data-action="done"][data-id="${CSS.escape(id)}"]`);
        if (nextButton) nextButton.focus();
        else $('#tabs').querySelector('[aria-pressed="true"]')?.focus();
        notify(item.done ? 'Action reopened.' : 'Action completed.');
      }
      break;
    case 'accept':
    case 'reject':
      if (item && save(model.resolve(state, id, action === 'accept'))) {
        dialog.close();
        notify(action === 'accept' ? 'Action plan updated. The earlier notice is in the source history.' : 'Kept the saved notice.');
      }
      break;
    case 'clear-plan': confirmRemoval(); break;
    case 'delete': confirmRemoval(id); break;
    case 'remove-confirm':
      if (save(id ? state.filter(row => row.id !== id) : [])) { dialog.close(); notify(id ? 'Action removed.' : 'Plan cleared.'); }
      break;
    case 'remove-samples':
      if (save(state.filter(row => !row.demo))) { dialog.close(); notify('Sample actions removed.'); }
      break;
  }
});

dialog.addEventListener('submit', event => {
  const form = event.target;
  if (!['edit-form', 'draft-form'].includes(form.id)) return;
  const data = new FormData(form);
  if (form.id === 'edit-form') {
    event.preventDefault();
    const fields = fieldValues(data, 0);
    if (!fields.title) { showFormError('Enter an action name.'); return; }
    if (save(state.map(item => item.id === form.dataset.id ? { ...item, ...fields } : item))) {
      dialog.close();
      notify('Action saved.');
    }
  }
  if (form.id !== 'draft-form') return;
  event.preventDefault();
  let next = state;
  let added = 0;
  let updates = 0;
  let archived = 0;
  for (const [index, candidate] of importDraft.entries()) {
    const targetId = String(data.get('target-' + index) || '');
    const draft = { ...candidate, ...fieldValues(data, index), demo: demoDraft,
      source: { ...candidate.source, sentAt: String(data.get('sent-' + index) || '') },
      targetId: targetId === 'new' ? '' : targetId, keepSeparate: targetId === 'new',
      cancelled: candidate.cancelled && data.has('cancelled-' + index) };
    if (!draft.title) { showFormError('Enter a name for each action.'); return; }
    if (draft.cancelled && !model.matchAction(next, draft)) {
      showFormError('No open action matches this cancellation. Check the sender and reference, or clear the cancellation checkbox to save a follow-up.');
      return;
    }
    const result = model.merge(next, draft, identifier());
    next = result.items;
    added += Number(result.change === 'added');
    updates += Number(result.change === 'updated');
    archived += Number(result.change === 'archived');
  }
  if (next.length > 55) { showFormError('This plan has 55 actions. Remove some old actions and try again.'); return; }
  boardTab = updates ? 'updates' : 'open';
  selectedDate = '';
  if (save(next)) {
    dialog.close();
    $('#notice-text').value = '';
    notify(added + updates + archived ? [archived ? `${archived} older notice archived` : '', added ? `${added} added` : '', updates ? `${updates} change${updates === 1 ? '' : 's'} to review` : ''].filter(Boolean).join(' · ') + '.' : 'This notice is already in your plan.');
  }
});

$('#text-pane').addEventListener('submit', event => {
  event.preventDefault();
  if (!processing) {
    try { beginDraft($('#notice-text').value, 'Pasted notice'); importStatus(''); }
    catch (error) { importStatus(error.message, true); }
  }
});
$('#file-picker').addEventListener('change', event => void processFile(event.target.files[0]));
const drop = $('#drop-zone');
drop.addEventListener('dragover', event => { event.preventDefault(); if (!processing) drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('drag'); void processFile(event.dataTransfer.files[0]); });
window.addEventListener('storage', event => {
  if (event.key === stateKey) { state = load(); if (!dialog.open) render(); }
});
dialog.addEventListener('change', event => {
  const fieldset = event.target.closest('[data-draft]');
  if (fieldset && !event.target.name.startsWith('target-') && !event.target.name.startsWith('cancelled-')) updateDraftMatches(Number(fieldset.dataset.draft));
});
document.addEventListener('paste', event => {
  if (event.target.matches('input,textarea,[contenteditable]') || processing || dialog.open) return;
  const file = [...(event.clipboardData?.files || [])].find(file => file.type.startsWith('image/'));
  if (file) { event.preventDefault(); void processFile(file); }
});
window.DaymarkApp = {
  getState: () => state,
  save,
  openDialog,
  notify,
  beginDraft,
  processFile,
  icon,
  esc,
};
document.querySelectorAll('i[data-icon]').forEach(el => el.innerHTML = svg(el.dataset.icon));
if (standalone) {
  $('#drop-zone small').textContent = 'TXT · Use the hosted app for images and PDFs';
  $('#file-picker').accept = 'text/plain,.txt';
  setMode('text');
}
render();
