const TELEGRAM_API = "https://api.telegram.org";
const BUILD_COUNTER = 5;

function getAppsScriptUrl(env) {
  return env.GOOGLE_APPS_SCRIPT_URL || env.GOOGLE_SCRIPT_URL || env.APPS_SCRIPT_URL || "";
}


function buildWebhookCandidate(request, env) {
  return (env.WEBHOOK_URL || `${new URL(request.url).origin}/`).trim();
}

function isAppsScriptWebhook(url) {
  return /script\.google\.com\/macros\//.test(url);
}

function parsePhoneFromReplyText(replyText = "") {
  const match = replyText.match(/Телефон получен:\s*([^\.]+)/);
  return match ? match[1].trim() : "";
}

function buildVerificationButtonText() {
  return `Верификация ${BUILD_COUNTER}`;
}

function formatSheetsError(error) {
  const message = String(error?.message || error || "Unknown error");

  if (message.includes("Apps Script URL is not configured")) {
    return "Не настроен GOOGLE_APPS_SCRIPT_URL (или алиасы GOOGLE_SCRIPT_URL / APPS_SCRIPT_URL).";
  }

  if (message.includes("Failed to append data via Apps Script")) {
    return "Google Apps Script вернул ошибку. Проверьте Deploy Web App и доступ 'Anyone'.";
  }

  return `Не удалось записать в Google Таблицу через Apps Script: ${message}`;
}

async function appendVerificationToSheet(env, rowValues) {
  const appsScriptUrl = getAppsScriptUrl(env);

  if (!appsScriptUrl) {
    throw new Error("Apps Script URL is not configured");
  }

  const response = await fetch(appsScriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values: rowValues })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to append data via Apps Script: ${response.status} ${details}`);
  }
}

async function callTelegram(token, method, payload) {
  return fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function callTelegramJson(token, method, payload = {}) {
  const response = await callTelegram(token, method, payload);
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data?.ok === false) {
    throw new Error(`Telegram API ${method} failed: ${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

async function getTelegramDiagnostics(token, expectedWebhookUrl) {
  const [me, webhookInfo] = await Promise.all([
    callTelegramJson(token, "getMe"),
    callTelegramJson(token, "getWebhookInfo")
  ]);

  const currentWebhookUrl = webhookInfo?.result?.url || "";

  return {
    bot: {
      id: me?.result?.id,
      username: me?.result?.username,
      can_join_groups: me?.result?.can_join_groups,
      supports_inline_queries: me?.result?.supports_inline_queries
    },
    webhook: {
      current: currentWebhookUrl,
      expected: expectedWebhookUrl,
      matchesExpected: Boolean(expectedWebhookUrl) && currentWebhookUrl === expectedWebhookUrl,
      pendingUpdates: webhookInfo?.result?.pending_update_count || 0,
      lastErrorDate: webhookInfo?.result?.last_error_date || null,
      lastErrorMessage: webhookInfo?.result?.last_error_message || null,
      maxConnections: webhookInfo?.result?.max_connections || null,
      hasCustomCertificate: Boolean(webhookInfo?.result?.has_custom_certificate),
      ipAddress: webhookInfo?.result?.ip_address || null
    }
  };
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
      const url = new URL(request.url);
      const action = url.searchParams.get("action");
      const token = env.TELEGRAM_TOKEN;
      const webhookUrl = buildWebhookCandidate(request, env);

      if (action === "webhook-info") {
        if (!token) {
          return new Response("TELEGRAM_TOKEN is not configured", { status: 500 });
        }

        try {
          const webhookInfo = await callTelegramJson(token, "getWebhookInfo");
          return new Response(JSON.stringify(webhookInfo, null, 2), {
            headers: { "Content-Type": "application/json; charset=utf-8" }
          });
        } catch (error) {
          return new Response(String(error?.message || error), { status: 500 });
        }
      }

      if (action === "set-webhook") {
        if (!token) {
          return new Response("TELEGRAM_TOKEN is not configured", { status: 500 });
        }

        if (!webhookUrl) {
          return new Response("WEBHOOK_URL is not configured", { status: 500 });
        }

        if (isAppsScriptWebhook(webhookUrl)) {
          return new Response("WEBHOOK_URL points to Google Apps Script. Use your Cloudflare Worker URL instead.", { status: 400 });
        }

        try {
          const setWebhookResult = await callTelegramJson(token, "setWebhook", {
            url: webhookUrl,
            drop_pending_updates: true
          });

          return new Response(JSON.stringify(setWebhookResult, null, 2), {
            headers: { "Content-Type": "application/json; charset=utf-8" }
          });
        } catch (error) {
          return new Response(String(error?.message || error), { status: 500 });
        }
      }

      if (action === "diagnostics") {
        if (!token) {
          return new Response("TELEGRAM_TOKEN is not configured", { status: 500 });
        }

        try {
          const diagnostics = await getTelegramDiagnostics(token, webhookUrl);
          return new Response(JSON.stringify(diagnostics, null, 2), {
            headers: { "Content-Type": "application/json; charset=utf-8" }
          });
        } catch (error) {
          return new Response(String(error?.message || error), { status: 500 });
        }
      }

      const configInfo = {
        status: "ok",
        build: BUILD_COUNTER,
        configured: {
          telegramToken: Boolean(env.TELEGRAM_TOKEN),
          appsScriptUrl: Boolean(getAppsScriptUrl(env)),
          webhookUrl: Boolean(webhookUrl)
        },
        notes: {
          setupMode: "Only Apps Script mode is supported",
          requiredSecrets: ["TELEGRAM_TOKEN", "GOOGLE_APPS_SCRIPT_URL"],
          diagnostics: {
            webhookInfo: "GET /?action=webhook-info",
            fullDiagnostics: "GET /?action=diagnostics",
            setWebhook: "GET /?action=set-webhook (uses WEBHOOK_URL or current worker URL)",
            webhookUrlHint: "WEBHOOK_URL must be your Worker URL, not script.google.com/macros"
          }
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
        await sendVerificationButton(token, chatId, `Привет! Для теста нажмите кнопку «Верификация». Build ${BUILD_COUNTER}.`);
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
        const diagnostic = formatSheetsError(error);
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
