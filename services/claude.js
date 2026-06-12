const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Send a WhatsApp transcript to Claude and extract:
 * - Lead name, email
 * - Chat summary
 * - Lead status
 * - Main interest / topic
 */
async function summarizeWithClaude(transcript, existingContact = {}) {
  const prompt = `You are a sales assistant. Analyze this WhatsApp Business conversation and extract lead information.

CONVERSATION:
${transcript}

${existingContact.name ? `Known contact name: ${existingContact.name}` : ''}
${existingContact.email ? `Known email: ${existingContact.email}` : ''}

Extract and return ONLY valid JSON (no markdown, no explanation) in this exact format:
{
  "name": "Full name of the customer (or null if not mentioned)",
  "email": "Email address (or null if not mentioned)",
  "summary": "2-3 sentence summary of the conversation",
  "interest": "Main product/service/topic the customer is interested in",
  "leadStatus": "hot | warm | cold | not_a_lead",
  "leadStatusReason": "One sentence explaining the lead status"
}

leadStatus rules:
- hot: Ready to buy, asked for price/quote, wants to proceed
- warm: Interested, asking questions, but not ready yet
- cold: Just browsing or gathering info, low intent
- not_a_lead: Support issue, wrong number, spam, or irrelevant`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();

  // Strip any accidental markdown fences
  const clean = text.replace(/```json|```/g, '').trim();

  const parsed = JSON.parse(clean);
  return parsed;
}

module.exports = { summarizeWithClaude };
