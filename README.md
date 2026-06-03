# RUSFAR Dashboard

Дашборд для мониторинга индексов RUSFAR (биржевой денежный рынок МосБиржи).

## Структура

```
rusfar-dashboard/
├── api/
│   └── rusfar.js        ← Serverless-функция: прокси к MOEX ISS API
├── public/
│   └── index.html       ← Весь фронтенд (HTML + CSS + JS в одном файле)
└── vercel.json          ← Конфигурация роутинга
```

## Деплой на Vercel (5 минут)

### 1. Загрузи проект на GitHub
- Зайди на github.com → New repository → назови `rusfar-dashboard`
- Загрузи все файлы (перетащи папку или через Upload files)

### 2. Задеплой на Vercel
- Зайди на vercel.com → Continue with GitHub
- Import → выбери репозиторий `rusfar-dashboard`
- Нажми **Deploy** (настройки менять не нужно)

### 3. Готово
- Vercel даст тебе URL вида `rusfar-dashboard.vercel.app`
- Дашборд будет грузить живые данные с MOEX каждые 60 секунд

## Как это работает

```
Браузер → /api/rusfar (Vercel) → iss.moex.com → JSON → Браузер
```

Серверная функция `api/rusfar.js` делает запрос к MOEX от имени сервера
(без CORS-ограничений браузера) и отдаёт данные фронтенду.

## Данные

- **RUSFARREALTIME o/n** — индикативное значение в течение сессии
- **RUSFAR o/n** — дневной фикс в 12:30 МСК
- **RUSFAR 1W / 2W / 1M / 3M** — фиксированные значения по срокам
- Обновление: каждые 60 секунд
- Источник: `iss.moex.com` (бесплатный публичный API)
