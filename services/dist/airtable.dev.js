"use strict";

var Airtable = require('airtable');

var base = new Airtable({
  apiKey: process.env.AIRTABLE_API_KEY
}).base(process.env.AIRTABLE_BASE_ID);
var LEAD_TABLE = process.env.AIRTABLE_TABLE_NAME || 'Lead table';
var CUSTOMER_TABLE = process.env.AIRTABLE_CUSTOMER_TABLE || 'Customers';
var INVENTORY_TABLE = 'French Inventories';
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
 * Find an existing Lead record for this customer.
 * Searches via the "Name (from Customers)" lookup field which contains the phone.
 */


function findExistingLead(phone) {
  var formattedPhone, records;
  return regeneratorRuntime.async(function findExistingLead$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          formattedPhone = phone.startsWith('+') ? phone : "+".concat(phone);
          _context2.prev = 1;
          _context2.next = 4;
          return regeneratorRuntime.awrap(base(LEAD_TABLE).select({
            filterByFormula: "AND(\n          {Lead Source} = \"Whatsapp\",\n          FIND(\"".concat(formattedPhone, "\", ARRAYJOIN({Name (from Customers)}, \",\"))\n        )"),
            maxRecords: 1
          }).firstPage());

        case 4:
          records = _context2.sent;
          return _context2.abrupt("return", records && records.length > 0 ? records[0] : null);

        case 8:
          _context2.prev = 8;
          _context2.t0 = _context2["catch"](1);
          console.log("\u26A0\uFE0F  findExistingLead error: ".concat(_context2.t0.message));
          return _context2.abrupt("return", null);

        case 12:
        case "end":
          return _context2.stop();
      }
    }
  }, null, null, [[1, 8]]);
}
/**
 * Find matching product records in French Inventories using EXACT match only.
 * Compares "interest" against "Product Name" (case-insensitive, exact match).
 * If no exact match is found, returns an empty array (leaves field blank).
 */


function findMatchingProducts(interest) {
  var exactResults;
  return regeneratorRuntime.async(function findMatchingProducts$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          if (!(!interest || interest === 'Unknown')) {
            _context3.next = 2;
            break;
          }

          return _context3.abrupt("return", []);

        case 2:
          _context3.prev = 2;
          _context3.next = 5;
          return regeneratorRuntime.awrap(base(INVENTORY_TABLE).select({
            filterByFormula: "LOWER({Product Name}) = LOWER(\"".concat(interest.replace(/"/g, '\\"'), "\")"),
            maxRecords: 3,
            fields: ['Product Name', 'SKU']
          }).firstPage());

        case 5:
          exactResults = _context3.sent;

          if (!(exactResults && exactResults.length > 0)) {
            _context3.next = 9;
            break;
          }

          exactResults.forEach(function (r) {
            return console.log("\uD83D\uDD0E Exact match: ".concat(r.fields['Product Name']));
          });
          return _context3.abrupt("return", exactResults.map(function (r) {
            return r.id;
          }).slice(0, 3));

        case 9:
          _context3.next = 14;
          break;

        case 11:
          _context3.prev = 11;
          _context3.t0 = _context3["catch"](2);
          console.log("\u26A0\uFE0F  Exact match search error: ".concat(_context3.t0.message));

        case 14:
          console.log("\u2139\uFE0F  No exact match for \"".concat(interest, "\" \u2014 leaving Interested products blank"));
          return _context3.abrupt("return", []);

        case 16:
        case "end":
          return _context3.stop();
      }
    }
  }, null, null, [[2, 11]]);
}
/**
 * Format a given date as DD/MM/YYYY for the All time summary prefix.
 */


function formatLabel(date) {
  var day = String(date.getDate()).padStart(2, '0');
  var month = String(date.getMonth() + 1).padStart(2, '0');
  var year = date.getFullYear();
  return "".concat(day, "/").concat(month, "/").concat(year);
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


function saveToAirtable(_ref) {
  var name, phone, email, sessionSummary, fullConversation, leadStatus, interest, sessionDate, effectiveDate, today, dateLabel, customerId, productIds, existingLead, currentAllTime, newAllTime, updateFields, createFields;
  return regeneratorRuntime.async(function saveToAirtable$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          name = _ref.name, phone = _ref.phone, email = _ref.email, sessionSummary = _ref.sessionSummary, fullConversation = _ref.fullConversation, leadStatus = _ref.leadStatus, interest = _ref.interest, sessionDate = _ref.sessionDate;
          effectiveDate = sessionDate instanceof Date ? sessionDate : new Date();
          today = effectiveDate.toISOString().split('T')[0];
          dateLabel = formatLabel(effectiveDate); // Step 1 — find or create customer record

          _context4.next = 6;
          return regeneratorRuntime.awrap(findOrCreateCustomer(phone, name));

        case 6:
          customerId = _context4.sent;
          _context4.next = 9;
          return regeneratorRuntime.awrap(findMatchingProducts(interest));

        case 9:
          productIds = _context4.sent;

          if (productIds.length > 0) {
            console.log("\uD83D\uDECD\uFE0F  Linking ".concat(productIds.length, " product(s) to lead"));
          } // Step 3 — check if a Lead record already exists for this customer


          _context4.next = 13;
          return regeneratorRuntime.awrap(findExistingLead(phone));

        case 13:
          existingLead = _context4.sent;
          console.log("\uD83D\uDD0D Existing lead for phone ".concat(phone, ": ").concat(existingLead ? existingLead.id : 'not found'));

          if (!existingLead) {
            _context4.next = 25;
            break;
          }

          // ── UPDATE existing record ───────────────────────────────────────────────
          currentAllTime = existingLead.fields['All time summary'] || '';
          newAllTime = currentAllTime ? "".concat(currentAllTime, "\n\n[").concat(dateLabel, "] ").concat(sessionSummary) : "[".concat(dateLabel, "] ").concat(sessionSummary);
          updateFields = {
            'Summery of last conversation': sessionSummary,
            'All time summary': newAllTime,
            'Last communicated date': today
          };
          if (productIds.length > 0) updateFields['Interested products'] = productIds;
          _context4.next = 22;
          return regeneratorRuntime.awrap(base(LEAD_TABLE).update(existingLead.id, updateFields));

        case 22:
          console.log("\uD83D\uDCDD Updated Lead record for ".concat(phone, " \u2014 appended to All time summary"));
          _context4.next = 30;
          break;

        case 25:
          // ── CREATE new record ────────────────────────────────────────────────────
          createFields = {
            'Summery of last conversation': sessionSummary,
            'All time summary': "[".concat(dateLabel, "] ").concat(sessionSummary),
            'Last communicated date': today,
            'Lead created date': today,
            'Lead Source': 'Whatsapp',
            'Customers': [customerId]
          };
          if (productIds.length > 0) createFields['Interested products'] = productIds;
          _context4.next = 29;
          return regeneratorRuntime.awrap(base(LEAD_TABLE).create(createFields));

        case 29:
          console.log("\u2795 Created new Lead record for ".concat(phone));

        case 30:
        case "end":
          return _context4.stop();
      }
    }
  });
}

module.exports = {
  saveToAirtable: saveToAirtable
};