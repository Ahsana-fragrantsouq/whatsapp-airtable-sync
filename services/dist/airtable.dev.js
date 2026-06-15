"use strict";

var Airtable = require('airtable');

var base = new Airtable({
  apiKey: process.env.AIRTABLE_API_KEY
}).base(process.env.AIRTABLE_BASE_ID);
var LEAD_TABLE = process.env.AIRTABLE_TABLE_NAME || 'Lead table';
var CUSTOMER_TABLE = process.env.AIRTABLE_CUSTOMER_TABLE || 'Customers';
/**
 * Find an existing customer by WhatsApp number, or create a new one.
 * Returns the Airtable record ID.
 */

function findOrCreateCustomer(phone, name) {
  var formattedPhone, existing, created;
  return regeneratorRuntime.async(function findOrCreateCustomer$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          formattedPhone = phone.startsWith('+') ? phone : "+".concat(phone);
          _context.next = 3;
          return regeneratorRuntime.awrap(base(CUSTOMER_TABLE).select({
            filterByFormula: "{Whatsapp number} = \"".concat(formattedPhone, "\""),
            maxRecords: 1
          }).firstPage());

        case 3:
          existing = _context.sent;

          if (!(existing && existing.length > 0)) {
            _context.next = 7;
            break;
          }

          console.log("\uD83D\uDC64 Found existing customer for ".concat(formattedPhone));
          return _context.abrupt("return", existing[0].id);

        case 7:
          _context.next = 9;
          return regeneratorRuntime.awrap(base(CUSTOMER_TABLE).create({
            'Customer Name': name || 'Unknown (WhatsApp)',
            'Whatsapp number': formattedPhone
          }));

        case 9:
          created = _context.sent;
          console.log("\uD83D\uDC64\u2795 Created new customer for ".concat(formattedPhone));
          return _context.abrupt("return", created.id);

        case 12:
        case "end":
          return _context.stop();
      }
    }
  });
}
/**
 * Find an existing Lead record for this phone number.
 * Returns the record or null.
 */


function findExistingLead(customerId) {
  var existing;
  return regeneratorRuntime.async(function findExistingLead$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          _context2.next = 2;
          return regeneratorRuntime.awrap(base(LEAD_TABLE).select({
            filterByFormula: "FIND(\"".concat(customerId, "\", ARRAYJOIN({Customers}))"),
            maxRecords: 1
          }).firstPage());

        case 2:
          existing = _context2.sent;
          return _context2.abrupt("return", existing && existing.length > 0 ? existing[0] : null);

        case 4:
        case "end":
          return _context2.stop();
      }
    }
  });
}
/**
 * Format today's date as DD/MM/YYYY for the All time summary prefix.
 */


function todayLabel() {
  var d = new Date();
  var day = String(d.getDate()).padStart(2, '0');
  var month = String(d.getMonth() + 1).padStart(2, '0');
  var year = d.getFullYear();
  return "".concat(day, "/").concat(month, "/").concat(year);
}
/**
 * Save or update a WhatsApp lead in the Lead table.
 *
 * - "Summery of last conversation" → always replaced with the latest summary
 * - "All time summary"             → new summary appended with today's date prefix
 * - One record per customer (update if exists, create if not)
 */


function saveToAirtable(_ref) {
  var name, phone, email, summary, fullConversation, leadStatus, interest, today, dateLabel, customerId, existingLead, currentAllTime, newAllTime;
  return regeneratorRuntime.async(function saveToAirtable$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          name = _ref.name, phone = _ref.phone, email = _ref.email, summary = _ref.summary, fullConversation = _ref.fullConversation, leadStatus = _ref.leadStatus, interest = _ref.interest;
          today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD for date fields

          dateLabel = todayLabel(); // DD/MM/YYYY for summary prefix
          // Step 1 — find or create customer record

          _context3.next = 5;
          return regeneratorRuntime.awrap(findOrCreateCustomer(phone, name));

        case 5:
          customerId = _context3.sent;
          _context3.next = 8;
          return regeneratorRuntime.awrap(findExistingLead(customerId));

        case 8:
          existingLead = _context3.sent;

          if (!existingLead) {
            _context3.next = 17;
            break;
          }

          // ── UPDATE existing record ───────────────────────────────────────────────
          currentAllTime = existingLead.fields['All time summary'] || ''; // Append today's summary as a new dated entry

          newAllTime = currentAllTime ? "".concat(currentAllTime, "\n\n[").concat(dateLabel, "] ").concat(summary) : "[".concat(dateLabel, "] ").concat(summary);
          _context3.next = 14;
          return regeneratorRuntime.awrap(base(LEAD_TABLE).update(existingLead.id, {
            'Summery of last conversation': summary,
            'All time summary': newAllTime,
            'Last communicated date': today
          }));

        case 14:
          console.log("\uD83D\uDCDD Updated Lead record for ".concat(phone, " \u2014 appended to All time summary"));
          _context3.next = 20;
          break;

        case 17:
          _context3.next = 19;
          return regeneratorRuntime.awrap(base(LEAD_TABLE).create({
            'Summery of last conversation': summary,
            'All time summary': "[".concat(dateLabel, "] ").concat(summary),
            'Last communicated date': today,
            'Lead created date': today,
            'Lead Source': 'Whatsapp',
            'Customers': [customerId]
          }));

        case 19:
          console.log("\u2795 Created new Lead record for ".concat(phone));

        case 20:
        case "end":
          return _context3.stop();
      }
    }
  });
}

module.exports = {
  saveToAirtable: saveToAirtable
};