# tgbot-SLS

Минимальный Telegram webhook-бот на Cloudflare Workers.

## Что умеет
- Показывает кнопку **«Верификация»**.
- После нажатия просит подтверждение (**«Подтверждаю»**).
- После подтверждения запрашивает контакт через кнопку `request_contact`.
- После контакта просит отправить имя отдельным сообщением.
- Возвращает сообщение об успешном завершении верификации.
- Добавлен видимый счётчик версии в приветствии и тексте кнопки (`ПриветN`, `Верификация N`).
- При ошибке записи в Google Sheets бот отправляет пользователю диагностическое сообщение с причиной.

## Переменные окружения
- `TELEGRAM_TOKEN` — токен вашего Telegram-бота.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — email сервисного аккаунта Google Cloud (например, `bot-writer@project.iam.gserviceaccount.com`).
> Какую почту указывать: значение поля `client_email` из JSON-ключа сервисного аккаунта (обычно выглядит как `name@project-id.iam.gserviceaccount.com`).
- `GOOGLE_PRIVATE_KEY` — приватный ключ сервисного аккаунта (PEM).
- `GOOGLE_SHEET_ID` — id таблицы (по умолчанию уже установлен `1reypZsOCUz8nlsvi46B_jbbd9QXjTKRCnChK-jfYBmQ`).
- `GOOGLE_SHEET_RANGE` — диапазон для записи (по умолчанию `'Set'!A:F`).
- `GOOGLE_APPS_SCRIPT_URL` — (опционально) URL Web App из Google Apps Script для прямой записи без service account.
- `GOOGLE_SCRIPT_URL` / `APPS_SCRIPT_URL` — дополнительные алиасы для того же URL (если так удобнее в текущем окружении).

> `GOOGLE_SERVICE_ACCOUNT_EMAIL` и `GOOGLE_PRIVATE_KEY` нужны **только** если вы пишете напрямую в Google Sheets API.
> Если используете Apps Script URL (`GOOGLE_APPS_SCRIPT_URL` или алиасы), эти две переменные можно не задавать.

### Быстрая настройка, если видите ошибку про `GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY`

Есть два рабочих пути:

1. **Через service account** (Google Cloud):

```bash
wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
wrangler secret put GOOGLE_PRIVATE_KEY
```

> Для `GOOGLE_PRIVATE_KEY` вставляйте ключ целиком, включая строки
> `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----`.

2. **Через Apps Script** (без service account):

```bash
wrangler secret put GOOGLE_APPS_SCRIPT_URL
# либо можно задать алиас:
# wrangler secret put GOOGLE_SCRIPT_URL
```

Если задан любой из URL (`GOOGLE_APPS_SCRIPT_URL`, `GOOGLE_SCRIPT_URL`, `APPS_SCRIPT_URL`), бот пишет в таблицу через Web App и не требует
`GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY`.


## Альтернатива service account: запись через Google Apps Script
Если не хотите настраивать `GOOGLE_SERVICE_ACCOUNT_EMAIL` и `GOOGLE_PRIVATE_KEY`, можно писать в таблицу через Web App:

1. В Google Sheets откройте **Extensions → Apps Script**.
2. Вставьте скрипт:

```javascript
function doPost(e) {
  const payload = JSON.parse(e.postData.contents || '{}');
  const values = payload.values || [];

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Set');
  sheet.appendRow(values);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

3. Нажмите **Deploy → New deployment → Web app**.
4. `Execute as`: **Me**, `Who has access`: **Anyone** (или ограничьте по необходимости).
5. Скопируйте URL и сохраните как секрет/переменную `GOOGLE_APPS_SCRIPT_URL` (или `GOOGLE_SCRIPT_URL` / `APPS_SCRIPT_URL`) в Cloudflare Worker.

Когда задан любой из URL переменных (`GOOGLE_APPS_SCRIPT_URL`, `GOOGLE_SCRIPT_URL`, `APPS_SCRIPT_URL`), бот сначала пишет через Apps Script и не требует service account переменных.


> **Нужно ли писать скрипт в таблице?**
> - **Да, нужно**, если используете путь через `GOOGLE_APPS_SCRIPT_URL` / `GOOGLE_SCRIPT_URL` / `APPS_SCRIPT_URL`.
>   Тогда обязательно создаётся Apps Script (функция `doPost`) и публикуется как Web App.
> - **Нет, не нужно**, если используете `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` (прямая запись в Google Sheets API).

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
