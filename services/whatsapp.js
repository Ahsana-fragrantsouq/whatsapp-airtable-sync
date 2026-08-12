const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { summarizeWithClaude } = require('./claude');
const { saveToAirtable } = require('./airtable');
const { backfillAllChats } = require('./backfill');

const SESSION_DIR = '/app/.wwebjs_auth';
const BACKUP_DIR  = '/app/.wwebjs_auth_backup';

// ─── Force-delete ALL Singleton lock files before anything else runs ──────────
try {
  const result = execSync(`find ${SESSION_DIR} -name "Singleton*" 2>/dev/null || true`).toString().trim();
  if (result) {
    execSync(`find ${SESSION_DIR} -name "Singleton*" -delete 2>/dev/null || true`);
    console.log(`🧹 Force-deleted lock files:\n${result}`);
  } else {
    console.log('🧹 No lock files found on boot');
  }
} catch (err) {
  console.log(`⚠️  Lock cleanup error: ${err.message}`);
}

let currentQR = null;
let clientStatus = 'initializing';
let connectedAt = null;
let restartInProgress = false;
let restoredThisBoot = false;
const conversations = {};
const lidToPhone = {};
const INACTIVITY_MINUTES = parseInt(process.env.INACTIVITY_MINUTES || '30');

function nowIST() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

// ─── Removes Chrome lock files left behind by a crashed browser ───────────────
function cleanupLockFiles() {
  try {
    execSync(`find ${SESSION_DIR} -name "Singleton*" -delete 2>/dev/null || true`);
    console.log('🧹 cleanupLockFiles: done');
  } catch (err) {
    console.log(`⚠️  cleanupLockFiles error: ${err.message}`);
  }
}

// ─── Force-kill any lingering Chrome process ──────────────────────────────────
// ─── Force-kill any lingering Chrome process ──────────────────────────────────
function killChromeProcesses() {
  // Prefer Puppeteer's own handle — doesn't depend on a system pkill binary
  try {
    const proc = client?.pupBrowser?.process?.();
    if (proc && !proc.killed) {
      proc.kill('SIGKILL');
      console.log('🔪 Killed Chrome via Puppeteer process handle');
      return;
    }
  } catch (err) {
    console.log(`⚠️  Puppeteer process kill failed: ${err.message}`);
  }
  // Fallback — semicolon (not ||) guarantees this never throws, even if
  // pkill is missing from the image or matches nothing
  try {
    execSync('pkill -9 -f "chrome" 2>/dev/null; true');
    console.log('🔪 killChromeProcesses: done (fallback)');
  } catch (err) {
    console.log(`⚠️  killChromeProcesses fallback error (non-fatal): ${err.message}`);
  }
}

// ─── Clean shutdown with a timeout fallback to force-kill ────────────────────
async function safeDestroy() {
  try {
    await Promise.race([
      client.destroy(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('destroy timeout')), 8000)),
    ]);
    console.log('🛑 Client destroyed cleanly');
  } catch (err) {
    console.log(`⚠️  Clean destroy failed/timed out (${err.message}) — force-killing`);
  }
  killChromeProcesses();
}

// ─── Session backup — protects against corruption during forced restarts ─────
function backupSession() {
  try {
    if (!fs.existsSync(SESSION_DIR)) return;
    const tmp = `${BACKUP_DIR}_tmp`;
    execSync(`rm -rf "${tmp}" && cp -r "${SESSION_DIR}" "${tmp}" && rm -rf "${BACKUP_DIR}" && mv "${tmp}" "${BACKUP_DIR}"`);
    console.log(`💾 Session backed up at ${nowIST()} IST`);
  } catch (err) {
    console.log(`⚠️  Session backup failed: ${err.message}`);
  }
}

function restoreSessionFromBackup() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      console.log('⚠️  No session backup available to restore');
      return false;
    }
    execSync(`rm -rf "${SESSION_DIR}" && cp -r "${BACKUP_DIR}" "${SESSION_DIR}"`);
    console.log('♻️  Session restored from last known-good backup');
    return true;
  } catch (err) {
    console.log(`⚠️  Session restore failed: ${err.message}`);
    return false;
  }
}

// ─── Slack notification ───────────────────────────────────────────────────────
async function notifySlack(message) {
  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel: 'C0B9V9U312L', // #session
        text: message,
      }),
    });
    const data = await response.json();
    if (!data.ok) console.log(`⚠️  Slack notification failed: ${data.error}`);
  } catch (err) {
    console.log(`⚠️  Slack notification error: ${err.message}`);
  }
}

// ─── WhatsApp Client ──────────────────────────────────────────────────────────
function createClient() {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1023027200-alpha.html',
    },
    puppeteer: {

      headless: 'new',
      protocolTimeout: 180000,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-default-apps',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-sync',
        '--force-color-profile=srgb',
        '--metrics-recording-only',
        '--mute-audio',
        '--password-store=basic',
        '--use-mock-keychain',
        // NOTE: --single-process removed — it was the likely cause of the
        // detached-frame/protocol-error crashes during backfill and restarts.
        // Standard Render plan should have enough RAM to run normally.
        '--js-flags=--max-old-space-size=256',
        '--disable-shared-workers',
        '--disable-translate',
        '--safebrowsing-disable-auto-update',
        '--disable-logging',
        '--log-level=3',
      ],
    },
  });
}

let client = null;

// ─── Safe restart (session preserved on disk, no QR scan needed) ─────────────
async function restartClient(reason, notify = true) {
  if (restartInProgress) {
    console.log(`⏭️  Restart already in progress — skipping duplicate trigger (${reason})`);
    return;
  }
  restartInProgress = true;

  console.log(`🔄 Restarting WhatsApp client (${reason}) — session preserved, no QR needed`);
  if (notify) {
    await notifySlack(`🔄 *WhatsApp Auto-Restarting*\nReason: ${reason}\nTime: ${nowIST()} IST\nSession preserved — no QR rescan needed.`);
  }

  clientStatus = 'disconnected';
  connectedAt = null;
  await safeDestroy();
  cleanupLockFiles();

  setTimeout(() => {
    restartInProgress = false;
    startClient();
  }, 10000);
}

// ─── Attach all event listeners ───────────────────────────────────────────────
function attachEvents() {
  client.on('qr', async (qr) => {
    clientStatus = 'waiting_for_scan';
    console.log('📱 QR code ready — visit /qr to scan');
    try { currentQR = await qrcode.toDataURL(qr); } catch (err) { console.error('QR error:', err); }
  });

  client.on('ready', () => {
    clientStatus = 'connected';
    connectedAt = Date.now();
    currentQR = null;
    restoredThisBoot = false; // successful connect — future auth failures may try a fresh restore
    console.log('✅ WhatsApp connected!');

    // Back up the working session shortly after connecting, then periodically
    setTimeout(backupSession, 2 * 60 * 1000);
  });

  client.on('authenticated', () => {
    clientStatus = 'authenticated';
    console.log('🔐 WhatsApp authenticated');

    // If stuck in authenticated for more than 2 minutes, force restart
    setTimeout(async () => {
      if (clientStatus === 'authenticated') {
        console.log('⚠️  Stuck in authenticated state — forcing restart...');
        await restartClient('stuck in authenticated state');
      }
    }, 2 * 60 * 1000);
  });

  client.on('auth_failure', async (msg) => {
    clientStatus = 'auth_failed';
    console.error('❌ Auth failed:', msg);

    // One automatic recovery attempt from the last known-good backup before
    // we give up and ask for a fresh QR scan.
    if (!restoredThisBoot) {
      restoredThisBoot = true;
      const restored = restoreSessionFromBackup();
      if (restored) {
        console.log('🔁 Attempting reconnect using restored session backup...');
        await safeDestroy();
        cleanupLockFiles();
        setTimeout(startClient, 10000);
        return;
      }
    }

    await notifySlack(`❌ *WhatsApp Auth Failed* — QR rescan required!\nTime: ${nowIST()} IST\nVisit https://whatsapp-airtable-sync.onrender.com/qr to rescan.`);
  });

  // ── Auto-reconnect on disconnect ──────────────────────────────────────────
  client.on('disconnected', async (reason) => {
    console.log(`⚠️  WhatsApp disconnected: ${reason}`);
    await restartClient(`disconnected: ${reason}`);
  });

  // ── Incoming messages ─────────────────────────────────────────────────────
  client.on('message', async (msg) => {
    if (msg.from === 'status@broadcast') return;
    if (msg.isStatus) return;

    const body = msg.body?.trim();
    if (!body) return;

    let phone = msg.from.replace(/\D/g, '');
    let contactName = null;
    try {
      const contact = await msg.getContact();
      if (contact.id?.user) {
        const realPhone = contact.id.user.replace(/\D/g, '');
        if (phone !== realPhone) lidToPhone[phone] = realPhone;
        phone = realPhone;
      }
      contactName = contact.pushname || contact.name || null;
    } catch (_) {}

    if (!conversations[phone]) {
      conversations[phone] = {
        contact: { phone, name: contactName, email: null },
        messages: [],
        lastActivity: null,
        timer: null,
        saved: false,
      };
    }
    if (contactName && !conversations[phone].contact.name) {
      conversations[phone].contact.name = contactName;
    }

    const convo = conversations[phone];
    convo.messages.push({ role: 'customer', text: body, time: nowIST() });
    convo.lastActivity = new Date();
    convo.saved = false;

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`💬 NEW MESSAGE`);
    console.log(`📱 From  : ${phone}`);
    console.log(`👤 Name  : ${convo.contact.name || 'Unknown'}`);
    console.log(`💬 Text  : ${body}`);
    console.log(`🕐 Time  : ${nowIST()} IST`);
    console.log(`📝 Total messages in conversation: ${convo.messages.length}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    resetTimer(phone);
  });

  // ── Outgoing messages (agent replies) ────────────────────────────────────
  client.on('message_create', async (msg) => {
    if (!msg.fromMe) return;
    if (msg.to === 'status@broadcast') return;

    const rawTo = msg.to.replace(/\D/g, '');
    const phone = lidToPhone[rawTo] || rawTo;
    const body = msg.body?.trim();

    if (!body || !conversations[phone]) {
      console.log(`🔍 DEBUG outgoing ignored — rawTo: ${rawTo}, mapped: ${phone}, hasConvo: ${!!conversations[phone]}`);
      return;
    }

    console.log(`🟢 AGENT REPLY captured for ${phone}: "${body}"`);
    conversations[phone].messages.push({ role: 'agent', text: body, time: nowIST() });
    conversations[phone].lastActivity = new Date();
    resetTimer(phone);
  });
}

// ─── Timer ────────────────────────────────────────────────────────────────────
function resetTimer(phone) {
  const convo = conversations[phone];
  if (convo.timer) clearTimeout(convo.timer);
  convo.timer = setTimeout(async () => {
    console.log(`⏰ Inactivity timeout for ${phone} — saving to Airtable...`);
    await triggerSummarize(phone);
  }, INACTIVITY_MINUTES * 60 * 1000);
}

// ─── Summarize & Save ─────────────────────────────────────────────────────────
async function triggerSummarize(phone) {
  const convo = conversations[phone];
  if (!convo) throw new Error(`No conversation found for ${phone}`);
  if (convo.messages.length === 0) throw new Error(`No messages for ${phone}`);
  if (convo.saved) { console.log(`ℹ️  ${phone} already saved`); return; }

  convo.saved = true;
  if (convo.timer) clearTimeout(convo.timer);

  const transcript = convo.messages
    .map((m) => `[${m.time}] ${m.role === 'agent' ? '🟢 Agent' : '👤 Customer'}: ${m.text}`)
    .join('\n');

  console.log(`\n📋 FULL TRANSCRIPT FOR ${phone}:\n─────────────────────────────────`);
  console.log(transcript);
  console.log(`─────────────────────────────────\n`);

  let extracted = { sessionSummary: 'Summary unavailable', interest: '', leadStatus: 'warm', name: null, email: null };
  try {
    extracted = await summarizeWithClaude(transcript, convo.contact);
    console.log(`🤖 Claude extracted:`, JSON.stringify(extracted, null, 2));
  } catch (claudeErr) {
    console.log(`⚠️  Claude failed: ${claudeErr.message} — saving without summary`);
  }

  if (extracted.name) convo.contact.name = extracted.name;
  if (extracted.email) convo.contact.email = extracted.email;

  try {
    await saveToAirtable({
      name: convo.contact.name || 'Unknown',
      phone,
      email: convo.contact.email || '',
      sessionSummary: extracted.sessionSummary || 'Summary unavailable',
      fullConversation: transcript,
      leadStatus: extracted.leadStatus,
      interest: extracted.interest,
    });
    console.log(`✅ Saved lead for ${phone} to Airtable`);
  } catch (airtableErr) {
    convo.saved = false;
    console.error(`❌ Airtable save failed for ${phone}:`, airtableErr.message);
  }
}

// ─── Start / Restart Client ───────────────────────────────────────────────────
function startClient() {
  // If the primary session dir is missing/empty but a backup exists, restore first
  try {
    const hasSession = fs.existsSync(SESSION_DIR) && fs.readdirSync(SESSION_DIR).length > 0;
    if (!hasSession && fs.existsSync(BACKUP_DIR)) {
      console.log('♻️  No session found on boot — restoring from backup before connecting');
      restoreSessionFromBackup();
    }
  } catch (err) {
    console.log(`⚠️  Session pre-check error: ${err.message}`);
  }

  client = createClient();
  attachEvents();
  client.initialize().catch(async (err) => {
    console.error('❌ WhatsApp initialize failed:', err?.message || err?.name || 'unknown error');
    clientStatus = 'init_failed';
    await safeDestroy();
    cleanupLockFiles();
    console.log('🔄 Retrying in 15 seconds...');
    setTimeout(startClient, 15000);
  });
}

// ─── Global error safety net ──────────────────────────────────────────────────
process.on('unhandledRejection', (err) => {
  console.error('⚠️  Unhandled rejection:', err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️  Uncaught exception:', err?.message || err);
});

// ─── Health check — verify Chrome page is alive every 30 min ─────────────────
let lastMessageReceivedAt = Date.now();
let healthCheckFailCount = 0;

setInterval(async () => {
  if (clientStatus !== 'connected') {
    healthCheckFailCount = 0;
    return;
  }
  try {
    await client.pupPage.evaluate(() => true);
    healthCheckFailCount = 0; // page alive
  } catch (err) {
    healthCheckFailCount++;
    const mins = Math.round((Date.now() - lastMessageReceivedAt) / 1000 / 60);
    console.log(`⚠️  Health check failed (${healthCheckFailCount}/2) — page unresponsive (last message ${mins}min ago): ${err.message}`);
    if (healthCheckFailCount >= 2) {
      healthCheckFailCount = 0;
      await restartClient('health check: page unresponsive');
    } else {
      console.log('⏳ Waiting for next check before taking action...');
    }
  }
}, 30 * 60 * 1000);

// ─── Periodic session backup while connected (every 6 hours) ─────────────────
setInterval(() => {
  if (clientStatus === 'connected') backupSession();
}, 6 * 60 * 60 * 1000);

// ─── Memory monitor (every 5 min) ────────────────────────────────────────────
setInterval(() => {
  const mem = process.memoryUsage();
  console.log(`📊 Memory: RSS=${Math.round(mem.rss/1024/1024)}MB Heap=${Math.round(mem.heapUsed/1024/1024)}MB Status=${clientStatus}`);
}, 5 * 60 * 1000);

// ─── Boot ─────────────────────────────────────────────────────────────────────
startClient();

module.exports = {
  getQR: () => currentQR,
  getStatus: () => clientStatus,
  getConnectedAt: () => connectedAt,
  getConversations: () => conversations,
  triggerSummarize,
  runBackfill: (beforeDate, afterDate) =>
    backfillAllChats(client, beforeDate, afterDate, () =>
      restartClient('backfill: page unresponsive (detached frame)', false) // no Slack noise for this one
    ),
};