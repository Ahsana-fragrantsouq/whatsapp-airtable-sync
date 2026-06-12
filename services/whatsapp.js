const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { summarizeWithClaude } = require('./claude');
const { saveToAirtable } = require('./airtable');

let currentQR = null;
let clientStatus = 'initializing';
const conversations = {};
const lidToPhone = {}; // maps LID-style id (e.g. from msg.to on outgoing) -> real phone number
const INACTIVITY_MINUTES = parseInt(process.env.INACTIVITY_MINUTES || '30');

// Returns current time as a readable IST string (e.g. "12/06/2026, 7:22:42 pm")
function nowIST() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    protocolTimeout: 180000, // 3 minutes — Render can be slow to launch Chrome
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
    ],
  },
});

client.on('qr', async (qr) => {
  clientStatus = 'waiting_for_scan';
  console.log('📱 QR code ready — visit /qr to scan');
  try {
    currentQR = await qrcode.toDataURL(qr);
  } catch (err) {
    console.error('QR generation error:', err);
  }
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

client.on('disconnected', (reason) => {
  clientStatus = 'disconnected';
  console.log('⚠️  WhatsApp disconnected:', reason);
});

client.on('message', async (msg) => {
  if (msg.from === 'status@broadcast') return;
  if (msg.isStatus) return;

  const body = msg.body?.trim();
  if (!body) return;

  // Try to resolve the REAL phone number (msg.from may be a LID, not the real number)
  let phone = msg.from.replace(/\D/g, '');
  let contactName = null;
  try {
    const contact = await msg.getContact();
    if (contact.id?.user) {
      const realPhone = contact.id.user.replace(/\D/g, '');
      // Remember: this LID (msg.from) maps to this real phone number
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

client.on('message_create', async (msg) => {
  if (!msg.fromMe) return;
  if (msg.to === 'status@broadcast') return;

  // msg.to may be a LID (e.g. "47858921246783@lid") — translate to real phone if known
  const rawTo = msg.to.replace(/\D/g, '');
  const phone = lidToPhone[rawTo] || rawTo;

  const body = msg.body?.trim();
  if (!body || !conversations[phone]) {
    console.log(`🔍 DEBUG outgoing msg ignored — rawTo: ${rawTo}, mapped phone: ${phone}, has convo: ${!!conversations[phone]}, body: "${body}"`);
    return;
  }

  console.log(`🟢 AGENT REPLY captured for ${phone}: "${body}"`);

  conversations[phone].messages.push({ role: 'agent', text: body, time: nowIST() });
  conversations[phone].lastActivity = new Date();
  resetTimer(phone);
});

function resetTimer(phone) {
  const convo = conversations[phone];
  if (convo.timer) clearTimeout(convo.timer);
  convo.timer = setTimeout(async () => {
    console.log(`⏰ Inactivity timeout for ${phone} — saving to Airtable...`);
    await triggerSummarize(phone);
  }, INACTIVITY_MINUTES * 60 * 1000);
}

async function triggerSummarize(phone) {
  const convo = conversations[phone];
  if (!convo) throw new Error(`No conversation found for ${phone}`);
  if (convo.messages.length === 0) throw new Error(`No messages for ${phone}`);
  if (convo.saved) {
    console.log(`ℹ️  ${phone} already saved, skipping.`);
    return;
  }

  const transcript = convo.messages
    .map((m) => `[${m.time}] ${m.role === 'agent' ? '🟢 Agent' : '👤 Customer'}: ${m.text}`)
    .join('\n');

  console.log(`\n📋 FULL TRANSCRIPT FOR ${phone}:`);
  console.log(`─────────────────────────────────`);
  console.log(transcript);
  console.log(`─────────────────────────────────\n`);

  // Try Claude — if it fails, still save to Airtable with basic info
  let extracted = { summary: 'Summary unavailable', interest: '', leadStatus: 'warm', name: null, email: null };
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
      summary: extracted.summary,
      fullConversation: transcript,
      leadStatus: extracted.leadStatus,
      interest: extracted.interest,
    });
    convo.saved = true;
    if (convo.timer) clearTimeout(convo.timer);
    console.log(`✅ Saved lead for ${phone} to Airtable`);
  } catch (airtableErr) {
    console.error(`❌ Airtable save failed for ${phone}:`, airtableErr.message);
  }
}

function startClient() {
  client.initialize().catch((err) => {
    console.error('❌ WhatsApp initialize failed:', err.message);
    clientStatus = 'init_failed';
    console.log('🔄 Retrying WhatsApp initialization in 15 seconds...');
    setTimeout(startClient, 15000);
  });
}

// Catch any unhandled errors so the whole server doesn't crash
process.on('unhandledRejection', (err) => {
  console.error('⚠️  Unhandled rejection (server stays alive):', err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️  Uncaught exception (server stays alive):', err?.message || err);
});

startClient();

module.exports = {
  getQR: () => currentQR,
  getStatus: () => clientStatus,
  getConversations: () => conversations,
  triggerSummarize,
};
