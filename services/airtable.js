const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  process.env.AIRTABLE_BASE_ID
);

const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Lead table';

/**
 * Save a new WhatsApp lead into the existing "Lead table".
 * Maps to the exact field names visible in Fragrant Souq's Airtable base.
 */
async function saveToAirtable({ name, phone, email, summary, fullConversation, leadStatus, interest }) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD only

  const fields = {
    'Summery of last conversation': summary,
    'Lead Source':                  'Whatsapp',
    'Last communicated date':       today,
    'Lead created date':            today,
  };

  // Only add these if Claude extracted them (they may not always be present)
  if (name)            fields['Customers']     = name;
  if (interest)        fields['Interest']      = interest;

  // Create a new lead record — Lead table uses new records per conversation
  await base(TABLE_NAME).create(fields);
  console.log(`➕ Created WhatsApp lead record for ${phone} — Lead Source: Whatsapp`);
}

module.exports = { saveToAirtable };
