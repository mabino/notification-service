// --- Constants ---
const PROP_INTERVAL_SECONDS = "NOTIFICATION_INTERVAL_SECONDS";
const PROP_TOKEN_LIST = "TOKEN_LIST"; // legacy support
const PROP_TOKEN_PREFIX = "TOKEN_"; // new: store tokens as TOKEN_<source>
const PROP_RECIPIENT = "NOTIFICATION_RECIPIENT"; // recipient email
const PROP_LAST_USED_PREFIX = "last_used_";
const PROP_INVALID_PREFIX = "invalid_"; // invalid attempt tracking per source
const DEFAULT_INTERVAL_SECONDS = "60";
const MAX_MSG_LENGTH = 255;
const LOCK_TIMEOUT_MS = 5000;

// Brute-force detection
const BRUTE_FORCE_THRESHOLD = 5; // attempts
const BRUTE_FORCE_WINDOW_SECONDS = 3600; // seconds

function doPost(e) {
  // --- Configuration ---
  var scriptProperties = PropertiesService.getScriptProperties();
  // Use Number() for consistency
  var tokenUseIntervalSeconds = Number(scriptProperties.getProperty(PROP_INTERVAL_SECONDS) || DEFAULT_INTERVAL_SECONDS);
  // Load tokens: prefer individual TOKEN_<source> properties, fall back to legacy TOKEN_LIST
  var tokens = {};
  var allProps = scriptProperties.getProperties();
  for (var k in allProps) {
    if (Object.prototype.hasOwnProperty.call(allProps, k) && k.indexOf(PROP_TOKEN_PREFIX) === 0) {
      var source = k.substring(PROP_TOKEN_PREFIX.length);
      if (source) tokens[source] = allProps[k];
    }
  }
  // Legacy support for comma-separated TOKEN_LIST
  if (Object.keys(tokens).length === 0) {
    var tokenListString = scriptProperties.getProperty(PROP_TOKEN_LIST);
    if (tokenListString) {
      var pairs = tokenListString.split(',');
      for (var i = 0; i < pairs.length; i++) {
        var keyValue = pairs[i].trim().split(':');
        if (keyValue.length === 2) {
          const key = keyValue[0].trim();
          const value = keyValue[1].trim();
          if (key && value) tokens[key] = value;
        }
      }
    }
  }

  // --- Parse request (supports form or JSON) and headers ---
  var headers = (e && e.headers) ? e.headers : {};
  var requestToken = null;
  var notificationSource = null;
  var status = null;
  var notificationMsg = null;

  // If JSON body
  if (e && e.postData && e.postData.type && e.postData.type.indexOf('application/json') !== -1) {
    try {
      var payload = JSON.parse(e.postData.contents || '{}');
      requestToken = payload.token || null;
      notificationSource = payload.notification_token_source || payload.source || null;
      status = payload.status || null;
      notificationMsg = payload.notification_msg || payload.message || null;
    } catch (err) {
      return jsonResponse(false, "Invalid JSON payload: " + err);
    }
  } else {
    // form-encoded
    requestToken = (e && e.parameter) ? e.parameter.token : null;
    notificationSource = (e && e.parameter) ? e.parameter.notification_token_source : null;
    status = (e && e.parameter) ? e.parameter.status : null;
    notificationMsg = (e && e.parameter) ? e.parameter.notification_msg : null;
  }

  // headers override if provided
  if (!requestToken && headers['authorization']) {
    var auth = headers['authorization'];
    if (auth.indexOf('Bearer ') === 0) requestToken = auth.substring(7).trim(); else requestToken = auth;
  }
  if (!notificationSource && headers['x-notification-token-source']) {
    notificationSource = headers['x-notification-token-source'];
  }
  if (!requestToken || !notificationSource) {
    return jsonResponse(false, "Missing 'token' or 'notification_token_source' parameter.");
  }
  var storedToken = tokens[notificationSource];
  if (!storedToken || requestToken !== storedToken) {
    Logger.log("Invalid token attempt for source: " + notificationSource + " at " + new Date().toISOString());
    // Track invalid attempts and alert owner if threshold exceeded
    try {
      var invalidKey = PROP_INVALID_PREFIX + notificationSource;
      var invalidJson = scriptProperties.getProperty(invalidKey);
      var currentTime = Math.floor(Date.now() / 1000);
      var invalidData = invalidJson ? JSON.parse(invalidJson) : {count: 0, first: currentTime};
      if (currentTime - invalidData.first > BRUTE_FORCE_WINDOW_SECONDS) {
        invalidData = {count: 0, first: currentTime};
      }
      invalidData.count = (invalidData.count || 0) + 1;
      scriptProperties.setProperty(invalidKey, JSON.stringify(invalidData));
      if (invalidData.count >= BRUTE_FORCE_THRESHOLD) {
        var ownerEmail = scriptProperties.getProperty(PROP_RECIPIENT) || Session.getEffectiveUser().getEmail();
        var alertSubject = 'Alert: Possible brute-force on notification endpoint for ' + notificationSource;
        var alertBody = 'Detected ' + invalidData.count + ' invalid token attempts for source "' + notificationSource + '" since ' + new Date(invalidData.first * 1000).toISOString() + '. ' +
          'Request headers: ' + JSON.stringify(headers || {}) + '\nIP/forwarded info (if any): ' + (headers['x-forwarded-for'] || headers['x-appengine-user-ip'] || 'unknown');
        MailApp.sendEmail(ownerEmail, alertSubject, alertBody);
        // reset counter after alert
        scriptProperties.setProperty(invalidKey, JSON.stringify({count: 0, first: currentTime}));
      }
    } catch (err) {
      Logger.log('Error tracking invalid token attempts: ' + err);
    }
    return jsonResponse(false, "Invalid token for the provided source.");
  }

  // --- Rate Limiting with Lock Service ---
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    Logger.log("Failed to acquire lock for source: " + notificationSource + " at " + new Date().toISOString());
    return jsonResponse(false, "Could not acquire lock for rate limiting. Please try again later.");
  }

  try {
    var lastUsedTimestampKey = PROP_LAST_USED_PREFIX + notificationSource;
    var lastUsedTimestamp = Number(scriptProperties.getProperty(lastUsedTimestampKey) || "0");
    var currentTime = Math.floor(Date.now() / 1000);

    if (currentTime - lastUsedTimestamp < tokenUseIntervalSeconds) {
      var timeLeft = tokenUseIntervalSeconds - (currentTime - lastUsedTimestamp);
      return jsonResponse(false, "Rate limit exceeded. Please wait " + timeLeft + " more seconds.", {retry_after: timeLeft});
    }

    // --- Parameter Validation ---
    if (!status || !notificationMsg) {
      return jsonResponse(false, "Missing 'status' or 'notification_msg' parameter.");
    }
    if (notificationMsg.length > MAX_MSG_LENGTH) {
      return jsonResponse(false, "'notification_msg' exceeds the maximum length of " + MAX_MSG_LENGTH + " characters.");
    }

    // --- Notification Logic ---
    var recipient = scriptProperties.getProperty(PROP_RECIPIENT) || Session.getEffectiveUser().getEmail();
    var subject = 'Notification from ' + notificationSource + ': ' + status;
    var body = notificationMsg;

    try {
      MailApp.sendEmail(recipient, subject, body);
      // Update the last used timestamp
      scriptProperties.setProperty(lastUsedTimestampKey, currentTime.toString()); // Store as string explicitly
      // Reset invalid attempt counter on success
      try {
        scriptProperties.setProperty(PROP_INVALID_PREFIX + notificationSource, JSON.stringify({count: 0, first: currentTime}));
      } catch (err) {
        Logger.log('Error resetting invalid counter: ' + err);
      }
      return jsonResponse(true, 'Notification sent successfully', {source: notificationSource, status: status});
    } catch (error) {
      Logger.log('Error sending notification for source ' + notificationSource + ': ' + error);
      return jsonResponse(false, 'Error sending notification: ' + error);
    }
  } finally {
    lock.releaseLock();
  }
}

// Helper: return consistent JSON responses
function jsonResponse(ok, message, extra) {
  var payload = {ok: !!ok, message: message};
  if (extra && typeof extra === 'object') {
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
  }
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
