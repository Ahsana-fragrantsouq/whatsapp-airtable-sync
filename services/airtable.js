const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  process.env.AIRTABLE_BASE_ID
);

const LEAD_TABLE      = process.env.AIRTABLE_TABLE_NAME || 'Lead table';
const CUSTOMER_TABLE  = process.env.AIRTABLE_CUSTOMER_TABLE || 'Customers';
const INVENTORY_TABLE = 'French Inventories';

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
 * Find matching product records in French Inventories using fuzzy search.
 * Searches "Product Name" field only.
 * Step 1: full phrase match (most accurate)
 * Step 2: single best keyword fallback (if no phrase match)
 * Returns array of matching record IDs (up to 3 matches).
 */
async function findMatchingProducts(interest) {
  if (!interest || interest === 'Unknown') return [];

  // Step 1 — try full phrase search first (most accurate)
  try {
    const phraseResults = await base(INVENTORY_TABLE)
      .select({
        filterByFormula: `FIND(LOWER("${interest.toLowerCase()}"), LOWER({Product Name}))`,
        maxRecords: 3,
        fields: ['Product Name', 'SKU'],
      })
      .firstPage();

    if (phraseResults && phraseResults.length > 0) {
      phraseResults.forEach(r => console.log(`🔎 Matched product: ${r.fields['Product Name']}`));
      return phraseResults.map(r => r.id).slice(0, 3);
    }
  } catch (err) {
    console.log(`⚠️  Full phrase search error: ${err.message}`);
  }

  // Step 2 — fall back to single most specific keyword only
  const stopWords = ['perfume', 'eau', 'de', 'parfum', 'edp', 'edt', 'ml', 'spray', 'unisex', 'men', 'women', 'for', 'the', 'and'];
  const keywords = interest
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.includes(w))
    .sort((a, b) => b.length - a.length); // longest = most specific first

  if (keywords.length === 0) return [];

  const bestKeyword = keywords[0];
  try {
    const results = await base(INVENTORY_TABLE)
      .select({
        filterByFormula: `FIND(LOWER("${bestKeyword}"), LOWER({Product Name}))`,
        maxRecords: 3,
        fields: ['Product Name', 'SKU'],
      })
      .firstPage();

    if (results && results.length > 0) {
      results.forEach(r => console.log(`🔎 Matched product (keyword "${bestKeyword}"): ${r.fields['Product Name']}`));
      return results.map(r => r.id).slice(0, 3);
    }
  } catch (err) {
    console.log(`⚠️  Keyword search error for "${bestKeyword}": ${err.message}`);
  }

  return [];
}

/**
 * Format a given date as DD/MM/YYYY for the All time summary prefix.
 */
function formatLabel(date) {
  const day   = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year  = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Save or update a WhatsApp lead in the Lead table.
 *
 * - "Summery of last conversation" → always replaced with the latest summary
 * - "All time summary"             → new summary appended with date prefix
 * - One record per customer (update if exists, create if not)
 *
 * sessionDate (optional) — pass a Date object when backfilling historical
 * conversations so the entry is dated correctly instead of "today".
 */
async function saveToAirtable({ name, phone, email, sessionSummary, fullConversation, leadStatus, interest, sessionDate }) {
  const effectiveDate = sessionDate instanceof Date ? sessionDate : new Date();
  const today     = effectiveDate.toISOString().split('T')[0];
  const dateLabel = formatLabel(effectiveDate);

  // Step 1 — find or create customer record
  const customerId = await findOrCreateCustomer(phone, name);

  // Step 2 — find matching products from French Inventories
  const productIds = await findMatchingProducts(interest);
  if (productIds.length > 0) {
    console.log(`🛍️  Linking ${productIds.length} product(s) to lead`);
  }

  // Step 3 — check if a Lead record already exists for this customer
  const existingLead = await findExistingLead(phone);
  console.log(`🔍 Existing lead for phone ${phone}: ${existingLead ? existingLead.id : 'not found'}`);

  if (existingLead) {
    // ── UPDATE existing record ───────────────────────────────────────────────
    const currentAllTime = existingLead.fields['All time summary'] || '';

    const newAllTime = currentAllTime
      ? `${currentAllTime}\n\n[${dateLabel}] ${sessionSummary}`
      : `[${dateLabel}] ${sessionSummary}`;

    const updateFields = {
      'Summery of last conversation': sessionSummary,
      'All time summary':             newAllTime,
      'Last communicated date':       today,
    };
    if (productIds.length > 0) updateFields['Interested products'] = productIds;

    await base(LEAD_TABLE).update(existingLead.id, updateFields);
    console.log(`📝 Updated Lead record for ${phone} — appended to All time summary`);

  } else {
    // ── CREATE new record ────────────────────────────────────────────────────
    const createFields = {
      'Summery of last conversation': sessionSummary,
      'All time summary':             `[${dateLabel}] ${sessionSummary}`,
      'Last communicated date':       today,
      'Lead created date':            today,
      'Lead Source':                  'Whatsapp',
      'Customers':                    [customerId],
    };
    if (productIds.length > 0) createFields['Interested products'] = productIds;

    await base(LEAD_TABLE).create(createFields);
    console.log(`➕ Created new Lead record for ${phone}`);
  }
}

module.exports = { saveToAirtable };