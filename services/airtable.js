const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  process.env.AIRTABLE_BASE_ID
);

const LEAD_TABLE     = process.env.AIRTABLE_TABLE_NAME || 'Lead table';
const CUSTOMER_TABLE = process.env.AIRTABLE_CUSTOMER_TABLE || 'Customers';

/**
 * Find an existing customer by WhatsApp number, or create a new one.
 * Returns the Airtable record ID.
 */
async function findOrCreateCustomer(phone, name) {
  // Customers table stores numbers like "+971501776244"
  const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;

  // Try to find an existing customer with this WhatsApp number
  const existing = await base(CUSTOMER_TABLE)
    .select({
      filterByFormula: `{Whatsapp number} = "${formattedPhone}"`,
      maxRecords: 1,
    })
    .firstPage();

  if (existing && existing.length > 0) {
    console.log(`👤 Found existing customer for ${formattedPhone}`);
    return existing[0].id;
  }

  // Not found — create a new customer record
  const created = await base(CUSTOMER_TABLE).create({
    'Customer Name':   name || 'Unknown (WhatsApp)',
    'Whatsapp number': formattedPhone,
  });
  console.log(`👤➕ Created new customer for ${formattedPhone}`);
  return created.id;
}

/**
 * Save a new WhatsApp lead into the existing "Lead table".
 * Links to (or creates) a record in the Customers table.
 */
async function saveToAirtable({ name, phone, email, summary, fullConversation, leadStatus, interest }) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD only

  // Step 1 — find or create the linked customer record
  const customerId = await findOrCreateCustomer(phone, name);

  // Step 2 — build the lead record
  const fields = {
    'Summery of last conversation': summary,
    'Lead Source':                  'Whatsapp',
    'Last communicated date':       today,
    'Lead created date':            today,
    'Customers':                     [customerId],   // linked record field expects an array of IDs
  };

  // Note: 'Interest' field removed — not present in Lead table

  // Step 3 — create the lead record
  await base(LEAD_TABLE).create(fields);
  console.log(`➕ Created WhatsApp lead record for ${phone} — Lead Source: Whatsapp`);
}

module.exports = { saveToAirtable };
