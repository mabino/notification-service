// --- Constants ---
const PROP_INTERVAL_SECONDS = "NOTIFICATION_INTERVAL_SECONDS";
const PROP_TOKEN_LIST = "TOKEN_LIST";
const PROP_LAST_USED_PREFIX = "last_used_";
const DEFAULT_INTERVAL_SECONDS = "60";
const MAX_MSG_LENGTH = 255;
const LOCK_TIMEOUT_MS = 5000;

function doPost(e) {
  // --- Configuration ---
  var scriptProperties = PropertiesService.getScriptProperties();
  // Use Number() for consistency
  var tokenUseIntervalSeconds = Number(scriptProperties.getProperty(PROP_INTERVAL_SECONDS) || DEFAULT_INTERVAL_SECONDS);
  var tokenListString = scriptProperties.getProperty(PROP_TOKEN_LIST);
  var tokens = {};
  if (tokenListString) {
    var pairs = tokenListString.split(',');
    for (var i = 0; i < pairs.length; i++) {
      var keyValue = pairs[i].trim().split(':');
      if (keyValue.length === 2) {
        const key = keyValue[0].trim();
        const value = keyValue[1].trim();
        // Add check for empty key/value after trim
        if (key && value) {
           tokens[key] = value;
        }
      }
    }
  }

  // --- Security Checks ---
  var requestToken = e.parameter.token;
  var notificationSource = e.parameter.notification_token_source;
  if (!requestToken || !notificationSource) {
    return ContentService.createTextOutput("Error: Missing 'token' or 'notification_token_source' parameter.").setMimeType(ContentService.MimeType.TEXT);
  }
  var storedToken = tokens[notificationSource];
  if (!storedToken || requestToken !== storedToken) {
    // Consider logging this attempt for security monitoring?
    // Logger.log("Invalid token attempt from source: " + notificationSource);
    return ContentService.createTextOutput("Error: Invalid token for the provided source.").setMimeType(ContentService.MimeType.TEXT);
  }

  // --- Rate Limiting with Lock Service ---
  var lock = LockService.getScriptLock();
  // Use constant for timeout
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    // Log this potentially, indicates high contention or long-running process
    // Logger.log("Failed to acquire lock for source: " + notificationSource);
    return ContentService.createTextOutput("Error: Could not acquire lock for rate limiting. Please try again later.").setMimeType(ContentService.MimeType.TEXT);
  }

  try {
    var lastUsedTimestampKey = PROP_LAST_USED_PREFIX + notificationSource;
    // Already correctly using Number() here from previous fix
    var lastUsedTimestamp = Number(scriptProperties.getProperty(lastUsedTimestampKey) || "0");
    var currentTime = Math.floor(Date.now() / 1000);

    if (currentTime - lastUsedTimestamp < tokenUseIntervalSeconds) {
      var timeLeft = tokenUseIntervalSeconds - (currentTime - lastUsedTimestamp);
      return ContentService.createTextOutput("Rate limit exceeded. Please wait " + timeLeft + " more seconds.").setMimeType(ContentService.MimeType.TEXT);
    }

    // --- Parameter Validation ---
    var status = e.parameter.status;
    var notificationMsg = e.parameter.notification_msg;
    if (!status || !notificationMsg) {
      return ContentService.createTextOutput("Error: Missing 'status' or 'notification_msg' parameter.").setMimeType(ContentService.MimeType.TEXT);
    }
    // Use constant for length check
    if (notificationMsg.length > MAX_MSG_LENGTH) {
      return ContentService.createTextOutput(`Error: 'notification_msg' exceeds the maximum length of ${MAX_MSG_LENGTH} characters.`).setMimeType(ContentService.MimeType.TEXT);
    }

    // --- Notification Logic ---
    // Consider making recipient configurable via Script Properties?
    var recipient = Session.getEffectiveUser().getEmail();
    var subject = `Notification from ${notificationSource}: ${status}`; // Template literal
    var body = notificationMsg;

    try {
      MailApp.sendEmail(recipient, subject, body);
      // Update the last used timestamp
      scriptProperties.setProperty(lastUsedTimestampKey, currentTime.toString()); // Store as string explicitly
      return ContentService.createTextOutput(`Notification sent successfully from: ${notificationSource} with status: ${status}`).setMimeType(ContentService.MimeType.TEXT); // Template literal
    } catch (error) {
      Logger.log("Error sending notification for source " + notificationSource + ": " + error); // Log the actual error
      return ContentService.createTextOutput("Error sending notification: " + error).setMimeType(ContentService.MimeType.TEXT);
    }
  } finally {
    lock.releaseLock();
  }
}
