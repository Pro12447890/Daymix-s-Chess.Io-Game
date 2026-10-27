# Домен daymix-chess.strangled.net

## 1. DNS в FreeDNS

Правильный вариант — **CNAME**:

| Поле | Значение |
|---|---|
| Type | `CNAME` |
| Subdomain | `daymix-chess` |
| Domain | `strangled.net` |
| Destination | `pro12447890.github.io` |

Если FreeDNS не даёт CNAME — используйте **A**-записи на IP GitHub Pages
(по одной записи на каждый IP):

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

IPv6 (AAAA): `2606:50c0:8000::153`, `2606:50c0:8001::153`,
`2606:50c0:8002::153`, `2606:50c0:8003::153`.

**Важно:** `178.236.246.241` с картинки — не GitHub Pages. С таким A-адресом
домен будет вести не туда, и HTTPS не выпустится.

## 2. Проверка DNS

```powershell
node domain/check.mjs
```

Скрипт ждёт, пока `daymix-chess.strangled.net` начнёт указывать на
`pro12447890.github.io` или на IP GitHub Pages.

## 3. Включение домена на GitHub Pages

Только после того, как DNS заработал:

1. Скопировать `domain/CNAME` в корень репозитория (файл `CNAME`, одна строка).
2. Или: Settings → Pages → Custom domain → `daymix-chess.strangled.net` → Save.
3. Дождаться сертификата и включить **Enforce HTTPS**.

Пока DNS не готов, корневой `CNAME` добавлять нельзя: GitHub начнёт
перенаправлять `pro12447890.github.io/...` на неработающий домен.
