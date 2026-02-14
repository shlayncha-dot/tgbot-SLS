function doPost() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, message: 'Not used in current bot version' }))
    .setMimeType(ContentService.MimeType.JSON);
}
