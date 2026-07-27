"use strict";

/**
 * One-time backfill: reads WhatsApp chat history and saves historical
 * conversations to Airtable using the same Claude summarization pipeline
 * as live messages.
 *
 * Groups messages into sessions using the same 4-hour gap rule the live
 * system should use, so historical data looks consistent with new data.
 */
var _require = require('./claude'),
    summarizeWithClaude = _require.summarizeWithClaude;

var _require2 = require('./airtable'),
    saveToAirtable = _require2.saveToAirtable;

var SESSION_GAP_MS = 4 * 60 * 60 * 1000; // 4 hours

function formatIST(ms) {
  return new Date(ms).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata'
  });
}
/**
 * Groups a chronologically-sorted message list into sessions,
 * splitting whenever the gap between messages exceeds SESSION_GAP_MS.
 */


function groupIntoSessions(messages) {
  if (messages.length === 0) return [];
  var sessions = [];
  var current = [messages[0]];

  for (var i = 1; i < messages.length; i++) {
    var gap = messages[i].timestamp - messages[i - 1].timestamp;

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


module.exports = {
  backfillAllChats: backfillAllChats
};