"use strict";

function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _nonIterableRest(); }

function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance"); }

function _iterableToArrayLimit(arr, i) { if (!(Symbol.iterator in Object(arr) || Object.prototype.toString.call(arr) === "[object Arguments]")) { return; } var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"] != null) _i["return"](); } finally { if (_d) throw _e; } } return _arr; }

function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }

require('dotenv').config();

var express = require('express');

var _require = require('./services/whatsapp'),
    getQR = _require.getQR,
    getStatus = _require.getStatus,
    triggerSummarize = _require.triggerSummarize,
    getConversations = _require.getConversations,
    runBackfill = _require.runBackfill;

var app = express();
app.use(express.json()); // ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/', function (req, res) {
  res.json({
    service: 'WA → Airtable Lead Bot',
    whatsapp: getStatus(),
    tip: 'Visit /qr to scan the WhatsApp QR code'
  });
}); // ─── QR Code Page ─────────────────────────────────────────────────────────────

app.get('/qr', function (req, res) {
  var qrDataUrl = getQR();

  if (!qrDataUrl) {
    return res.send("\n      <!DOCTYPE html><html><head><title>WA Bot Status</title>\n      <meta http-equiv=\"refresh\" content=\"5\">\n      </head><body style=\"font-family:sans-serif;text-align:center;padding:60px\">\n        <h2>\u23F3 Waiting for QR code...</h2>\n        <p>Status: <strong>".concat(getStatus(), "</strong></p>\n        <p>This page refreshes every 5 seconds.</p>\n      </body></html>\n    "));
  }

  res.send("\n    <!DOCTYPE html><html><head><title>Scan QR Code</title>\n    <meta http-equiv=\"refresh\" content=\"30\">\n    </head><body style=\"font-family:sans-serif;text-align:center;padding:60px;background:#f0f0f0\">\n      <h2>\uD83D\uDCF1 Scan with WhatsApp</h2>\n      <p>Open WhatsApp \u2192 Linked Devices \u2192 Link a Device</p>\n      <img src=\"".concat(qrDataUrl, "\" style=\"width:280px;height:280px;border:8px solid white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.15)\" />\n      <p style=\"color:#888;font-size:14px\">QR refreshes automatically every 30 seconds</p>\n    </body></html>\n  "));
}); // ─── Connection Status ─────────────────────────────────────────────────────────

app.get('/status', function (req, res) {
  res.json({
    status: getStatus()
  });
}); // ─── Active Conversations ──────────────────────────────────────────────────────

app.get('/conversations', function (req, res) {
  var convos = getConversations();
  var summary = Object.entries(convos).map(function (_ref) {
    var _ref2 = _slicedToArray(_ref, 2),
        phone = _ref2[0],
        data = _ref2[1];

    return {
      phone: phone,
      contact: data.contact,
      messageCount: data.messages.length,
      lastActivity: data.lastActivity,
      savedToAirtable: data.saved
    };
  });
  res.json({
    count: summary.length,
    conversations: summary
  });
}); // ─── Manually Trigger Save for a Phone Number ─────────────────────────────────

app.post('/save/:phone', function _callee(req, res) {
  var phone;
  return regeneratorRuntime.async(function _callee$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          _context.prev = 0;
          phone = req.params.phone.replace(/\D/g, ''); // strip non-digits

          _context.next = 4;
          return regeneratorRuntime.awrap(triggerSummarize(phone));

        case 4:
          res.json({
            success: true,
            message: "Conversation for ".concat(phone, " saved to Airtable.")
          });
          _context.next = 11;
          break;

        case 7:
          _context.prev = 7;
          _context.t0 = _context["catch"](0);
          console.error(_context.t0);
          res.status(500).json({
            success: false,
            error: _context.t0.message
          });

        case 11:
        case "end":
          return _context.stop();
      }
    }
  }, null, null, [[0, 7]]);
}); // ─── One-Time Backfill of Historical WhatsApp Chats ───────────────────────────
// POST /backfill                     -> backfills ALL history (risk of duplicates with live data)
// POST /backfill?before=2026-06-18   -> only backfills sessions that ended before this date

var backfillRunning = false;
app.all('/backfill', function _callee2(req, res) {
  var beforeDate;
  return regeneratorRuntime.async(function _callee2$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          if (!backfillRunning) {
            _context2.next = 2;
            break;
          }

          return _context2.abrupt("return", res.status(409).json({
            success: false,
            error: 'Backfill is already running. Check logs for progress.'
          }));

        case 2:
          beforeDate = req.query.before ? new Date(req.query.before) : null;

          if (!(req.query.before && isNaN(beforeDate.getTime()))) {
            _context2.next = 5;
            break;
          }

          return _context2.abrupt("return", res.status(400).json({
            success: false,
            error: 'Invalid "before" date. Use format YYYY-MM-DD.'
          }));

        case 5:
          res.json({
            success: true,
            message: 'Backfill started in the background. Watch Render logs for progress.',
            cutoff: beforeDate ? beforeDate.toISOString() : 'none (processing all history)'
          });
          backfillRunning = true;
          runBackfill(beforeDate)["catch"](function (err) {
            return console.error("\u274C Backfill crashed: ".concat(err.message));
          })["finally"](function () {
            backfillRunning = false;
          });

        case 8:
        case "end":
          return _context2.stop();
      }
    }
  });
}); // ─── Start Server ──────────────────────────────────────────────────────────────

var PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log("\n\uD83D\uDE80 Server running on port ".concat(PORT));
  console.log("\uD83D\uDC49 Visit /qr to connect your WhatsApp\n");
});