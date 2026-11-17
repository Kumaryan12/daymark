'use strict';
const crypto = require('node:crypto');
const webpush = require('web-push');
const { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand, UpdateItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || '').split(','));
const TableName = process.env.TABLE_NAME;
const client = new DynamoDBClient({});
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const second = () => Math.floor(Date.now() / 1000);
const endpoints = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com']);

function validSubscription(subscription) {
  if (!subscription || typeof subscription.endpoint !== 'string' || subscription.endpoint.length > 2000) return false;
  let url;
  try { url = new URL(subscription.endpoint); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
  if (!endpoints.has(url.hostname) && !(url.hostname.endsWith('.push.apple.com') && /^[a-z0-9.-]+$/.test(url.hostname))) return false;
  const { auth, p256dh } = subscription.keys || {};
  return typeof auth === 'string' && typeof p256dh === 'string' &&
    /^[A-Za-z0-9_-]{20,30}$/.test(auth) && /^[A-Za-z0-9_-]{80,100}$/.test(p256dh) &&
    Buffer.from(auth, 'base64url').length === 16 && Buffer.from(p256dh, 'base64url').length === 65 &&
    Buffer.from(p256dh, 'base64url')[0] === 4;
}

function validTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length > 55) return false;
  const ids = new Set();
  return tasks.every(task => {
    if (!task || typeof task.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(task.id) ||
        ids.has(task.id) || typeof task.title !== 'string' || task.title.length < 1 || task.title.length > 100 ||
        !Number.isSafeInteger(task.at) || task.at < Date.now() - 86400000 || task.at > Date.now() + 5 * 366 * 86400000) return false;
    ids.add(task.id);
    return true;
  });
}

function nextDelivery(tasks) {
  return tasks.filter(task => !task.sent).reduce((next, task) => Math.min(next, task.at), 9000000000000);
}
function row(record) {
  return {
    pk: { S: record.id },
    version: { N: String(record.revision) },
    payload: { S: JSON.stringify(record) },
    dueGroup: { S: 'due' },
    nextAt: { N: String(nextDelivery(record.tasks)) },
    expires: { N: String(record.expires) },
    testedAt: { N: String(record.testedAt || 0) },
  };
}
function decode(item) { return item ? { ...JSON.parse(item.payload.S), testedAt: Number(item.testedAt?.N || 0) } : null; }
function publicReply(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function createService(db = client, send = webpush.sendNotification.bind(webpush)) {
  const read = async id => decode((await db.send(new GetItemCommand({ TableName, Key: { pk: { S: id } }, ConsistentRead: true }))).Item);
  async function push(record, message) {
    return send(record.subscription, JSON.stringify(message), {
      vapidDetails: { subject: 'https://main.d1xsxokyfc76bs.amplifyapp.com/', publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY },
      TTL: 60, urgency: 'normal', timeout: 7000,
    });
  }
  async function api(event) {
    const origin = event.headers?.origin;
    if (!allowedOrigins.has(origin)) return publicReply(403, { error: 'This site is not allowed to use the reminder service.' });
    const authorization = event.headers?.authorization || '';
    if (!/^Bearer [a-f0-9]{64}$/.test(authorization)) return publicReply(401, { error: 'A device token is required.' });
    const id = digest(authorization.slice(7));
    const method = event.requestContext?.http?.method;
    const path = event.rawPath;
    if (!['PUT','DELETE','POST'].includes(method)) return publicReply(405, { error: 'Method unavailable.' });
    const existing = await read(id);
    if (path === '/schedule' && method === 'DELETE') {
      await db.send(new DeleteItemCommand({ TableName, Key: { pk: { S: id } } }));
      return publicReply(200, { disabled: true });
    }
    if (path === '/test' && method === 'POST') {
      if (!existing || existing.expires <= second()) return publicReply(404, { error: 'Enable notifications first.' });
      if (existing.testedAt && Date.now() - existing.testedAt < 30000) return publicReply(429, { error: 'Wait 30 seconds before sending another test.' });
      try {
        await db.send(new UpdateItemCommand({
          TableName, Key: { pk: { S: id } },
          UpdateExpression: 'SET testedAt = :now',
          ConditionExpression: '#version = :version AND (attribute_not_exists(testedAt) OR testedAt < :limit)',
          ExpressionAttributeNames: { '#version': 'version' },
          ExpressionAttributeValues: { ':version': { N: String(existing.revision) }, ':now': { N: String(Date.now()) }, ':limit': { N: String(Date.now() - 30000) } },
        }));
        await push(existing, { title: 'Daymark reminders are connected', body: 'This device can receive your scheduled reminders.', tag: 'daymark-test' });
        return publicReply(200, { sent: true });
      } catch (error) {
        if ([404,410].includes(error.statusCode)) return publicReply(409, { error: 'This subscription expired. Disable and enable reminders again.' });
        return publicReply(503, { error: 'The push provider could not accept the test. Try again.' });
      }
    }
    if (path !== '/schedule' || method !== 'PUT' || !event.body || event.body.length > 20000 || event.isBase64Encoded) {
      return publicReply(400, { error: 'Invalid reminder request.' });
    }
    let data;
    try { data = JSON.parse(event.body); } catch { return publicReply(400, { error: 'Invalid reminder request.' }); }
    if (!Number.isSafeInteger(data.revision) || data.revision < 1 || !validSubscription(data.subscription) ||
        !validTasks(data.tasks) || data.origin !== origin) return publicReply(400, { error: 'Check the subscription and reminder times.' });
    if (existing && data.revision <= existing.revision) return publicReply(200, { scheduled: existing.tasks.length, revision: existing.revision });
    const tasks = data.tasks.map(task => {
      const previous = existing?.tasks.find(old => old.id === task.id && old.at === task.at && old.title === task.title);
      return { id: task.id, title: task.title, at: task.at, sent: previous?.sent || false };
    });
    const record = {
      id, revision: data.revision, subscription: { endpoint: data.subscription.endpoint, keys: data.subscription.keys },
      origin, tasks, expires: Math.max(second() + 90 * 86400, ...tasks.map(task => Math.floor(task.at / 1000) + 7 * 86400)), testedAt: existing?.testedAt || 0,
    };
    try {
      await db.send(new PutItemCommand({
        TableName, Item: row(record),
        ConditionExpression: 'attribute_not_exists(pk) OR #version < :version',
        ExpressionAttributeNames: { '#version': 'version' },
        ExpressionAttributeValues: { ':version': { N: String(data.revision) } },
      }));
      return publicReply(200, { scheduled: tasks.length, revision: data.revision });
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return publicReply(409, { error: 'The schedule changed during your update. Try again.' });
      throw error;
    }
  }

  async function dispatch() {
    const now = Date.now();
    let cursor;
    let delivered = 0;
    // Bound each invocation so a growing demo cannot monopolize a Lambda execution.
    for (let page = 0; page < 3; page++) {
      const result = await db.send(new QueryCommand({
        TableName, IndexName: 'DueIndex',
        KeyConditionExpression: 'dueGroup = :group AND nextAt <= :now',
        ExpressionAttributeValues: { ':group': { S: 'due' }, ':now': { N: String(now) } },
        Limit: 20, ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }));
      for (const item of result.Items || []) {
        const current = await read(item.pk.S);
        if (!current || current.expires <= second()) continue;
        if (nextDelivery(current.tasks) > now) continue;
        const leaseId = crypto.randomUUID();
        try {
          await db.send(new UpdateItemCommand({
            TableName, Key: { pk: { S: current.id } },
            UpdateExpression: 'SET leaseId = :lease, leaseUntil = :until',
            ConditionExpression: '#version = :version AND (attribute_not_exists(leaseUntil) OR leaseUntil < :now)',
            ExpressionAttributeNames: { '#version': 'version' },
            ExpressionAttributeValues: { ':lease': { S: leaseId }, ':until': { N: String(now + 90000) }, ':now': { N: String(now) }, ':version': { N: String(current.revision) } },
          }));
        } catch (error) {
          if (error.name === 'ConditionalCheckFailedException') continue;
          throw error;
        }
        const fresh = await read(current.id);
        if (!fresh || fresh.revision !== current.revision) continue;
        let invalidSubscription = false;
        let retry = false;
        for (const task of fresh.tasks.filter(task => !task.sent && task.at <= now)) {
          // Check the base record before each delivery, because the GSI may lag a date change.
          const latest = await read(current.id);
          if (!latest || latest.revision !== fresh.revision) break;
          if (now - task.at > 86400000) { task.sent = true; continue; }
          try {
            await push(fresh, { title: task.title, body: 'Your Daymark action is due. Open the notice and check what to do.', actionId: task.id, tag: 'daymark-' + task.id });
            task.sent = true;
            delivered++;
          } catch (error) {
            if ([404,410].includes(error.statusCode)) { invalidSubscription = true; break; }
            retry = true;
            break;
          }
        }
        try {
          if (invalidSubscription) {
            await db.send(new DeleteItemCommand({
              TableName, Key: { pk: { S: fresh.id } }, ConditionExpression: '#version = :version',
              ExpressionAttributeNames: { '#version': 'version' }, ExpressionAttributeValues: { ':version': { N: String(fresh.revision) } },
            }));
          } else {
            const updated = row(fresh);
            if (retry) updated.nextAt = { N: String(now + 60000) };
            await db.send(new PutItemCommand({
              TableName, Item: updated, ConditionExpression: '#version = :version AND leaseId = :lease',
              ExpressionAttributeNames: { '#version': 'version' },
              ExpressionAttributeValues: { ':version': { N: String(fresh.revision) }, ':lease': { S: leaseId } },
            }));
          }
        } catch (error) {
          if (error.name !== 'ConditionalCheckFailedException') throw error;
        }
      }
      cursor = result.LastEvaluatedKey;
      if (!cursor) break;
    }
    return { delivered };
  }
  return { api, dispatch };
}
const service = createService();
exports.handler = async event => {
  try {
    return event.requestContext ? await service.api(event) : await service.dispatch();
  } catch (error) {
    console.error('Reminder request failed', error.name);
    return publicReply(503, { error: 'The reminder service is temporarily unavailable.' });
  }
};
exports.createService = createService;
exports.validSubscription = validSubscription;
exports.validTasks = validTasks;
