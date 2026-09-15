"use strict";

var Airtable = require('airtable');

var base = new Airtable({
  apiKey: process.env.AIRTABLE_API_KEY
}).base(process.env.AIRTABLE_BASE_ID);
var LEAD_TABLE = process.env.AIRTABLE_TABLE_NAME || 'Lead table';
var CUSTOMER_TABLE = process.env.AIRTABLE_CUSTOMER_TABLE || 'Customers';
var INVENTORY_TABLE = 'French Inventories'; // Plain text (or URL) field on LEAD_TABLE — not an Attachment field.
// Multiple images in one session are stored as newline-separated URLs.

var IMAGE_URL_FIELD = process.env.AIRTABLE_IMAGE_FIELD || 'image_url';

var _require = require('./cloudinary_upload'),
    uploadImageToCloudinary = _require.uploadImageToCloudinary;
/**
 * Uploads each image to Cloudinary and returns their public URLs.
 * Failures for individual images are logged and skipped rather than
 * failing the whole session save.
 */


function uploadImagesGetUrls(images) {
  var urls, _iteratorNormalCompletion, _didIteratorError, _iteratorError, _iterator, _step, img, url;

  return regeneratorRuntime.async(function uploadImagesGetUrls$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          urls = [];
          _iteratorNormalCompletion = true;
          _didIteratorError = false;
          _iteratorError = undefined;
          _context.prev = 4;
          _iterator = images[Symbol.iterator]();

        case 6:
          if (_iteratorNormalCompletion = (_step = _iterator.next()).done) {
            _context.next = 22;
            break;
          }

          img = _step.value;
          _context.prev = 8;
          _context.next = 11;
          return regeneratorRuntime.awrap(uploadImageToCloudinary(img.data, img.mimetype, img.filename));

        case 11:
          url = _context.sent;
          urls.push(url);
          console.log("\uD83D\uDDBC\uFE0F  Uploaded to Cloudinary: ".concat(url));
          _context.next = 19;
          break;

        case 16:
          _context.prev = 16;
          _context.t0 = _context["catch"](8);
          console.log("\u26A0\uFE0F  Cloudinary upload failed: ".concat(_context.t0.message));

        case 19:
          _iteratorNormalCompletion = true;
          _context.next = 6;
          break;

        case 22:
          _context.next = 28;
          break;

        case 24:
          _context.prev = 24;
          _context.t1 = _context["catch"](4);
          _didIteratorError = true;
          _iteratorError = _context.t1;

        case 28:
          _context.prev = 28;
          _context.prev = 29;

          if (!_iteratorNormalCompletion && _iterator["return"] != null) {
            _iterator["return"]();
          }

        case 31:
          _context.prev = 31;

          if (!_didIteratorError) {
            _context.next = 34;
            break;
          }

          throw _iteratorError;

        case 34:
          return _context.finish(31);

        case 35:
          return _context.finish(28);

        case 36:
          return _context.abrupt("return", urls);

        case 37:
        case "end":
          return _context.stop();
      }
    }
  }, null, null, [[4, 24, 28, 36], [8, 16], [29,, 31, 35]]);
}
/**
 * Find an existing customer by WhatsApp number, or create a new one.
 * Returns the Airtable record ID.
 */


function findOrCreateCustomer(phone, name) {
  var formattedPhone, existing, created;
  return regeneratorRuntime.async(function findOrCreateCustomer$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          formattedPhone = phone.startsWith('+') ? phone : "+".concat(phone);
          _context2.next = 3;
          return regeneratorRuntime.awrap(base(CUSTOMER_TABLE).select({
            filterByFormula: "{Whatsapp number} = \"".concat(formattedPhone, "\""),
            maxRecords: 1
          }).firstPage());

        case 3:
          existing = _context2.sent;

          if (!(existing && existing.length > 0)) {
            _context2.next = 7;
            break;
          }

          console.log("\uD83D\uDC64 Found existing customer for ".concat(formattedPhone));
          return _context2.abrupt("return", existing[0].id);

        case 7:
          _context2.next = 9;
          return regeneratorRuntime.awrap(base(CUSTOMER_TABLE).create({
            'Customer Name': name || 'Unknown (WhatsApp)',
            'Whatsapp number': formattedPhone
          }));

        case 9:
          created = _context2.sent;
          console.log("\uD83D\uDC64\u2795 Created new customer for ".concat(formattedPhone));
          return _context2.abrupt("return", created.id);

        case 12:
        case "end":
          return _context2.stop();
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
  return regeneratorRuntime.async(function findExistingLead$(_context3) {
    while (1) {
      switch (_context3.prev = _context3.next) {
        case 0:
          formattedPhone = phone.startsWith('+') ? phone : "+".concat(phone);
          _context3.prev = 1;
          _context3.next = 4;
          return regeneratorRuntime.awrap(base(LEAD_TABLE).select({
            filterByFormula: "AND(\n          {Lead Source} = \"Whatsapp\",\n          FIND(\"".concat(formattedPhone, "\", ARRAYJOIN({Name (from Customers)}, \",\"))\n        )"),
            maxRecords: 1
          }).firstPage());

        case 4:
          records = _context3.sent;
          return _context3.abrupt("return", records && records.length > 0 ? records[0] : null);

        case 8:
          _context3.prev = 8;
          _context3.t0 = _context3["catch"](1);
          console.log("\u26A0\uFE0F  findExistingLead error: ".concat(_context3.t0.message));
          return _context3.abrupt("return", null);

        case 12:
        case "end":
          return _context3.stop();
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
  return regeneratorRuntime.async(function findMatchingProducts$(_context4) {
    while (1) {
      switch (_context4.prev = _context4.next) {
        case 0:
          if (!(!interest || interest === 'Unknown')) {
            _context4.next = 2;
            break;
          }

          return _context4.abrupt("return", []);

        case 2:
          _context4.prev = 2;
          _context4.next = 5;
          return regeneratorRuntime.awrap(base(INVENTORY_TABLE).select({
            filterByFormula: "LOWER({Product Name}) = LOWER(\"".concat(interest.replace(/"/g, '\\"'), "\")"),
            maxRecords: 3,
            fields: ['Product Name', 'SKU']
          }).firstPage());

        case 5:
          exactResults = _context4.sent;

          if (!(exactResults && exactResults.length > 0)) {
            _context4.next = 9;
            break;
          }

          exactResults.forEach(function (r) {
            return console.log("\uD83D\uDD0E Exact match: ".concat(r.fields['Product Name']));
          });
          return _context4.abrupt("return", exactResults.map(function (r) {
            return r.id;
          }).slice(0, 3));

        case 9:
          _context4.next = 14;
          break;

        case 11:
          _context4.prev = 11;
          _context4.t0 = _context4["catch"](2);
          console.log("\u26A0\uFE0F  Exact match search error: ".concat(_context4.t0.message));

        case 14:
          console.log("\u2139\uFE0F  No exact match for \"".concat(interest, "\" \u2014 leaving Interested products blank"));
          return _context4.abrupt("return", []);

        case 16:
        case "end":
          return _context4.stop();
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
  var name, phone, email, sessionSummary, fullConversation, leadStatus, interest, sessionDate, images, effectiveDate, today, dateLabel, customerId, productIds, existingLead, newImageUrls, currentAllTime, newAllTime, updateFields, currentUrls, createFields;
  return regeneratorRuntime.async(function saveToAirtable$(_context5) {
    while (1) {
      switch (_context5.prev = _context5.next) {
        case 0:
          name = _ref.name, phone = _ref.phone, email = _ref.email, sessionSummary = _ref.sessionSummary, fullConversation = _ref.fullConversation, leadStatus = _ref.leadStatus, interest = _ref.interest, sessionDate = _ref.sessionDate, images = _ref.images;
          effectiveDate = sessionDate instanceof Date ? sessionDate : new Date();
          today = effectiveDate.toISOString().split('T')[0];
          dateLabel = formatLabel(effectiveDate); // Step 1 — find or create customer record

          _context5.next = 6;
          return regeneratorRuntime.awrap(findOrCreateCustomer(phone, name));

        case 6:
          customerId = _context5.sent;
          _context5.next = 9;
          return regeneratorRuntime.awrap(findMatchingProducts(interest));

        case 9:
          productIds = _context5.sent;

          if (productIds.length > 0) {
            console.log("\uD83D\uDECD\uFE0F  Linking ".concat(productIds.length, " product(s) to lead"));
          } // Step 3 — check if a Lead record already exists for this customer


          _context5.next = 13;
          return regeneratorRuntime.awrap(findExistingLead(phone));

        case 13:
          existingLead = _context5.sent;
          console.log("\uD83D\uDD0D Existing lead for phone ".concat(phone, ": ").concat(existingLead ? existingLead.id : 'not found')); // Step 4 — upload any images from this session to Cloudinary

          if (!(images && images.length)) {
            _context5.next = 21;
            break;
          }

          _context5.next = 18;
          return regeneratorRuntime.awrap(uploadImagesGetUrls(images));

        case 18:
          _context5.t0 = _context5.sent;
          _context5.next = 22;
          break;

        case 21:
          _context5.t0 = [];

        case 22:
          newImageUrls = _context5.t0;

          if (!existingLead) {
            _context5.next = 34;
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

          if (newImageUrls.length > 0) {
            currentUrls = existingLead.fields[IMAGE_URL_FIELD] || '';
            updateFields[IMAGE_URL_FIELD] = currentUrls ? "".concat(currentUrls, "\n").concat(newImageUrls.join('\n')) : newImageUrls.join('\n');
          }

          _context5.next = 31;
          return regeneratorRuntime.awrap(base(LEAD_TABLE).update(existingLead.id, updateFields));

        case 31:
          console.log("\uD83D\uDCDD Updated Lead record for ".concat(phone, " \u2014 appended to All time summary"));
          _context5.next = 40;
          break;

        case 34:
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
          if (newImageUrls.length > 0) createFields[IMAGE_URL_FIELD] = newImageUrls.join('\n');
          _context5.next = 39;
          return regeneratorRuntime.awrap(base(LEAD_TABLE).create(createFields));

        case 39:
          console.log("\u2795 Created new Lead record for ".concat(phone));

        case 40:
        case "end":
          return _context5.stop();
      }
    }
  });
}

module.exports = {
  saveToAirtable: saveToAirtable
};