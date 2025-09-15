/**
 * test.gs - simple test harness for the notification-service Apps Script
 * These functions simulate POST requests to doPost(e) using form-encoded and JSON payloads.
 * Run from the Apps Script editor to validate basic behavior.
 */

function _makeEventFromForm(params, headers) {
  return {
    parameter: params || {},
    parameters: params || {},
    postData: {type: 'application/x-www-form-urlencoded', contents: ''},
    headers: headers || {}
  };
}

function _makeEventFromJson(obj, headers) {
  return {
    parameter: {},
    parameters: {},
    postData: {type: 'application/json', contents: JSON.stringify(obj)},
    headers: headers || {}
  };
}

function test_form_success() {
  var scriptProperties = PropertiesService.getScriptProperties();
  // ensure TEST token exists as TOKEN_testsrc
  scriptProperties.setProperty('TOKEN_testsrc', 'testtoken123');
  scriptProperties.setProperty('NOTIFICATION_RECIPIENT', Session.getEffectiveUser().getEmail());

  var e = _makeEventFromForm({
    token: 'testtoken123',
    notification_token_source: 'testsrc',
    status: 'OK',
    notification_msg: 'Test message from form'
  });
  var res = doPost(e);
  Logger.log('test_form_success => ' + res.getContent());
}

function test_json_success() {
  var scriptProperties = PropertiesService.getScriptProperties();
  scriptProperties.setProperty('TOKEN_jsonsrc', 'jsontoken456');
  scriptProperties.setProperty('NOTIFICATION_RECIPIENT', Session.getEffectiveUser().getEmail());

  var payload = {
    token: 'jsontoken456',
    notification_token_source: 'jsonsrc',
    status: 'ALERT',
    notification_msg: 'Test message from JSON'
  };
  var e = _makeEventFromJson(payload);
  var res = doPost(e);
  Logger.log('test_json_success => ' + res.getContent());
}

function test_invalid_token_and_bruteforce() {
  var scriptProperties = PropertiesService.getScriptProperties();
  scriptProperties.setProperty('TOKEN_bruteforce', 'correcttoken');
  scriptProperties.setProperty('NOTIFICATION_RECIPIENT', Session.getEffectiveUser().getEmail());

  for (var i = 0; i < 6; i++) {
    var e = _makeEventFromForm({
      token: 'wrongtoken',
      notification_token_source: 'bruteforce',
      status: 'X',
      notification_msg: 'bad'
    }, { 'x-forwarded-for': '1.2.3.' + i });
    var res = doPost(e);
    Logger.log('attempt ' + i + ' => ' + res.getContent());
  }
}
