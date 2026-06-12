"use strict";

var Anthropic = require('@anthropic-ai/sdk');

var anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});
/**
 * Send a WhatsApp transcript to Claude and extract:
 * - Lead name, email
 * - Chat summary
 * - Lead status
 * - Main interest / topic
 */

function summarizeWithClaude(transcript) {
  var existingContact,
      prompt,
      response,
      text,
      clean,
      parsed,
      _args = arguments;
  return regeneratorRuntime.async(function summarizeWithClaude$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          existingContact = _args.length > 1 && _args[1] !== undefined ? _args[1] : {};
          prompt = "You are a sales assistant. Analyze this WhatsApp Business conversation between a customer (\uD83D\uDC64 Customer) and the business agent (\uD83D\uDFE2 Agent), and extract lead information.\n\nIMPORTANT: The summary must reflect the ENTIRE conversation \u2014 both what the customer said/asked AND what the agent replied (prices, delivery terms, availability, address confirmation, payment method, etc). Do not summarize only the customer's side.\n\nCONVERSATION:\n".concat(transcript, "\n\n").concat(existingContact.name ? "Known contact name: ".concat(existingContact.name) : '', "\n").concat(existingContact.email ? "Known email: ".concat(existingContact.email) : '', "\n\nExtract and return ONLY valid JSON (no markdown, no explanation) in this exact format:\n{\n  \"name\": \"Full name of the customer (or null if not mentioned)\",\n  \"email\": \"Email address (or null if not mentioned)\",\n  \"summary\": \"4-5 sentence summary of the FULL conversation \u2014 include what the customer asked AND how the agent (\uD83D\uDFE2 Agent) responded, including any prices quoted, delivery details, payment method, address, or commitments made by either side\",\n  \"interest\": \"Main product/service/topic the customer is interested in\",\n  \"leadStatus\": \"hot | warm | cold | not_a_lead\",\n  \"leadStatusReason\": \"One sentence explaining the lead status\"\n}\n\nleadStatus rules:\n- hot: Ready to buy, asked for price/quote, wants to proceed\n- warm: Interested, asking questions, but not ready yet\n- cold: Just browsing or gathering info, low intent\n- not_a_lead: Support issue, wrong number, spam, or irrelevant");
          _context.next = 4;
          return regeneratorRuntime.awrap(anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 700,
            messages: [{
              role: 'user',
              content: prompt
            }]
          }));

        case 4:
          response = _context.sent;
          text = response.content[0].text.trim(); // Strip any accidental markdown fences

          clean = text.replace(/```json|```/g, '').trim();
          parsed = JSON.parse(clean);
          return _context.abrupt("return", parsed);

        case 9:
        case "end":
          return _context.stop();
      }
    }
  });
}

module.exports = {
  summarizeWithClaude: summarizeWithClaude
};