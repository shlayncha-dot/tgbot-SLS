const TELEGRAM_API = "https://api.telegram.org";

const verifiedUsers = new Set();

function telegramRequest(token, method, payload = {}) {
  return fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function sendMessage(token, chatId, text, replyMarkup) {
  await telegramRequest(token, "sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup
  });
}

function startKeyboard() {
  return {
    keyboard: [[{ text: "START" }]],
    resize_keyboard: true
  };
}

function verificationKeyboard() {
  return {
    keyboard: [[{ text: "Поделиться номером телефона", request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true
  };
}

function menuKeyboard() {
  return {
    keyboard: [[{ text: "Orders" }, { text: "My Jobs" }]],
    resize_keyboard: true
  };
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          ok: true,
          message: "Telegram bot is running",
          configured: { telegramToken: Boolean(env.TELEGRAM_TOKEN) }
        }, null, 2),
        { headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    if (!env.TELEGRAM_TOKEN) {
      return new Response("TELEGRAM_TOKEN is not configured", { status: 500 });
    }

    const update = await request.json();
    const message = update?.message;
    const chatId = message?.chat?.id;
    const userId = message?.from?.id;

    if (!chatId || !userId) {
      return new Response("OK");
    }

    const text = message?.text?.trim();

    if (text === "/start") {
      await sendMessage(
        env.TELEGRAM_TOKEN,
        chatId,
        "Нажмите START, чтобы продолжить.",
        startKeyboard()
      );
      return new Response("OK");
    }

    if (text === "START") {
      if (verifiedUsers.has(userId)) {
        await sendMessage(
          env.TELEGRAM_TOKEN,
          chatId,
          "Вы уже верифицированы. Открываю меню.",
          menuKeyboard()
        );
      } else {
        const fullName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ");
        await sendMessage(
          env.TELEGRAM_TOKEN,
          chatId,
          `Верификация: ${fullName || "Имя из профиля"}. Поделитесь номером телефона кнопкой ниже.`,
          verificationKeyboard()
        );
      }
      return new Response("OK");
    }

    if (message?.contact?.phone_number) {
      verifiedUsers.add(userId);
      await sendMessage(
        env.TELEGRAM_TOKEN,
        chatId,
        "Верификация успешно завершена ✅\nДоступно меню:",
        menuKeyboard()
      );
      return new Response("OK");
    }

    if (verifiedUsers.has(userId) && (text === "Orders" || text === "My Jobs")) {
      await sendMessage(env.TELEGRAM_TOKEN, chatId, `Вы выбрали: ${text}`, menuKeyboard());
      return new Response("OK");
    }

    if (!verifiedUsers.has(userId)) {
      await sendMessage(
        env.TELEGRAM_TOKEN,
        chatId,
        "Сначала нажмите START и пройдите верификацию.",
        startKeyboard()
      );
    } else {
      await sendMessage(env.TELEGRAM_TOKEN, chatId, "Выберите пункт меню.", menuKeyboard());
    }

    return new Response("OK");
  }
};
