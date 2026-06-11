# 📱 WhatsApp Business → Airtable Lead Bot

Automatically captures WhatsApp Business conversations, extracts lead info using Claude AI, and saves everything to Airtable.

---

## 🔄 How It Works

1. Customer sends a WhatsApp message to your business number
2. Bot tracks the full conversation
3. After **30 minutes of inactivity** (configurable), Claude AI:
   - Extracts: **Name, Email, Interest, Lead Status**
   - Writes a **2-3 sentence summary**
4. Everything is saved to your **Airtable** base

---

## 🗂️ Airtable Table Setup

Create a table called **Leads** with these fields:

| Field Name        | Type          |
|-------------------|---------------|
| Name              | Single line   |
| Phone             | Phone number  |
| Email             | Email         |
| Summary           | Long text     |
| Full Conversation | Long text     |
| Lead Status       | Single select (hot, warm, cold, not_a_lead) |
| Interest          | Single line   |
| Last Updated      | Date/time     |

---

## 🚀 Deploy to Render

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/wa-airtable-bot.git
git push -u origin main
```

### Step 2 — Create Render Service
1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo
3. Set:
   - **Environment**: Docker
   - **Dockerfile path**: `./Dockerfile`

### Step 3 — Add Environment Variables in Render
Under **Environment**, add:
```
ANTHROPIC_API_KEY      = sk-ant-...
AIRTABLE_API_KEY       = pat...
AIRTABLE_BASE_ID       = app...
AIRTABLE_TABLE_NAME    = Leads
INACTIVITY_MINUTES     = 30
```

### Step 4 — Scan the QR Code
1. After deploy, open `https://your-app.onrender.com/qr`
2. Scan with WhatsApp: **Linked Devices → Link a Device**
3. Done! ✅

---

## 🌐 API Endpoints

| Endpoint            | Description                              |
|---------------------|------------------------------------------|
| `GET /`             | Health check                             |
| `GET /qr`           | QR code page to connect WhatsApp         |
| `GET /status`       | WhatsApp connection status               |
| `GET /conversations`| Active tracked conversations             |
| `POST /save/:phone` | Manually save a conversation immediately |

**Example manual save:**
```bash
curl -X POST https://your-app.onrender.com/save/905551234567
```

---

## ⚠️ Important Notes

- **Session persistence**: The WhatsApp session is saved in `.wwebjs_auth/`. On Render, use a **persistent disk** (paid plan) or you'll need to re-scan QR on every restart.
- **Free tier**: Render free services sleep after inactivity. Use the paid plan ($7/mo) to keep it running 24/7.
- This uses **whatsapp-web.js** (unofficial API). It works like WhatsApp Web — your phone must stay connected to the internet.
