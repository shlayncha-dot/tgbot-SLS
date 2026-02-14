function doPost(e) {
  const payload = JSON.parse(e.postData.contents || '{}');
  const values = payload.values || [];

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Set');

  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: "Sheet 'Set' not found" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  sheet.appendRow(values);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
