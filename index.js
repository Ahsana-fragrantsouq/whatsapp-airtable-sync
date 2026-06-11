require('dotenv').config();
const express = require('express');
const { getQR, getStatus, triggerSummarize, getConversations } = require('./services/whatsapp');

const app = express();
app.use(express.json());

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    service: 'WA → Airtable Lead Bot',
    whatsapp: getStatus(),
    tip: 'Visit /qr to scan the WhatsApp QR code',
  });
});

// ─── QR Code Page ─────────────────────────────────────────────────────────────
app.get('/qr', (req, res) => {
  const qrDataUrl = getQR();

  if (!qrDataUrl) {
    return res.send(`
      <!DOCTYPE html><html><head><title>WA Bot Status</title>
      <meta http-equiv="refresh" content="5">
      </head><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2>⏳ Waiting for QR code...</h2>
        <p>Status: <strong>${getStatus()}</strong></p>
        <p>This page refreshes every 5 seconds.</p>
      </body></html>
    `);
  }

  res.send(`
    <!DOCTYPE html><html><head><title>Scan QR Code</title>
    <meta http-equiv="refresh" content="30">
    </head><body style="font-family:sans-serif;text-align:center;padding:60px;background:#f0f0f0">
      <h2>📱 Scan with WhatsApp</h2>
      <p>Open WhatsApp → Linked Devices → Link a Device</p>
      <img src="${qrDataUrl}" style="width:280px;height:280px;border:8px solid white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.15)" />
      <p style="color:#888;font-size:14px">QR refreshes automatically every 30 seconds</p>
    </body></html>
  `);
});

// ─── Connection Status ─────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  res.json({ status: getStatus() });
});

// ─── Active Conversations ──────────────────────────────────────────────────────
app.get('/conversations', (req, res) => {
  const convos = getConversations();
  const summary = Object.entries(convos).map(([phone, data]) => ({
    phone,
    contact: data.contact,
    messageCount: data.messages.length,
    lastActivity: data.lastActivity,
    savedToAirtable: data.saved,
  }));
  res.json({ count: summary.length, conversations: summary });
});

// ─── Manually Trigger Save for a Phone Number ─────────────────────────────────
app.post('/save/:phone', async (req, res) => {
  try {
    const phone = req.params.phone.replace(/\D/g, ''); // strip non-digits
    await triggerSummarize(phone);
    res.json({ success: true, message: `Conversation for ${phone} saved to Airtable.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`👉 Visit /qr to connect your WhatsApp\n`);
});
