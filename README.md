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

## Почему `TELEGRAM_TOKEN` «слетает» в Cloudflare (Variables and Secrets)
Чаще всего это не удаление секрета, а одна из типовых причин:

1. **Секрет добавлен не в то окружение** (`Preview` vs `Production`).
   Worker в проде не видит секрет, который задан только для preview.
2. **Деплой идёт в другой Worker/проект** (например, другое `name` или другой аккаунт в `wrangler`).
   В UI вы смотрите один сервис, а выкатываете другой.
3. **Перезапись переменных через конфиг/CI**.
   Если в пайплайне есть шаги, которые публикуют Worker без нужного секрета, новая версия запускается без него.

Рекомендуемый способ задавать токен:

```bash
wrangler secret put TELEGRAM_TOKEN
```

Проверка, что секрет действительно привязан к нужному сервису/окружению:

```bash
wrangler secret list
```

Если используете окружения, указывайте явно:

```bash
wrangler secret put TELEGRAM_TOKEN --env production
wrangler secret list --env production
```


## Безопасная настройка токена (рекомендуется)
Не размещайте токен бота прямо в `index.js` или в git-репозитории.

Для локальной разработки используйте файл `.dev.vars` (не коммитить):

```bash
TELEGRAM_TOKEN=ваш_токен
```

Для Cloudflare production задавайте секрет через Wrangler:

```bash
wrangler secret put TELEGRAM_TOKEN --env production
```

## Что теперь пишется в Google Sheets
После шага с именем бот добавляет новую строку во вкладку `Set`:
1. Время в UTC (`ISO` формат)
2. `chat_id`
3. username (`@username`)
4. `from.id`
5. Телефон
6. Имя

> Важно: сервисному аккаунту нужно выдать доступ к таблице через **Share** в Google Sheets, иначе запись будет падать по правам.
