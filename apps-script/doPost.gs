function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var payload = JSON.parse(raw);
    var values = payload.values || [];

    if (!Array.isArray(values) || values.length === 0) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: 'values array is required' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Set');

    if (!sheet) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "Sheet 'Set' not found" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    sheet.appendRow(values);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(error) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
