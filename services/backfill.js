/**
 * One-time backfill: reads WhatsApp chat history and saves historical
 * conversations to Airtable using the same Claude summarization pipeline
 * as live messages.
 *
 * Groups messages into sessions using the same 4-hour gap rule the live
 * system should use, so historical data looks consistent with new data.
 */

const { summarizeWithClaude } = require('./claude');
const { saveToAirtable } = require('./airtable');

const SESSION_GAP_MS = 4 * 60 * 60 * 1000; // 4 hours

function formatIST(ms) {
  return new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

/**
 * Groups a chronologically-sorted message list into sessions,
 * splitting whenever the gap between messages exceeds SESSION_GAP_MS.
 */
function groupIntoSessions(messages) {
  if (messages.length === 0) return [];
  const sessions = [];
  let current = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const gap = messages[i].timestamp - messages[i - 1].timestamp;
    if (gap > SESSION_GAP_MS) {
      sessions.push(current);
      current = [messages[i]];
    } else {
      current.push(messages[i]);
    }
  }
  sessions.push(current);
  return sessions;
}

/**
 * Runs the backfill across all individual (non-group) WhatsApp chats.
 *
 * @param {Client} client - the whatsapp-web.js client (already connected)
 * @param {Date|null} beforeDate - only backfill sessions that ENDED before
 *   this date. Pass null to backfill everything (risk of duplicating
 *   conversations already captured live).
 * @param {Date|null} afterDate - only backfill sessions that ENDED after this date.
 * @param {Function|null} onUnrecoverable - called if the WA page is confirmed
 *   dead (not just reloading) and needs a full client restart to recover.
 *   The restart preserves the saved session — no QR rescan required.
 */
async function backfillAllChats(client, beforeDate = null, afterDate = null, onUnrecoverable = null) {
  console.log('\n🔄 ═══════════════════════════════════════════');
  console.log('🔄 BACKFILL STARTED');
  if (afterDate)  console.log(`🔄 Only processing sessions after:  ${afterDate.toISOString()}`);
  if (beforeDate) console.log(`🔄 Only processing sessions before: ${beforeDate.toISOString()}`);
  if (!beforeDate && !afterDate) console.log(`🔄 No date filter — processing ALL history (risk of duplicates with live data)`);
  console.log('🔄 ═══════════════════════════════════════════\n');

  // Wait for WhatsApp to actually finish syncing the chat list into the
  // browser session before touching it — 'ready' fires on connection,
  // not on chat-history sync completion, and calling getChats() too early
  // is what's been producing the bare "r" error.
  console.log('⏳ Waiting for chat list to finish syncing...');
  const SYNC_CHECK_INTERVAL_MS = 5000;
  const SYNC_MAX_WAIT_MS = 3 * 60 * 1000; // up to 3 minutes
  let synced = false;
  const syncStart = Date.now();

  while (Date.now() - syncStart < SYNC_MAX_WAIT_MS) {
    try {
      const chatCount = await client.pupPage.evaluate(() => {
        try {
          return window.Store?.Chat?.getModelsArray?.().length ?? -1;
        } catch (_) {
          return -1;
        }
      });
      if (chatCount > 0) {
        console.log(`✅ Chat list synced — ${chatCount} chat(s) available after ${Math.round((Date.now() - syncStart) / 1000)}s`);
        synced = true;
        break;
      }
      console.log(`⏳ Still syncing (chatCount=${chatCount})... waiting`);
    } catch (err) {
      console.log(`⚠️  Sync check error: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, SYNC_CHECK_INTERVAL_MS));
  }

  if (!synced) {
    console.error(`❌ Chat list never finished syncing after ${SYNC_MAX_WAIT_MS / 1000}s — aborting backfill.`);
    return;
  }

  let chats;
  const MAX_GETCHATS_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_GETCHATS_ATTEMPTS; attempt++) {
    try {
      chats = await client.getChats();
      break;
    } catch (err) {
      // Log everything we can about this error — "r" alone isn't diagnostic
      console.error(`❌ getChats() attempt ${attempt}/${MAX_GETCHATS_ATTEMPTS} failed`);
      console.error(`   message: ${err?.message}`);
      console.error(`   name:    ${err?.name}`);
      console.error(`   stack:   ${err?.stack?.split('\n').slice(0, 3).join(' | ')}`);
      const isDetachedFrame = /detached Frame|Session closed|Target closed/i.test(err?.message || '');
      if (!isDetachedFrame || attempt === MAX_GETCHATS_ATTEMPTS) break;
      const waitMs = 8000 * attempt;
      console.log(`⏳ Detached frame detected — waiting ${waitMs / 1000}s before retrying...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  if (!chats) {
    console.error(`❌ Backfill aborted — chat list unreachable.`);
    if (typeof onUnrecoverable === 'function') {
      console.log('🔄 Triggering a safe client restart to recover (session preserved, no QR needed)...');
      onUnrecoverable();
    }
    return;
  }

  const individualChats = chats.filter((c) => !c.isGroup);
  console.log(`📋 Found ${individualChats.length} individual chat(s) to scan`);

  let totalSessionsSaved = 0;
  let totalChatsProcessed = 0;

  for (const chat of individualChats) {
    try {
      const rawMessages = await chat.fetchMessages({ limit: 500 });
      if (!rawMessages || rawMessages.length === 0) continue;

      // Resolve the real phone number (chat.id.user may be a LID)
      let phone = chat.id.user.replace(/\D/g, '');
      let contactName = chat.name || null;
      try {
        const contact = await chat.getContact();
        if (contact.id?.user) phone = contact.id.user.replace(/\D/g, '');
        contactName = contact.pushname || contact.name || contactName;
      } catch (_) {}

      // Normalize and sort chronologically
      const normalized = rawMessages
        .filter((m) => m.body && m.body.trim() && !m.isStatus)
        .map((m) => ({
          role: m.fromMe ? 'agent' : 'customer',
          text: m.body.trim(),
          timestamp: m.timestamp * 1000, // whatsapp-web.js gives seconds, convert to ms
        }))
        .sort((a, b) => a.timestamp - b.timestamp);

      if (normalized.length === 0) continue;

      let sessions = groupIntoSessions(normalized);

      // Apply date filters
      if (beforeDate) {
        sessions = sessions.filter((s) => s[s.length - 1].timestamp < beforeDate.getTime());
      }
      if (afterDate) {
        sessions = sessions.filter((s) => s[s.length - 1].timestamp > afterDate.getTime());
      }

      if (sessions.length === 0) continue;

      console.log(`\n📞 ${phone} (${contactName || 'Unknown'}): ${sessions.length} historical session(s) to backfill`);
      totalChatsProcessed++;

      // Process oldest → newest so "Summery of last conversation" ends up correct
      for (const session of sessions) {
        const transcript = session
          .map((m) => `[${formatIST(m.timestamp)}] ${m.role === 'agent' ? '🟢 Agent' : '👤 Customer'}: ${m.text}`)
          .join('\n');

        let extracted;
        try {
          extracted = await summarizeWithClaude(transcript, { name: contactName, email: null });
        } catch (err) {
          console.log(`⚠️  Claude failed for a session of ${phone}: ${err.message} — skipping this session`);
          continue;
        }

        try {
          await saveToAirtable({
            name: extracted.name || contactName || 'Unknown',
            phone,
            email: extracted.email || '',
            sessionSummary: extracted.sessionSummary || 'Summary unavailable',
            fullConversation: transcript,
            leadStatus: extracted.leadStatus,
            interest: extracted.interest,
            sessionDate: new Date(session[session.length - 1].timestamp),
          });
          totalSessionsSaved++;
          console.log(`   ✅ Session saved (${formatIST(session[0].timestamp)} → ${formatIST(session[session.length - 1].timestamp)})`);
        } catch (err) {
          console.log(`   ❌ Airtable save failed: ${err.message}`);
        }

        // Longer pacing to protect Chrome from overload
        await new Promise((r) => setTimeout(r, 2000));
      }

      // Pause between chats to let Chrome breathe
      await new Promise((r) => setTimeout(r, 3000));
    } catch (err) {
      console.log(`⚠️  Error processing a chat: ${err.message}`);
    }
  }

  console.log('\n🔄 ═══════════════════════════════════════════');
  console.log(`✅ BACKFILL COMPLETE`);
  console.log(`✅ Chats processed: ${totalChatsProcessed}`);
  console.log(`✅ Sessions saved:  ${totalSessionsSaved}`);
  console.log('🔄 ═══════════════════════════════════════════\n');
}

module.exports = { backfillAllChats };