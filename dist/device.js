'use strict';
(function () {
  const app = window.DaymarkApp;
  const config = window.DAYMARK_REMINDERS;
  const tokenKey = 'daymark-reminder-token';
  const revisionKey = 'daymark-reminder-revision';
  let registration;
  let installation;
  let syncQueue = Promise.resolve();
  let synced = false;
  let lastError = '';
  let retryTimer;
  let syncing = false;
  let disabling = false;
  const { esc, icon, openDialog, notify } = app;
  const token = () => localStorage.getItem(tokenKey) || '';
  const enabled = () => Boolean(token());
  const supportsPush = () => !window.DAYMARK_STANDALONE && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const iPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !matchMedia('(display-mode: standalone)').matches;

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installation = event;
  });
  window.addEventListener('appinstalled', () => { installation = null; notify('Daymark added to this device.'); });

  async function ready() {
    if (!registration) registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    return registration;
  }

  function showCapture() {
    openDialog('Add from your phone', 'Bring the notice straight into Daymark.', `
      <div class="capture-options">
        <article><span class="tool-icon">${icon('upload')}</span><div><h3>Share a screenshot or message</h3>
        <p>On Android, install Daymark, then choose it from the Share menu in your other apps. Daymark opens the notice for review.</p>
        ${installation ? '<button class="button dark" data-device="install">Install Daymark</button>' : '<p>Use your browser menu → Add to Home Screen or Install app.</p>'}</div></article>
        <article><span class="tool-icon">${icon('file')}</span><div><h3>Choose a screenshot</h3><p>On iPhone, open Daymark and choose the screenshot or PDF from Photos or Files.</p><button class="button outline" data-device="file">Choose a notice</button></div></article>
        <article><span class="tool-icon">${icon('text')}</span><div><h3>Paste text or an image</h3><p>Copy a message and use Paste text. On desktop, paste a copied screenshot anywhere outside a text field.</p><button class="button outline" data-device="paste">Paste a message</button></div></article>
      </div><div class="dialog-actions"><button class="button outline" data-action="close">Done</button></div>`);
  }

  function reminderStatus() {
    if (!config) return 'Reminders are unavailable in this copy. Open the live AWS app.';
    if (!supportsPush()) return 'This browser does not support push reminders.';
    if (iPhone()) return 'On iPhone, add Daymark to the Home Screen and open it there to enable reminders.';
    if (Notification.permission === 'denied') return 'Notifications are blocked. Change this site’s notification permission in browser settings.';
    if (!enabled()) return 'Enable notifications on this device, then choose which actions need a reminder.';
    if (syncing) return 'Updating this device’s reminder schedule…';
    if (lastError) return lastError + ' Daymark will retry when you are online.';
    return synced ? 'This device’s reminders are up to date.' : 'Checking this device’s reminders…';
  }

  function showReminders(preserveDraft = true) {
    const previousForm = document.querySelector('#reminder-form');
    const draft = preserveDraft && previousForm ? new FormData(previousForm) : null;
    const selected = new Set(draft?.getAll('task') || []);
    const items = app.getState().filter(item => !item.done && item.due);
    const canEnable = config && supportsPush() && !iPhone() && Notification.permission !== 'denied';
    openDialog('Reminders on this device', 'Approved date changes reschedule reminders. Completing an action removes its reminder.', `
      <p class="reminder-status" role="status">${esc(reminderStatus())}</p>
      <p class="dialog-copy">Enabling reminders sends the selected action titles, reminder times and this browser’s push subscription to the AWS reminder service. Notification delivery depends on your browser, network and device settings.</p>
      ${!enabled() && canEnable ? '<button class="button dark" data-device="enable">Enable notifications</button>' : ''}
      <form id="reminder-form">
        ${items.length ? items.map(item => `<div class="reminder-item">
          <label><input type="checkbox" name="task" value="${esc(item.id)}" ${(draft ? selected.has(item.id) : item.reminder) ? 'checked' : ''}><span><strong>${esc(item.title)}</strong><small>${Daymark.fmtDate(item.due, true)}${item.pending ? ' · Current date until you approve the change' : ''}</small></span></label>
          <label class="field">Time on the due date<input type="time" name="time-${esc(item.id)}" value="${esc(draft?.get('time-' + item.id) || item.reminder?.time || '09:00')}" required></label>
        </div>`).join('') : '<p class="dialog-copy">Add an action with a due date to set a reminder.</p>'}
        <p class="dialog-copy">Times use this device’s timezone, ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}. The service checks schedules every minute.</p>
        <div class="dialog-actions">
          ${enabled() ? '<button class="button outline" type="button" data-device="test">Send test notification</button><button class="button danger" type="button" data-device="disable">Disable on this device</button>' : ''}
          <button class="button dark" type="submit" ${!enabled() || !items.length ? 'disabled' : ''}>Save reminders</button>
        </div>
      </form>`);
  }

  async function call(path, body, method = 'PUT') {
    const response = await fetch(config.api + path, {
      method,
      headers: { Authorization: 'Bearer ' + token(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The reminder service could not update.');
    return result;
  }

  function schedule(items) {
    return items.filter(item => !item.done && item.due && item.reminder).map(item => ({
      id: item.id,
      title: item.title,
      at: new Date(item.due + 'T' + item.reminder.time + ':00').getTime(),
    })).filter(item => Number.isFinite(item.at) && item.at >= Date.now() - 86400000);
  }

  function updateStatus() {
    const button = document.querySelector('[data-action="reminders"]');
    if (button) {
      button.classList.toggle('sync-warning', Boolean(lastError));
      button.title = reminderStatus();
    }
    const status = document.querySelector('.reminder-status');
    if (status) status.textContent = reminderStatus();
  }

  function sync() {
    if (disabling || !enabled() || !config || !supportsPush()) return Promise.resolve();
    clearTimeout(retryTimer);
    const next = async () => {
      if (disabling || !enabled()) return;
      syncing = true;
      updateStatus();
      try {
        const reg = await ready();
        const subscription = await reg.pushManager.getSubscription();
        if (!subscription) throw new Error('This browser’s notification subscription is missing. Disable and enable reminders again.');
        const revision = Math.max(Date.now(), Number(localStorage.getItem(revisionKey) || 0) + 1);
        localStorage.setItem(revisionKey, String(revision));
        await call('/schedule', { revision, origin: location.origin, subscription: subscription.toJSON(), tasks: schedule(app.getState()) });
        synced = true;
        lastError = '';
      } catch (error) {
        synced = false;
        if (lastError !== error.message) notify('Reminder update is waiting for a connection. Open Reminders for details.');
        lastError = error.message;
        retryTimer = setTimeout(sync, 20000);
        throw error;
      } finally { syncing = false; updateStatus(); }
    };
    syncQueue = syncQueue.catch(() => {}).then(next);
    return syncQueue;
  }

  async function enable() {
    if (!config || !supportsPush()) return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { showReminders(); return; }
    const reg = await ready();
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      const encoded = config.publicKey.replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')), char => char.charCodeAt(0));
      subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    }
    if (!token()) {
      localStorage.setItem(tokenKey, [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join(''));
    }
    await sync();
    showReminders();
    notify('Notifications enabled. Choose your reminders and save.');
  }

  async function disable() {
    disabling = true;
    try {
      await syncQueue.catch(() => {});
      await call('/schedule', null, 'DELETE');
    } catch (error) { disabling = false; throw error; }
    clearTimeout(retryTimer);
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(revisionKey);
    const reg = await ready();
    const subscription = await reg.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
    app.save(app.getState().map(item => ({ ...item, reminder: undefined })));
    synced = false;
    disabling = false;
    lastError = '';
    showReminders(false);
    notify('Reminders disabled on this device.');
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-device]');
    if (!button) return;
    const action = button.dataset.device;
    const run = async () => {
      button.disabled = true;
      try {
        if (action === 'install' && installation) { await installation.prompt(); await installation.userChoice; installation = null; }
        if (action === 'file') { document.querySelector('#dialog').close(); document.querySelector('#file-picker').click(); }
        if (action === 'paste') { document.querySelector('#dialog').close(); document.querySelector('[data-mode="text"]').click(); document.querySelector('#notice-text').focus(); }
        if (action === 'enable') await enable();
        if (action === 'disable') await disable();
        if (action === 'test') { await call('/test', {}, 'POST'); notify('Test notification sent. Check this device’s notifications.'); }
      } catch (error) { lastError = error.message; updateStatus(); notify(error.message); }
      finally { button.disabled = false; }
    };
    void run();
  });

  document.addEventListener('submit', event => {
    if (event.target.id !== 'reminder-form') return;
    event.preventDefault();
    const data = new FormData(event.target);
    const chosen = new Set(data.getAll('task'));
    if (app.save(app.getState().map(item => ({ ...item, reminder: chosen.has(item.id) ? { time: data.get('time-' + item.id) } : undefined })))) {
      void syncQueue.then(() => {
        if (synced) notify('Reminders saved.');
        else notify('Saved on this device. Reminder updates are waiting for a connection.');
      });
    }
  });

  window.addEventListener('daymark-plan-changed', () => { void sync().catch(() => {}); });
  window.addEventListener('online', () => { void sync().catch(() => {}); });
  window.addEventListener('storage', event => { if (event.key === 'daymark-plan-v1') void sync().catch(() => {}); });

  async function receive() {
    if (window.DAYMARK_STANDALONE || !('serviceWorker' in navigator)) return;
    await ready();
    const url = new URL(location.href);
    const share = url.searchParams.get('share');
    if (share && /^[\w-]{36}$/.test(share)) {
      // Wait for the installed worker to control this page before reading the local inbox.
      if (!navigator.serviceWorker.controller) {
        await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      }
      const response = await fetch('/shared/' + share);
      if (response.ok) {
        const form = await response.formData();
        const file = form.get('file');
        if (file instanceof File) await app.processFile(file);
        else app.beginDraft(String(form.get('text') || ''), String(form.get('name') || 'Shared message'));
      } else notify('That shared notice is no longer available. Share it again.');
      history.replaceState(null, '', '/');
    }
    if (url.searchParams.has('share-error')) notify('Share one notice at a time, up to 15 MB.');
    const id = url.searchParams.get('action');
    if (id) document.querySelector('[data-action="details"][data-id="' + CSS.escape(id) + '"]')?.click();
    void sync().catch(() => {});
  }

  window.DaymarkDevice = { showCapture, showReminders };
  void receive().catch(error => notify(error.message));
})();
