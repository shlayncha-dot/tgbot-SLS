const TELEGRAM_API = "https://api.telegram.org";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DEFAULT_SHEET_ID = "1reypZsOCUz8nlsvi46B_jbbd9QXjTKRCnChK-jfYBmQ";
const DEFAULT_SHEET_RANGE = "'Set'!A:F";
const BUILD_COUNTER = 2;

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
  const token = await getGoogleAccessToken(env);
  const spreadsheetId = env.GOOGLE_SHEET_ID || DEFAULT_SHEET_ID;
  const range = env.GOOGLE_SHEET_RANGE || DEFAULT_SHEET_RANGE;
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
      return new Response(`Bot is running. Build ${BUILD_COUNTER}`);
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

      await callTelegram(token, "sendMessage", {
        chat_id: chatId,
        text: `Имя получено: ${text}. Верификация завершена ✅`,
        reply_markup: {
          remove_keyboard: true
        }
      });

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
      } catch (error) {
        const diagnostic = formatGoogleSheetsError(error);
        console.error("Google Sheets append failed", error);
        await callTelegram(token, "sendMessage", {
          chat_id: chatId,
          text: `⚠️ ${diagnostic}`
        });
      }

      return new Response("OK");
    }

    await sendVerificationButton(token, chatId);

    return new Response("OK");
  }
};
