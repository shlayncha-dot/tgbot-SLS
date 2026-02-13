const TELEGRAM_API = "https://api.telegram.org";

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
      inline_keyboard: [[{ text: "Верификация", callback_data: "verification_start" }]]
    }
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Bot is running");
    }

    const token = env.TELEGRAM_TOKEN;
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
        text: `Телефон получен: ${message.contact.phone_number}. Теперь отправьте ваше имя.`
      });
      return new Response("OK");
    }

    if (message?.text) {
      const text = message.text.trim();

      if (text === "/start") {
        await sendVerificationButton(token, chatId, "Привет! Для теста нажмите кнопку «Верификация». ");
        return new Response("OK");
      }

      await callTelegram(token, "sendMessage", {
        chat_id: chatId,
        text: `Имя получено: ${text}. Верификация завершена ✅`,
        reply_markup: {
          remove_keyboard: true
        }
      });
      return new Response("OK");
    }

    await sendVerificationButton(token, chatId);

    return new Response("OK");
  }
};
