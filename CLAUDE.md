# English Words — Obsidian Plugin

## Что это
Obsidian-плагин для перевода английских слов через GigaChat API (Сбер). Пользователь вводит слово через Command Palette, получает перевод, IPA-транскрипцию, произношение кириллицей и 3 примера из повседневной жизни. Результат дописывается в файл-словарь в vault.

## Стек
- TypeScript, esbuild
- Obsidian Plugin API (Modal, SettingTab, Vault API)
- GigaChat REST API (OAuth + chat/completions)
- Node.js `https` модуль (вместо requestUrl — для обхода SSL)

## Структура
- `src/main.ts` — вся логика: Plugin, Modal, SettingTab, GigaChat API, запись в vault
- `manifest.json` — метаданные плагина для Obsidian
- `esbuild.config.mjs` — сборка в `main.js`

## Команды
- `npm install` — установка зависимостей
- `npm run build` — сборка production (`main.js`)
- `npm run dev` — сборка с watch-режимом

## Деплой
Публикуется на GitHub (`MotionP/obsidian-english-words`), устанавливается через BRAT. При обновлении:
1. `npm run build`
2. Закоммитить `main.js` + исходники
3. Запушить
4. Обновить release asset `main.js` на GitHub

## Важные детали
- GigaChat API требует `rejectUnauthorized: false` для SSL — используется Node.js `https` вместо Obsidian `requestUrl`
- OAuth endpoint: `https://ngw.devices.sberbank.ru:9443/api/v2/oauth`
- Chat endpoint: `https://gigachat.devices.sberbank.ru/api/v1/chat/completions`
- Ответ LLM парсится как plain text (key: value формат), не JSON
- Настройки хранятся в Obsidian (SettingTab): GigaChat credentials и путь к файлу-словарю
