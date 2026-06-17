const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { summarizeWithClaude } = require('./claude');
const { saveToAirtable } = require('./airtable');

let currentQR = null;
let clientStatus = 'initializing';
const conversations = {};
const lidToPhone = {};
const INACTIVITY_MINUTES = parseInt(process.env.INACTIVITY_MINUTES || '30');

function nowIST() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

// ─── Removes Chrome lock files left behind by a crashed browser ───────────────
function cleanupLockFiles() {
  const sessionDir = path.join(process.cwd(), '.wwebjs_auth', 'session');
  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
  for (const file of lockFiles) {
    const fullPath = path.join(sessionDir, file);
    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.log(`🧹 Removed stale lock file: ${file}`);
      }
    } catch (err) {
      console.log(`⚠️  Could not remove lock file ${file}: ${err.message}`);
    }
  }
}

// ─── WhatsApp Client ──────────────────────────────────────────────────────────
function createClient() {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
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
        '--js-flags=--max-old-space-size=256',
      ],
    },
  });
}

let client = createClient();

// ─── Attach all event listeners ───────────────────────────────────────────────
function attachEvents() {
  client.on('qr', async (qr) => {
    clientStatus = 'waiting_for_scan';
    console.log('📱 QR code ready — visit /qr to scan');
    try { currentQR = await qrcode.toDataURL(qr); } catch (err) { console.error('QR error:', err); }
  });

  client.on('ready', () => {
    clientStatus = 'connected';
    currentQR = null;
    console.log('✅ WhatsApp connected!');
  });

  client.on('authenticated', () => {
    clientStatus = 'authenticated';
    console.log('🔐 WhatsApp authenticated');
  });

  client.on('auth_failure', (msg) => {
    clientStatus = 'auth_failed';
    console.error('❌ Auth failed:', msg);
  });

  // ── Auto-reconnect on disconnect ──────────────────────────────────────────
  client.on('disconnected', async (reason) => {
    clientStatus = 'disconnected';
    console.log(`⚠️  WhatsApp disconnected: ${reason}`);
    console.log('🔄 Auto-reconnecting in 10 seconds...');
    try { await client.destroy(); } catch (_) {}
    cleanupLockFiles();
    setTimeout(startClient, 10000);
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

  // Mark as saved immediately to prevent duplicate saves
  // (timer + manual /save could both fire before the async save completes)
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
    // If Airtable save fails, allow retry by resetting saved flag
    convo.saved = false;
    console.error(`❌ Airtable save failed for ${phone}:`, airtableErr.message);
  }
}

// ─── Start / Restart Client ───────────────────────────────────────────────────
function startClient() {
  client = createClient();   // always create a fresh client instance
  attachEvents();
  client.initialize().catch(async (err) => {
    console.error('❌ WhatsApp initialize failed:', err?.message || err?.name || 'unknown error');
    clientStatus = 'init_failed';
    try { await client.destroy(); } catch (_) {}
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

// ─── Memory monitor (every 5 min) ────────────────────────────────────────────
setInterval(() => {
  const mem = process.memoryUsage();
  console.log(`📊 Memory: RSS=${Math.round(mem.rss/1024/1024)}MB Heap=${Math.round(mem.heapUsed/1024/1024)}MB Status=${clientStatus}`);
}, 5 * 60 * 1000);

// ─── Boot ─────────────────────────────────────────────────────────────────────
cleanupLockFiles();
startClient();

module.exports = {
  getQR: () => currentQR,
  getStatus: () => clientStatus,
  getConversations: () => conversations,
  triggerSummarize,
};
