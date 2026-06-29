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
 */
async function backfillAllChats(client, beforeDate = null) {
  console.log('\n🔄 ═══════════════════════════════════════════');
  console.log('🔄 BACKFILL STARTED');
  if (beforeDate) {
    console.log(`🔄 Only processing sessions before: ${beforeDate.toISOString()}`);
  } else {
    console.log(`🔄 No cutoff date — processing ALL history (risk of duplicates with live data)`);
  }
  console.log('🔄 ═══════════════════════════════════════════\n');

  let chats;
  try {
    chats = await client.getChats();
  } catch (err) {
    console.error(`❌ Backfill failed to get chat list: ${err.message}`);
    return;
  }

  const individualChats = chats.filter((c) => !c.isGroup);
  console.log(`📋 Found ${individualChats.length} individual chat(s) to scan`);

  let totalSessionsSaved = 0;
  let totalChatsProcessed = 0;

  for (const chat of individualChats) {
    try {
      const rawMessages = await chat.fetchMessages({ limit: 2000 });
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

      // Apply cutoff — only keep sessions that ended before beforeDate
      if (beforeDate) {
        sessions = sessions.filter((s) => s[s.length - 1].timestamp < beforeDate.getTime());
      }

      if (sessions.length === 0) continue;

      // Filter out trivial sessions (single short messages like "Ok", "Yes", "Thanks")
      const trivialWords = ['ok', 'okay', 'yes', 'no', 'thanks', 'thank you', 'sure', 'fine', 'noted', 'k', 'hi', 'hello', 'bye'];
      sessions = sessions.filter(session => {
        if (session.length < 2) {
          const text = session[0]?.text?.toLowerCase().trim();
          if (trivialWords.includes(text)) return false;
        }
        // Also skip if total word count across all messages is under 10
        const totalWords = session.reduce((sum, m) => sum + m.text.split(/\s+/).length, 0);
        return totalWords >= 5;
      });

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

        // Gentle pacing to avoid hammering Claude/Airtable rate limits
        await new Promise((r) => setTimeout(r, 800));
      }
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