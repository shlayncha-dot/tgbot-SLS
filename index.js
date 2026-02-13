export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Bot is running");
    }

    const TOKEN = env.TELEGRAM_TOKEN;
    const update = await request.json();

    const chatId =
      update.message?.chat?.id ||
      update.callback_query?.message?.chat?.id;

    if (!chatId) {
      return new Response("OK");
    }

    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "Прийнято"
      })
    });

    return new Response("OK");
  }
};
