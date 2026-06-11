const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { summarizeWithClaude } = require('./claude');
const { saveToAirtable } = require('./airtable');

// ─── State ─────────────────────────────────────────────────────────────────────
let currentQR = null;
let clientStatus = 'initializing';

// conversations[phone] = { contact, messages, lastActivity, timer, saved }
const conversations = {};

// How many minutes of silence before auto-saving a conversation
const INACTIVITY_MINUTES = parseInt(process.env.INACTIVITY_MINUTES || '30');

// ─── WhatsApp Client Setup ─────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: {
    headless: true,
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

// ─── QR Code ──────────────────────────────────────────────────────────────────
client.on('qr', async (qr) => {
  clientStatus = 'waiting_for_scan';
  console.log('📱 QR code ready — visit /qr to scan');
  try {
    currentQR = await qrcode.toDataURL(qr);
  } catch (err) {
    console.error('QR generation error:', err);
  }
});

// ─── Ready ────────────────────────────────────────────────────────────────────
client.on('ready', () => {
  clientStatus = 'connected';
  currentQR = null;
  console.log('✅ WhatsApp connected!');
});

// ─── Authentication ────────────────────────────────────────────────────────────
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

// ─── Incoming Messages ────────────────────────────────────────────────────────
client.on('message', async (msg) => {
  // Ignore group messages, status updates, and our own messages
  if (msg.from === 'status@broadcast') return;
  if (msg.isStatus) return;

  const phone = msg.from.replace('@c.us', ''); // e.g. "905551234567"
  const body = msg.body?.trim();

  if (!body) return;

  // Get or create conversation entry
  if (!conversations[phone]) {
    conversations[phone] = {
      contact: { phone, name: null, email: null },
      messages: [],
      lastActivity: null,
      timer: null,
      saved: false,
    };

    // Try to get contact name from WhatsApp
    try {
      const contact = await msg.getContact();
      conversations[phone].contact.name = contact.pushname || contact.name || null;
    } catch (_) {}
  }

  const convo = conversations[phone];

  // Append message
  convo.messages.push({
    role: 'customer',
    text: body,
    time: new Date().toISOString(),
  });
  convo.lastActivity = new Date();
  convo.saved = false;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`💬 NEW MESSAGE`);
  console.log(`📱 From  : ${phone}`);
  console.log(`👤 Name  : ${convo.contact.name || 'Unknown'}`);
  console.log(`💬 Text  : ${body}`);
  console.log(`🕐 Time  : ${new Date().toLocaleString()}`);
  console.log(`📝 Total messages in conversation: ${convo.messages.length}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Reset inactivity timer
  resetTimer(phone);
});

// ─── Outgoing Messages (track what you reply) ─────────────────────────────────
client.on('message_create', async (msg) => {
  if (!msg.fromMe) return;
  if (msg.to === 'status@broadcast') return;

  const phone = msg.to.replace('@c.us', '');
  const body = msg.body?.trim();

  if (!body || !conversations[phone]) return;

  conversations[phone].messages.push({
    role: 'agent',
    text: body,
    time: new Date().toISOString(),
  });
  conversations[phone].lastActivity = new Date();

  resetTimer(phone);
});

// ─── Inactivity Timer ─────────────────────────────────────────────────────────
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
  if (convo.saved) {
    console.log(`ℹ️  ${phone} already saved, skipping.`);
    return;
  }

  try {
    // Build plain text transcript
    const transcript = convo.messages
      .map((m) => `[${m.time}] ${m.role === 'agent' ? '🟢 Agent' : '👤 Customer'}: ${m.text}`)
      .join('\n');

    // Ask Claude to extract lead info + summary
    try {
    let extracted = { summary: 'Summary unavailable', interest: '', leadStatus: 'warm' };
    
    try {
      extracted = await summarizeWithClaude(transcript, convo.contact);
    } catch (claudeErr) {
      console.log(`⚠️  Claude failed (${claudeErr.message}) — saving to Airtable without summary`);
    }
    // Merge extracted contact info
    if (extracted.name) convo.contact.name = extracted.name;
    if (extracted.email) convo.contact.email = extracted.email;

    // Save to Airtable
    await saveToAirtable({
      name: convo.contact.name || 'Unknown',
      phone,
      email: convo.contact.email || '',
      summary: extracted.summary,
      fullConversation: transcript,
      leadStatus: extracted.leadStatus,
      interest: extracted.interest,
    });

    console.log(`\n📋 FULL TRANSCRIPT FOR ${phone}:`);
    console.log(`─────────────────────────────────`);
    console.log(transcript);
    console.log(`─────────────────────────────────\n`);

    convo.saved = true;
    if (convo.timer) clearTimeout(convo.timer);
    console.log(`✅ Saved lead for ${phone} to Airtable`);
  } catch (err) {
    console.error(`❌ Error saving ${phone}:`, err.message);
    throw err;
  }
}

// ─── Initialize Client ────────────────────────────────────────────────────────
client.initialize();

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  getQR: () => currentQR,
  getStatus: () => clientStatus,
  getConversations: () => conversations,
  triggerSummarize,
};
