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
  const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;

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

  const created = await base(CUSTOMER_TABLE).create({
    'Customer Name':   name || 'Unknown (WhatsApp)',
    'Whatsapp number': formattedPhone,
  });
  console.log(`👤➕ Created new customer for ${formattedPhone}`);
  return created.id;
}

/**
 * Find an existing Lead record for this customer.
 * Searches via the "Name (from Customers)" lookup field which contains the phone.
 */
async function findExistingLead(phone) {
  const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;
  try {
    // "Name (from Customers)" lookup field contains "CustomerName/+phone/"
    const records = await base(LEAD_TABLE)
      .select({
        filterByFormula: `AND(
          {Lead Source} = "Whatsapp",
          FIND("${formattedPhone}", ARRAYJOIN({Name (from Customers)}, ","))
        )`,
        maxRecords: 1,
      })
      .firstPage();
    return records && records.length > 0 ? records[0] : null;
  } catch (err) {
    console.log(`⚠️  findExistingLead error: ${err.message}`);
    return null;
  }
}

/**
 * Format today's date as DD/MM/YYYY for the All time summary prefix.
 */
function todayLabel() {
  const d = new Date();
  const day   = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year  = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Save or update a WhatsApp lead in the Lead table.
 *
 * - "Summery of last conversation" → always replaced with the latest summary
 * - "All time summary"             → new summary appended with today's date prefix
 * - One record per customer (update if exists, create if not)
 */
async function saveToAirtable({ name, phone, email, summary, lastSessionSummary, fullConversation, leadStatus, interest }) {
  const today     = new Date().toISOString().split('T')[0]; // YYYY-MM-DD for date fields
  const dateLabel = todayLabel();                            // DD/MM/YYYY for summary prefix

  // Step 1 — find or create customer record
  const customerId = await findOrCreateCustomer(phone, name);

  // Step 2 — check if a Lead record already exists for this customer
  const existingLead = await findExistingLead(phone);
  console.log(`🔍 Existing lead for phone ${phone}: ${existingLead ? existingLead.id : 'not found'}`);

  if (existingLead) {
    // ── UPDATE existing record ───────────────────────────────────────────────
    const currentAllTime = existingLead.fields['All time summary'] || '';

    // Append today's summary as a new dated entry
    const newAllTime = currentAllTime
      ? `${currentAllTime}\n\n[${dateLabel}] ${summary}`
      : `[${dateLabel}] ${summary}`;

    await base(LEAD_TABLE).update(existingLead.id, {
      'Summery of last conversation': lastSessionSummary || summary,
      'All time summary':             newAllTime,
      'Last communicated date':       today,
    });

    console.log(`📝 Updated Lead record for ${phone} — appended to All time summary`);

  } else {
    // ── CREATE new record ────────────────────────────────────────────────────
    await base(LEAD_TABLE).create({
      'Summery of last conversation': lastSessionSummary || summary,
      'All time summary':             `[${dateLabel}] ${summary}`,
      'Last communicated date':       today,
      'Lead created date':            today,
      'Lead Source':                  'Whatsapp',
      'Customers':                    [customerId],
    });

    console.log(`➕ Created new Lead record for ${phone}`);
  }
}

module.exports = { saveToAirtable };