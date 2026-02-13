# tgbot-SLS

Минимальный Telegram webhook-бот на Cloudflare Workers.

## Что умеет
- Показывает кнопку **«Верификация»**.
- После нажатия просит подтверждение (**«Подтверждаю»**).
- После подтверждения запрашивает контакт через кнопку `request_contact`.
- После контакта просит отправить имя отдельным сообщением.
- Возвращает сообщение об успешном завершении верификации.

## Переменные окружения
- `TELEGRAM_TOKEN` — токен вашего Telegram-бота.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — email сервисного аккаунта Google Cloud (например, `bot-writer@project.iam.gserviceaccount.com`).
- `GOOGLE_PRIVATE_KEY` — приватный ключ сервисного аккаунта (PEM).
- `GOOGLE_SHEET_ID` — id таблицы (по умолчанию уже установлен `1reypZsOCUz8nlsvi46B_jbbd9QXjTKRCnChK-jfYBmQ`).
- `GOOGLE_SHEET_RANGE` — диапазон для записи (по умолчанию `'Set'!A:F`).

## Что теперь пишется в Google Sheets
После шага с именем бот добавляет новую строку во вкладку `Set`:
1. Время в UTC (`ISO` формат)
2. `chat_id`
3. username (`@username`)
4. `from.id`
5. Телефон
6. Имя

> Важно: сервисному аккаунту нужно выдать доступ к таблице через **Share** в Google Sheets, иначе запись будет падать по правам.
