(function (root) {
  'use strict';

  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const monthNames = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec';
  const datePattern = new RegExp(
    `\\b(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}|\\d{1,2}(?:st|nd|rd|th)?[ \\-]+(?:${monthNames})(?:[ ,\\-]+\\d{4})?|(?:${monthNames})[ \\-]+\\d{1,2}(?:st|nd|rd|th)?(?:[ ,\\-]+\\d{4})?)\\b`, 'gi',
  );
  const deadline = /\b(?:due date|payment deadline|deadline|last date|(?:amount|payment|bill) due|due (?:on|by)|submit by|pay by|return by|no later than|before|by|scheduled for|appointment on)\b/i;
  const revision = /\b(?:revised|correction|extended|rescheduled|postponed|moved|updated|new deadline)\b/i;
  const cancel = /\b(?:cancelled|canceled|withdrawn)\b/i;
  const relative = /\b(?:today|tomorrow|next (?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:mon|tues|wednes|thurs|fri|satur|sun)day|within \d+ (?:days?|hours?))\b/i;
  const categories = {
    payment: { label: 'Payment', icon: 'wallet' },
    document: { label: 'Document', icon: 'file' },
    appointment: { label: 'Appointment', icon: 'calendar' },
    return: { label: 'Return', icon: 'return' },
    renewal: { label: 'Renewal', icon: 'repeat' },
    general: { label: 'To-do', icon: 'list' },
  };

  function dayKey(value = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(value);
    const pick = type => parts.find(part => part.type === type).value;
    return `${pick('year')}-${pick('month')}-${pick('day')}`;
  }

  function dateKey(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || year < 2000 || year > 2199) return '';
    return date.toISOString().slice(0, 10);
  }

  function readDate(raw) {
    const text = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return dateKey(...text.split('-').map(Number));
    const numeric = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
    if (numeric) return dateKey(Number(numeric[3].length === 2 ? '20' + numeric[3] : numeric[3]), Number(numeric[2]), Number(numeric[1]));
    const words = text.toLowerCase().match(/[a-z]+|\d+/g) || [];
    const year = words.find(word => /^\d{4}$/.test(word));
    const month = words.find(word => months.includes(word.slice(0, 3)));
    const day = words.find(word => /^\d{1,2}$/.test(word));
    return year && month && day ? dateKey(+year, months.indexOf(month.slice(0, 3)) + 1, +day) : '';
  }

  const dateAt = (today, offset) => new Date(Date.parse(today) + offset * 86400000).toISOString().slice(0, 10);
  const daysUntil = (date, today = dayKey()) => Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
  const fmtDate = (date, withYear = false) => date ? new Intl.DateTimeFormat('en-IN', {
    month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
  }).format(new Date(date + 'T00:00:00Z')) : 'No date';
  const currency = amount => amount === '' ? '' : new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(Number(amount));
  const clean = value => value.replace(/\s+/g, ' ').trim();
  const normalize = value => value.toLowerCase().replace(/[^a-z\d]/g, '');
  const dateMatches = line => [...line.matchAll(datePattern)];
  const dateSignal = line => deadline.test(line) || revision.test(line) || /\bappointment\b.*\bon\b/i.test(line);

  function findDeadline(lines) {
    const eligible = lines.filter(line => dateSignal(line) && !/^(?:grace period|late fee|after due date|bill date|issued on)\b/i.test(line));
    for (const line of eligible) {
      const moved = line.match(/\bfrom\s+(.+?)\s+to\s+(.+)/i);
      if (moved && revision.test(line)) {
        const next = dateMatches(moved[2])[0];
        if (next) return { date: readDate(next[0]), quote: line, issue: readDate(next[0]) ? '' : 'Check the new date and year.' };
        if (relative.test(moved[2])) return { date: '', quote: line, issue: 'This is a relative date. Enter the original message timestamp.' };
      }
    }
    const choices = eligible.map(line => {
      const marker = line.match(deadline);
      if (!marker && !revision.test(line) && !/\bappointment\b/i.test(line)) return null;
      const first = marker ? marker.index + marker[0].length : 0;
      const tail = line.slice(first);
      const match = dateMatches(tail)[0];
      if (!match && !relative.test(tail)) return null;
      return {
        date: match ? readDate(match[0]) : '',
        quote: line,
        issue: match ? 'Check the date and year.' : 'This is a relative date. Enter the date from the original message.',
      };
    }).filter(Boolean).sort((a, b) => {
      const score = item => /\b(?:new deadline|revised|due date|last date)\b/i.test(item.quote) ? 1 : 0;
      return score(b) - score(a);
    });
    if (!choices.length) return { date: '', quote: '', issue: 'No explicit deadline found.' };
    const first = choices[0];
    if (new Set(choices.map(choice => choice.date).filter(Boolean)).size > 1) {
      return { date: '', quote: choices.map(choice => choice.quote).join('\n'), issue: 'Several possible deadlines were found. Choose the applicable date.' };
    }
    return { ...first, issue: first.date ? '' : first.issue };
  }

  function findAmount(lines) {
    const amountPattern = /(?:₹|\bINR\s*|\bRs\.?\s*)(\s*\d[\d,]*(?:\.\d{1,2})?)/gi;
    const possible = lines.filter(line => !/^(?:late fee|after due date|penalty|grace period)\b/i.test(line));
    const ranked = possible.map(line => ({
      line,
      matches: [...line.matchAll(amountPattern)],
      score: /\b(?:amount due|total payable|payable|please pay)\b/i.test(line) ? 2 : /\bpay\b/i.test(line) ? 1 : 0,
    })).filter(row => row.matches.length).sort((a, b) => b.score - a.score);
    if (!ranked.length) return { amount: '', quote: '', issue: '' };
    const highest = ranked.filter(row => row.score === ranked[0].score);
    const amounts = new Set(highest.flatMap(row => row.matches.map(match => String(Number(match[1].trim().replaceAll(',', ''))))));
    const quote = highest.map(row => row.line).join('\n');
    if (amounts.size > 1) return { amount: '', quote, issue: 'Several amounts were found. Check the amount due.' };
    return { amount: [...amounts][0], quote, issue: '' };
  }

  function getAction(line) {
    const specs = [
      ['payment', /\b(?:please\s+)?(pay)\s+(.+)/i, 'Pay'],
      ['document', /\b(submit|upload|provide|complete|fill(?: in| out)?|sign)\s+(.+)/i, ''],
      ['return', /\b(return)\s+(.+)/i, 'Return'],
      ['renewal', /\b(renew)\s+(.+)/i, 'Renew'],
      ['appointment', /\b(attend|book|confirm)\s+(.+?\b(?:appointment|meeting|interview|consultation|visit)\b.*)/i, ''],
    ];
    for (const [category, pattern, verb] of specs) {
      const match = line.match(pattern);
      if (!match || /\b(?:no need to|do not|don't|already|cancelled|canceled)\b/i.test(line)) continue;
      const object = clean(match[2].replace(/\s+(?:of\s+)?(?:₹|Rs\.?\s*|INR\s*)\d[\d,.]*/gi, '').split(/\s+(?:by|before|on|using|via|through|at)\s+|[,;]|\s+no later than\b/i)[0])
        .replace(/^the\s+/i, '').replace(/[.!?]+$/, '');
      const hasName = /[a-z]{3}/i.test(object.replace(/^\s*(?:rs|inr)\b/i, '')) && !/^(?:₹|rs\.?\s*\d|inr\s*\d)/i.test(object);
      const actionVerb = verb || match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
      return { category, title: hasName ? actionVerb + ' ' + object.slice(0, 80) : '', quote: line };
    }
    return null;
  }

  function noticeLines(text) {
    const lines = text.split(/\r?\n|[;|]|(?<=[.!?])\s+(?=[A-Z]|\d+\))/).map(clean).filter(Boolean);
    const joined = [];
    for (const line of lines) {
      const previous = joined.at(-1) || '';
      const continuesDate = dateSignal(previous) &&
        !dateMatches(previous).some(match => readDate(match[0])) &&
        !dateSignal(line) &&
        dateMatches(previous + ' ' + line).some(match => match.index < previous.length && match.index + match[0].length > previous.length && readDate(match[0]));
      if (continuesDate) joined[joined.length - 1] = previous + ' ' + line;
      else joined.push(line);
    }
    return joined;
  }

  function parse(source, sourceName = 'Pasted notice', metadata = {}) {
    const original = source.trim().slice(0, 30000);
    if (!original) return [];
    const lines = noticeLines(original);
    const refPattern = /\b(?:(?:ref(?:erence)?|bill|notice|booking|token|invoice|order)(?:\s+(?:no\.?|number|id))?)\s*[:#-]?\s*([A-Z]{1,8}[- ]?\d[\dA-Z-]{1,24}|\d{3,20})\b/i;
    const reference = (original.match(refPattern)?.[1] || '').toUpperCase().replaceAll(' ', '-');
    const header = lines.find(line => /^from\s*:/i.test(line)) || lines[0];
    const first = (header || '').replace(/^from\s*:\s*|^(?:correction|update|urgent)\s*[:–—-]\s*/i, '').split(refPattern)[0].trim().replace(/[\s:–—-]+$/, '');
    const issuer = metadata.sender || (first && first.length < 64 && !getAction(first) && !dateSignal(first) && !/^\d/.test(first) ? first : '');
    const cancelled = lines.some(line => cancel.test(line));
    const parts = lines.flatMap((line, index) => {
      const action = getAction(line);
      return action ? [{ ...action, index }] : [];
    });
    const uniqueParts = parts.filter((part, index) => !parts.slice(0, index).some(earlier => earlier.category === part.category && earlier.title === part.title));
    const rows = cancelled ? [] : uniqueParts;
    const defaultCategory = /\b(?:bill|payable|payment|amount due)\b/i.test(original) ? 'payment' :
      /\b(?:appointment|interview|consultation)\b/i.test(original) ? 'appointment' : 'general';
    const candidates = rows.length ? rows.slice(0, 8) : [{ category: defaultCategory, title: '', quote: '' }];
    return candidates.map((part, index) => {
      const context = rows.length > 1 ? lines.slice(part.index, rows[index + 1]?.index) : lines;
      const timing = cancelled ? { date: '', quote: lines.find(line => cancel.test(line)), issue: 'Confirm that this notice cancels the earlier action.' } : findDeadline(context);
      const money = !cancelled ? findAmount(context) : { amount: '', quote: '', issue: '' };
      const title = part.title || (part.category === 'payment' && issuer ? 'Pay ' + issuer + ' bill' :
        part.category === 'appointment' ? 'Attend appointment' : 'Review this notice');
      return {
        title, issuer, reference, category: part.category, revision: revision.test(original), due: timing.date, amount: money.amount, cancelled: cancelled && candidates.length === 1,
        issues: [timing.issue, money.issue, rows.length > 8 ? 'More actions were found. Review the full notice for anything missing.' : ''].filter(Boolean),
        source: { name: sourceName, text: original, sentAt: metadata.sentAt || '', receivedAt: new Date().toISOString(), quotes: [...new Set([part.quote, timing.quote, money.quote].filter(Boolean))] },
      };
    });
  }


  function relativeDate(text, sentAt) {
    if (!sentAt || !/^\d{4}-\d{2}-\d{2}$/.test(sentAt.slice(0, 10))) return null;
    const base = sentAt.slice(0, 10);
    const moved = text.match(/\bfrom\s+.+?\s+to\s+(.+)/i);
    const found = (moved ? moved[1] : text).match(/\b(tomorrow|today|(?:(?:next|this)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i);
    if (!found) return null;
    const word = found[0].toLowerCase();
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const weekday = weekdays.indexOf(word.split(' ').at(-1));
    let offset = word === 'tomorrow' ? 1 : 0;
    if (weekday >= 0) {
      offset = (weekday - new Date(base + 'T12:00:00Z').getUTCDay() + 7) % 7;
      if (word.startsWith('next ') && offset === 0) offset = 7;
    }
    return { due: dateAt(base, offset), explanation: '“' + found[0] + '” interpreted from the message date ' + fmtDate(base, true) + '. Check this interpretation.' };
  }

  function dateEvidence(candidate) {
    if (candidate.due || !candidate.source.sentAt) return candidate;
    const relative = relativeDate(candidate.source.quotes.join(' ') || candidate.source.text, candidate.source.sentAt);
    if (relative) return { ...candidate, due: relative.due, interpretation: relative.explanation,
      issues: candidate.issues.filter(issue => !/relative date|No explicit deadline/.test(issue)) };
    return candidate;
  }

  const ignoredWords = new Set(('the a an to for by on at of your please pay submit upload complete return renew bill notice message guys extended deadline date revised correction updated original from due payment amount until this next new still unchanged moved morning afternoon evening it is has been in and all everyone students kindly now').split(' '));
  function topics(text) {
    return new Set((text.toLowerCase().match(/[a-z]{3,}/g) || []).filter(word => !ignoredWords.has(word)));
  }

  function matchCandidates(items, candidate) {
    const incoming = topics(candidate.title + ' ' + candidate.source.text);
    return items.filter(item => !item.done).map(item => {
      const evidence = [];
      let score = 0;
      const sameSender = candidate.issuer && normalize(candidate.issuer) === normalize(item.issuer);
      const conflictingSender = candidate.issuer && item.issuer && !sameSender;
      const sameReference = candidate.reference && candidate.reference === item.reference;
      if (sameSender) { score += 4; evidence.push('Same sender or group'); }
      if (sameReference) { score += 7; evidence.push('Same notice reference ' + candidate.reference); }
      if (conflictingSender) score -= 8;
      if (candidate.reference && item.reference && !sameReference) score -= 8;
      const existing = topics(item.title + ' ' + item.source.text);
      const overlap = [...incoming].filter(word => existing.has(word));
      if (overlap.length) {
        score += Math.min(4, overlap.length * 1.5);
        evidence.push('Shared topic: ' + overlap.slice(0, 3).join(', '));
      }
      if (candidate.amount !== '' && item.amount === candidate.amount) {
        score += 3;
        evidence.push('Same amount ' + currency(item.amount));
      }
      if (item.due && dateMatches(candidate.source.text).some(match => readDate(match[0]) === item.due)) {
        score += 2;
        evidence.push('Mentions the saved deadline');
      }
      const sentAt = candidate.source.sentAt;
      const existingAt = item.source.sentAt;
      const older = Boolean(sentAt && existingAt && sentAt < existingAt);
      if (sentAt && existingAt) evidence.push(older ? 'Message predates the saved notice' : 'Message dated after the saved notice');
      const exact = Boolean(sameReference && sameSender);
      return { id: item.id, title: item.title, score, evidence, older, exact };
    }).filter(match => match.score >= 4 && match.evidence.length).sort((a,b) => b.score - a.score);
  }

  function matchAction(items, candidate) {
    if (candidate.targetId) return items.find(item => item.id === candidate.targetId && !item.done) || null;
    const matches = matchCandidates(items, candidate).filter(match => match.exact);
    if (matches.length === 1) return items.find(item => item.id === matches[0].id);
    return null;
  }

  function difference(current, candidate) {
    return Boolean(candidate.cancelled || (candidate.due && current.due !== candidate.due) ||
      (candidate.amount !== '' && current.amount !== candidate.amount));
  }

  function sourceKey(source) {
    return normalize(source.text || '');
  }

  function merge(items, candidate, id) {
    candidate = dateEvidence(candidate);
    const target = candidate.keepSeparate ? null : matchAction(items, candidate);
    if (!target) {
      return { items: [...items, { ...candidate, id, done: false, pending: null, history: [] }], change: 'added' };
    }
    const knownSources = [target.source, ...target.history.map(entry => entry.source)];
    if (knownSources.some(source => sourceKey(source) === sourceKey(candidate.source))) return { items, change: 'unchanged' };
    const obsolete = Boolean(candidate.source.sentAt && target.source.sentAt && candidate.source.sentAt < target.source.sentAt);
    if (obsolete) {
      const entry = { due: candidate.due, amount: candidate.amount, source: candidate.source, archived: true };
      return { items: items.map(item => item.id === target.id ? { ...item, history: [entry, ...item.history].slice(0, 25) } : item), change: 'archived' };
    }
    if (!difference(target, candidate)) return { items, change: 'unchanged' };
    if (target.pending && target.pending.source.sentAt && candidate.source.sentAt && candidate.source.sentAt < target.pending.source.sentAt) {
      return { items: items.map(item => item.id === target.id ? { ...item, history: [{ due: candidate.due, amount: candidate.amount, source: candidate.source, archived: true }, ...item.history].slice(0, 25) } : item), change: 'archived' };
    }
    const evidence = matchCandidates(items, candidate).find(match => match.id === target.id)?.evidence || ['Linked by you'];
    return { items: items.map(item => item.id === target.id ? { ...item, pending: { ...candidate, evidence } } : item), change: 'updated' };
  }

  function resolve(items, id, accept) {
    return items.map(item => {
      if (item.id !== id || !item.pending) return item;
      if (!accept) return { ...item, history: [{ due: item.pending.due, amount: item.pending.amount, source: item.pending.source, rejected: true }, ...item.history].slice(0,25), pending: null };
      const { due, amount, source, cancelled } = item.pending;
      return {
        ...item,
        due: due || item.due,
        amount: amount === '' ? item.amount : amount,
        source,
        done: Boolean(cancelled),
        cancelled: Boolean(cancelled),
        reminder: item.reminder ? { ...item.reminder, date: due || item.due } : undefined,
        history: [{ due: item.due, amount: item.amount, source: item.source }, ...item.history].slice(0, 25),
        pending: null,
      };
    });
  }

  function sample(kind = 'school', today = dayKey()) {
    const day = offset => fmtDate(dateAt(today, offset), true);
    const notices = {
      school: `Aarohan School\nNotice AS-730\nPlease submit the signed consent form by ${day(5)}.\nThe trip takes place on ${day(11)}.`,
      electricity: `Greenline Power\nBill GL-4028\nBill date: ${day(-6)}\nDue date: ${day(3)}\nTotal payable: ₹1,215\nAfter due date: ₹1,305`,
      maintenance: `Maple Residency\nRef MR-1126\nPlease pay society maintenance of ₹2,450 by ${day(6)} using the resident portal.`,
      revision: `Maple Residency\nRef MR-1126\nCorrection: Payment deadline moved from ${day(6)} to ${day(12)}. The amount stays ₹2,450.`,
      library: `City Library\nRef CL-207\nPlease return the borrowed library book by ${day(9)}.`,
      internet: `Orbit Broadband\nBill OB-1955\nPlease pay broadband bill by ${day(-2)}.\nTotal payable: ₹699.`,
    };
    return notices[kind];
  }

  function seed(today = dayKey()) {
    const seeds = [
      ['electricity', 'Electricity bill · PDF', 'Pay electricity bill'],
      ['maintenance', 'Housing group · Message', 'Pay society maintenance'],
      ['library', 'Library notice · Email', 'Return library book'],
      ['internet', 'Broadband bill · Email', 'Pay broadband bill'],
    ];
    const items = seeds.map(([id, sourceName, title]) => {
      const draft = parse(sample(id, today), sourceName)[0];
      return { ...draft, title, id, done: id === 'internet', demo: true, pending: null, history: [] };
    });
    return merge(items, parse(sample('revision', today), 'Housing group · Correction')[0], 'revision').items;
  }

  function makeCalendar(items, now = new Date()) {
    const safe = value => String(value).replaceAll('\\', '\\\\').replace(/\r?\n/g, '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
    function fold(line) {
      const encoder = new TextEncoder();
      const parts = [];
      let chunk = '';
      let bytes = 0;
      for (const character of line) {
        const width = encoder.encode(character).length;
        if (bytes + width > 75) { parts.push(chunk); chunk = ' '; bytes = 1; }
        chunk += character;
        bytes += width;
      }
      parts.push(chunk);
      return parts.join('\r\n');
    }
    const events = items.filter(item => item.due && !item.done && !item.pending).map(item => [
      'BEGIN:VEVENT',
      'UID:' + safe(item.id) + '@daymark.local',
      'DTSTAMP:' + now.toISOString().replace(/[-:]|\.\d{3}/g, ''),
      'DTSTART;VALUE=DATE:' + item.due.replaceAll('-', ''),
      'SUMMARY:' + safe(item.title),
      'DESCRIPTION:' + safe([item.issuer, currency(item.amount)].filter(Boolean).join(' | ')),
      'END:VEVENT',
    ]);
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daymark//Action calendar//EN', 'CALSCALE:GREGORIAN', ...events.flat(), 'END:VCALENDAR', ''].map(fold).join('\r\n');
  }

  const model = { categories, dayKey, dateAt, daysUntil, fmtDate, currency, readDate, parse, seed, sample, matchCandidates, relativeDate, dateEvidence, matchAction, difference, merge, resolve, makeCalendar };
  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  else root.Daymark = model;
})(globalThis);
