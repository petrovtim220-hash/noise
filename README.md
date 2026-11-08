# NOISE

Загрузите содержимое этой папки в корень GitHub-репозитория. Render запускает сервис командами `npm install` и `npm start`.

## SoundCloud custom player

NOISE использует собственный HTML audio-плеер и официальный SoundCloud API. Он воспроизводит только полные потоки, помеченные API как `playable` и найденные на заданном профиле артиста. Превью, пользовательские ремиксы и заблокированные треки не подменяются.

Добавьте в Render → ваш Web Service → Environment два секрета: `SOUNDCLOUD_CLIENT_ID` и `SOUNDCLOUD_CLIENT_SECRET`. Для создания API-ключей SoundCloud сейчас требует подписку Artist Pro. Не публикуйте Client Secret в GitHub или браузерном коде.

После добавления переменных Render пересоберёт сервис. Если песня недоступна через API, NOISE сообщит об этом и не запустит другой аудиофайл.

## Listening rooms

Комнаты синхронизируются по WebSocket в этом же сервисе Render. Бесплатный экземпляр Render может засыпать после периода бездействия.
