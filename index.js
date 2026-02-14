const TELEGRAM_API = "https://api.telegram.org";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DEFAULT_SHEET_ID = "1reypZsOCUz8nlsvi46B_jbbd9QXjTKRCnChK-jfYBmQ";
const DEFAULT_SHEET_RANGE = "'Set'!A:F";
const BUILD_COUNTER = 2;

function getAppsScriptUrl(env) {
  return env.GOOGLE_APPS_SCRIPT_URL || env.GOOGLE_SCRIPT_URL || env.APPS_SCRIPT_URL || "";
}

function toBase64Url(input) {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return toBase64Url(binary);
}

function parsePhoneFromReplyText(replyText = "") {
  const match = replyText.match(/Телефон получен:\s*([^\.]+)/);
  return match ? match[1].trim() : "";
}

function buildVerificationButtonText() {
  return `Верификация ${BUILD_COUNTER}`;
}

function parseSheetUrl(url) {
  if (!url) {
    return { spreadsheetId: "", gid: "" };
  }

  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const gidMatch = url.match(/[?#&]gid=(\d+)/);

  return {
    spreadsheetId: idMatch?.[1] || "",
    gid: gidMatch?.[1] || ""
  };
}

function escapeSheetTitle(sheetTitle) {
  return sheetTitle.replace(/'/g, "''");
}

function formatGoogleSheetsError(error) {
  const message = String(error?.message || error || "Unknown error");

  if (message.includes("401") || message.includes("invalid_grant") || message.includes("invalid_client")) {
    return "Ошибка авторизации сервисного аккаунта (проверьте GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY).";
  }

  if (message.includes("403") || message.includes("permission")) {
    return "Нет доступа к Google Таблице (нужно выдать сервисному аккаунту доступ через Share).";
  }

  if (message.includes("404")) {
    return "Не найдены таблица/лист (проверьте GOOGLE_SHEET_ID и GOOGLE_SHEET_RANGE).";
  }

  if (message.includes("credentials are not configured")) {
    return "Не настроены GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY. Либо задайте их, либо используйте GOOGLE_APPS_SCRIPT_URL (или GOOGLE_SCRIPT_URL / APPS_SCRIPT_URL) для прямой записи через Apps Script.";
  }

  return `Не удалось записать в Google Таблицу: ${message}`;
}

async function importServiceAccountKey(privateKeyPem) {
  const sanitizedPem = privateKeyPem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const binaryDer = Uint8Array.from(atob(sanitizedPem), (char) => char.charCodeAt(0)).buffer;

  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );
}

async function getGoogleAccessToken(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new Error("Google service account credentials are not configured");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({
      iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3600
    })
  );

  const unsignedJwt = `${header}.${payload}`;
  const signingKey = await importServiceAccountKey(env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"));
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    signingKey,
    new TextEncoder().encode(unsignedJwt)
  );

  const assertion = `${unsignedJwt}.${arrayBufferToBase64Url(signature)}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }).toString()
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to get Google access token: ${response.status} ${details}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function appendVerificationToSheet(env, rowValues) {
  const appsScriptUrl = getAppsScriptUrl(env);

  if (appsScriptUrl) {
    const response = await fetch(appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: rowValues })
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Failed to append data via Apps Script: ${response.status} ${details}`);
    }

    return;
  }

  const token = await getGoogleAccessToken(env);
  const { spreadsheetId, range } = await resolveSheetTarget(env, token);
  const endpoint = `${GOOGLE_SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      majorDimension: "ROWS",
      values: [rowValues]
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to append data to Google Sheet: ${response.status} ${details}`);
  }
}

async function resolveSheetTarget(env, accessToken) {
  const parsedFromUrl = parseSheetUrl(env.GOOGLE_SHEET_URL || "");
  const spreadsheetId = env.GOOGLE_SHEET_ID || parsedFromUrl.spreadsheetId || DEFAULT_SHEET_ID;

  if (env.GOOGLE_SHEET_RANGE) {
    return { spreadsheetId, range: env.GOOGLE_SHEET_RANGE };
  }

  const gid = env.GOOGLE_SHEET_GID || parsedFromUrl.gid;

  if (!gid) {
    return { spreadsheetId, range: DEFAULT_SHEET_RANGE };
  }

  const metadataResponse = await fetch(
    `${GOOGLE_SHEETS_API}/${spreadsheetId}?fields=sheets(properties(sheetId,title))`,
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );

  if (!metadataResponse.ok) {
    const details = await metadataResponse.text();
    throw new Error(`Failed to resolve GOOGLE_SHEET_GID: ${metadataResponse.status} ${details}`);
  }

  const metadata = await metadataResponse.json();
  const targetSheet = metadata?.sheets?.find((sheet) => String(sheet?.properties?.sheetId) === String(gid));

  if (!targetSheet?.properties?.title) {
    throw new Error(`GOOGLE_SHEET_GID=${gid} does not exist in spreadsheet ${spreadsheetId}`);
  }

  const range = `'${escapeSheetTitle(targetSheet.properties.title)}'!A:F`;
  return { spreadsheetId, range };
}

async function callTelegram(token, method, payload) {
  return fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function sendVerificationButton(token, chatId, text = "Нажмите кнопку ниже для начала верификации") {
  return callTelegram(token, "sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: {
      inline_keyboard: [[{ text: buildVerificationButtonText(), callback_data: "verification_start" }]]
    }
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      const parsedSheetUrl = parseSheetUrl(env.GOOGLE_SHEET_URL || "");
      const configInfo = {
        status: "ok",
        build: BUILD_COUNTER,
        configured: {
          telegramToken: Boolean(env.TELEGRAM_TOKEN),
          appsScriptUrl: Boolean(getAppsScriptUrl(env)),
          serviceAccountEmail: Boolean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
          privateKey: Boolean(env.GOOGLE_PRIVATE_KEY),
          sheetId: env.GOOGLE_SHEET_ID || parsedSheetUrl.spreadsheetId || DEFAULT_SHEET_ID,
          sheetRange: env.GOOGLE_SHEET_RANGE || DEFAULT_SHEET_RANGE,
          sheetGid: env.GOOGLE_SHEET_GID || parsedSheetUrl.gid || null
        }
      };

      return new Response(JSON.stringify(configInfo, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    const token = env.TELEGRAM_TOKEN;

    if (!token) {
      return new Response("TELEGRAM_TOKEN is not configured", { status: 500 });
    }
    const update = await request.json();

    const message = update.message;
    const callbackQuery = update.callback_query;

    const chatId = message?.chat?.id || callbackQuery?.message?.chat?.id;

    if (!chatId) {
      return new Response("OK");
    }

    if (callbackQuery?.id) {
      await callTelegram(token, "answerCallbackQuery", {
        callback_query_id: callbackQuery.id
      });
    }

    if (callbackQuery?.data === "verification_start") {
      await callTelegram(token, "sendMessage", {
        chat_id: chatId,
        text: "Подтвердите, что хотите пройти верификацию.",
        reply_markup: {
          inline_keyboard: [[{ text: "Подтверждаю", callback_data: "verification_confirm" }]]
        }
      });
      return new Response("OK");
    }

    if (callbackQuery?.data === "verification_confirm") {
      await callTelegram(token, "sendMessage", {
        chat_id: chatId,
        text: "Отправьте ваш номер телефона кнопкой ниже, затем отправьте отдельным сообщением ваше имя.",
        reply_markup: {
          keyboard: [[{ text: "Отправить телефон", request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true
        }
      });
      return new Response("OK");
    }

    if (message?.contact?.phone_number) {
      await callTelegram(token, "sendMessage", {
        chat_id: chatId,
        text: `Телефон получен: ${message.contact.phone_number}. Теперь отправьте ваше имя ответом на это сообщение.`,
        reply_markup: {
          force_reply: true,
          selective: true
        }
      });
      return new Response("OK");
    }

    if (message?.text) {
      const text = message.text.trim();
      const isNameReply =
        Boolean(message.reply_to_message?.text) &&
        message.reply_to_message.text.includes("Теперь отправьте ваше имя");

      if (text === "/start") {
        await sendVerificationButton(token, chatId, `Привет${BUILD_COUNTER}! Для теста нажмите кнопку «Верификация».`);
        return new Response("OK");
      }

      if (!isNameReply) {
        await sendVerificationButton(token, chatId, `Для начала верификации нажмите кнопку ниже. Build ${BUILD_COUNTER}.`);
        return new Response("OK");
      }

      const phone = parsePhoneFromReplyText(message.reply_to_message?.text || "");
      const row = [
        new Date().toISOString(),
        String(chatId),
        message.from?.username ? `@${message.from.username}` : "",
        message.from?.id ? String(message.from.id) : "",
        phone,
        text
      ];

      try {
        await appendVerificationToSheet(env, row);
        await callTelegram(token, "sendMessage", {
          chat_id: chatId,
          text: `Имя получено: ${text}. Верификация завершена ✅`,
          reply_markup: {
            remove_keyboard: true
          }
        });
      } catch (error) {
        const diagnostic = formatGoogleSheetsError(error);
        console.error("Google Sheets append failed", error);
        await callTelegram(token, "sendMessage", {
          chat_id: chatId,
          text: `Имя получено: ${text}, но сохранить данные не удалось. ⚠️ ${diagnostic}`,
          reply_markup: {
            remove_keyboard: true
          }
        });
      }

      return new Response("OK");
    }

    await sendVerificationButton(token, chatId);

    return new Response("OK");
  }
};
