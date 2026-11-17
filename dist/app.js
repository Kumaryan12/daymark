'use strict';

const model = window.Daymark;
const $ = selector => document.querySelector(selector);
const dialog = $('#dialog');
const stateKey = 'daymark-plan-v1';
const standalone = Boolean(window.DAYMARK_STANDALONE);
let state = load();
let boardTab = 'open';
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

function render() {
  $('#today').textContent = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date());
  const open = state.filter(item => !item.done);
  const done = state.filter(item => item.done);
  const reviews = open.filter(isReview);
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
    stat.setAttribute('aria-pressed', String(boardTab === key));
  }
  const filtered = boardTab === 'done' ? done : boardTab === 'updates' ? reviews : boardTab === 'soon' ? open.filter(isSoon) : open;
  const label = { open: 'open', done: 'completed', updates: 'to review', soon: 'due soon' }[boardTab];
  $('#board-summary').textContent = `${filtered.length} ${filtered.length === 1 ? 'action' : 'actions'} ${label}${state.some(item => item.demo) ? ' · Sample notices included' : ''}`;
  $('#tabs').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tab === boardTab)));
  const rows = [...filtered].sort(byDue);
  if (!rows.length) {
    const emptyText = {
      open: ['Your action plan is clear', 'Add a notice to start tracking what’s due.'],
      soon: ['Nothing due soon', 'Upcoming deadlines within seven days will appear here.'],
      updates: ['Nothing to review', 'Missing dates and changes to saved notices will appear here.'],
      done: ['No completed actions yet', 'Mark an action done to find it here.'],
    }[boardTab];
    $('#actions').innerHTML = `<div class="empty"><h3>${emptyText[0]}</h3><p>${emptyText[1]}</p>${boardTab === 'open' ? '<button class="button outline" data-action="add">Add a notice</button>' : ''}</div>`;
    return;
  }
  $('#actions').innerHTML = `<div class="action-list">${rows.map(item => `
    <article class="action-row ${item.pending ? 'changed' : ''}">
      ${typeIcon(item.category)}
      <div>
        <div class="row-main"><button class="row-title" data-action="details" data-id="${esc(item.id)}">${esc(item.title)}</button>
        ${item.pending ? `<span class="badge warn">${icon('alert')}${changeLabel(item)}</span>` : item.cancelled ? '<span class="badge">Cancelled</span>' : ''}</div>
        <p class="row-sub">${esc([item.source.name, model.currency(item.amount)].filter(Boolean).join(' · '))}</p>
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
  `<details><summary>${esc(title)}</summary><div class="source-text">${esc(source.text)}</div></details>`;
const quotes = source => source.quotes.length ? `<blockquote>${esc(source.quotes.join('\n'))}</blockquote>` : '';
const detail = (label, value) => `<div class="detail"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`;

function details(item) {
  if (!item) return;
  openDialog(item.title, [item.issuer, item.reference].filter(Boolean).join(' · ') || item.source.name, `
    ${item.pending ? `<p class="review-note">${changeLabel(item)}. <button class="text-button" data-action="review" data-id="${esc(item.id)}">Compare the notices</button></p>` : ''}
    <div class="detail-grid">${detail('Due date', item.cancelled ? 'Cancelled' : model.fmtDate(item.due, true))}${detail('Amount', model.currency(item.amount) || '—')}</div>
    <h3>Source text</h3>${quotes(item.source)}${fullSource(item.source)}
    ${item.history.map((entry, index) => fullSource(entry.source, 'Previous notice ' + (index + 1) + ' · ' + model.fmtDate(entry.due, true))).join('')}
    <div class="dialog-actions">
      <button type="button" class="button danger" data-action="delete" data-id="${esc(item.id)}">${icon('trash')} Remove action</button>
      ${item.cancelled ? '' : `<button type="button" class="button outline" data-action="edit" data-id="${esc(item.id)}">${icon('edit')} Edit action</button>`}
      <button type="button" class="button dark" data-action="close">Done</button>
    </div>`, typeIcon(item.category));
}

function review(item) {
  if (!item?.pending) return;
  const next = item.pending;
  const proposed = next.cancelled ? 'Cancelled' : model.fmtDate(next.due || item.due, true);
  const pane = (kind, heading, date, amount, source) => `<div class="compare-pane ${kind}"><small>${heading}</small><strong>${esc(date)}</strong>
    ${amount !== '' ? `<p>${esc(model.currency(amount))}</p>` : ''}${quotes(source)}${fullSource(source, 'Full notice')}</div>`;
  openDialog(changeLabel(item), [item.title, item.reference].filter(Boolean).join(' · '), `
    <p class="dialog-copy">Compare the saved notice with the proposed change. Your plan updates when you approve it.</p>
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
      ${drafts.map((candidate, index) => {
        const target = model.matchAction(state, candidate);
        return `<fieldset class="draft"><legend>${esc(model.categories[candidate.category].label)}</legend>
          ${formFields(candidate, index)}
          ${candidate.issues.map(issue => `<p class="review-note">${esc(issue)}</p>`).join('')}
          ${target && model.difference(target, candidate) ? `<p class="review-note">Matches “${esc(target.title)}”. A change will be queued for review.</p>` : ''}
          ${quotes(candidate.source)}
          ${candidate.cancelled ? `<label class="check-field"><input type="checkbox" name="cancelled-${index}" checked> This notice cancels the earlier action</label>` : `<label class="check-field"><input type="checkbox" name="separate-${index}"> Treat as a separate action if it matches a saved notice</label>`}
        </fieldset>`;
      }).join('')}
      ${fullSource(drafts[0].source)}
      <p class="dialog-error" role="alert" hidden></p>
      <div class="dialog-actions"><button type="button" class="button outline" data-action="close">Cancel</button><button class="button dark" type="submit">${icon('check')} Save to action plan</button></div>
    </form>`);
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
    <p class="dialog-copy">Calendar exports include titles, dates and amounts for reviewed actions. Opening an export in a calendar can sync those details with that calendar provider.</p>
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
    case 'tab': boardTab = tab || stat; render(); break;
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
  for (const [index, candidate] of importDraft.entries()) {
    const draft = { ...candidate, ...fieldValues(data, index), demo: demoDraft, keepSeparate: data.has('separate-' + index),
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
  }
  if (next.length > 55) { showFormError('This plan has 55 actions. Remove some old actions and try again.'); return; }
  boardTab = updates ? 'updates' : 'open';
  if (save(next)) {
    dialog.close();
    $('#notice-text').value = '';
    notify(added + updates ? [added ? `${added} added` : '', updates ? `${updates} change${updates === 1 ? '' : 's'} to review` : ''].filter(Boolean).join(' · ') + '.' : 'This notice is already in your plan.');
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
document.querySelectorAll('i[data-icon]').forEach(el => el.innerHTML = svg(el.dataset.icon));
if (standalone) {
  $('#drop-zone small').textContent = 'TXT · Use the hosted app for images and PDFs';
  $('#file-picker').accept = 'text/plain,.txt';
  setMode('text');
}
render();
