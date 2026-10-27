# Telegram CMS V2 — release candidate runbook

Read-only Telegram admin panel for `@labote_cosmetic_bot` on the ZeroHour PRIMARY
(`vialabote-dr`). Baseline (production before V2): **7da4097**, local tag
`telegram-cms-v1-baseline-7da4097`.

## What changes

| Area | V2 |
|---|---|
| Bot commands | `/start`, `/menu`, «меню» → main menu; `/help`, «помощь» → help |
| Menu | 📦 Товары · 🛒 Заказы · 🧪 Составы INCI · 📊 Статистика · ⚠️ Проблемы каталога · ⚙️ Настройки · 📉 Остатки |
| Writes via Telegram | none — `isTelegramMutationsEnabled()` is `false` in code; `TELEGRAM_CMS_MUTATIONS` is ignored |
| Access | ADMIN by numeric Telegram user id; private chats only (groups: silence); others: «не привязан» / «Нет доступа» |
| Orders screen | number, date, status, total, items, city — no phone / e-mail / name / address |
| Polling bridge | per-request timeouts; duplicate-safe retries; handled-update dedup persisted in `StateDirectory`; callback buttons acknowledged |
| Ops | `vm-site2-release.sh` adds `StateDirectory=` drop-in to the installed poller unit before restarting it |

Not changed: DB schema (no migration), nginx / limited mode, `app.env`, token, secret,
SITE_1, DNS, edge, WireGuard, PostgreSQL.

## Verification done before release

- ZeroHour CI (official `scripts/ci/zerohour-ci.sh`, fed from a local bundle): 297/297
  tests, typecheck, catalog parity 13/13, build — PASS.
- Runtime e2e on the built app: storefront pages + favicon 200, 13 products; the real
  poller process against a fake Bot API: 502 retried, updates in order, menu/help, five
  screens edit + acknowledge, stranger refused, group silent, price change refused,
  duplicate delivery skipped, state file persisted, DB fingerprint identical, SIGTERM clean.

## Deploy (needs the owner's go-ahead: push + root)

1. Push the branch; run ZeroHour CI on the SHA (`git show <sha>:scripts/ci/zerohour-ci.sh | ssh zerohour-via-prod "bash -s -- <sha>"`).
2. Build the bundle on ZeroHour: `bash ~/ci/vialabote-shop/build-site2-bundle.sh <sha>`.
3. Deliver `app-<sha7>.tar.gz` (+ `.sha256`, `READY`) to the DR inbox via `dr-ingest`, and
   copy `ops/dr/vm-site2-release.sh` + `ops/dr/vm-deploy-release.sh` from that commit to
   `/home/vladmin/vialabote-site2-<sha7>/`.
4. Owner (root on the VM):
   ```
   ssh -t -o IdentitiesOnly=yes -i ~/.ssh/vialabote_dr_ed25519 -J zerohour-via-prod vladmin@192.168.122.211 \
     'sudo bash /home/vladmin/vialabote-site2-<sha7>/vm-site2-release.sh deploy <sha7>'
   ```
   It remembers 7da4097, installs the release, adds the poller `StateDirectory` drop-in,
   restarts SITE_2 and the poller (bot pauses a few seconds; updates wait in Telegram),
   runs the storefront/limited-mode/webhook/poller checks and rolls back by itself if the
   shop or the catalog check fails.
5. Smoke in Telegram from the ADMIN account: `/start` → each menu button; `/help`;
   `цена <товар> 1` must answer «отключены».

## Rollback

```
ssh -t -o IdentitiesOnly=yes -i ~/.ssh/vialabote_dr_ed25519 -J zerohour-via-prod vladmin@192.168.122.211 \
  'sudo bash /home/vladmin/vialabote-site2-<sha7>/vm-site2-release.sh rollback'
```
Switches `current` back to 7da4097 and restarts SITE_2 + the poller (the V1 bridge in
7da4097 ignores `STATE_DIRECTORY`; the drop-in is harmless). No DB or Telegram state to
undo: V2 writes nothing, the webhook stays deleted, polling continues.

## V2.1 — owner edits (stock, product cards) and full stats

Added on top of V2 (branch `claude/telegram-admin-bot`):

| Area | V2.1 |
|---|---|
| Access | `TELEGRAM_ADMIN_IDS` (numeric ids, comma-separated) in `app.env`. Set: only these ids see the panel. Empty: read-only for ADMIN linked in DB (as V2), **no writes** |
| Writes | `TELEGRAM_WRITES_ENABLED_IN_CODE = true` in `src/lib/telegram/config.ts`; effective only with a non-empty `TELEGRAM_ADMIN_IDS`, id in it and linked to an ADMIN user. `TELEGRAM_CMS_MUTATIONS` is still ignored |
| Stock | product -> +/-1, +/-10 or a typed number (`12`, `+5`, `-3`) -> «было → станет» -> Подтвердить. Writes `Product.stock` + `StockChangeLog` + `AuditLog` in one transaction |
| Cards | title, price (rubles), description, INCI, main photo (square ≥1200 px, validated before the preview), visibility (published / draft / archived) — each with a preview and «Подтвердить» via `PendingConfirmation` |
| Stats | day / week / month buttons: revenue (+% vs previous period), orders, paid, average check, top-5 products, sparkline, order statuses, stock units, out / low / deficit (stock lasts < 7 days at the period's pace) |
| DB | **migration** `prisma/migrations/20261027000000_stock_change_log` (additive: new table `StockChangeLog`) |

Order (owner's go-ahead for each step):
1. Back up the DB, then apply the migration on the VM (`prisma migrate deploy` from the release, or the SQL file with `psql`). Until it is applied, a stock confirmation fails with an error and **does not** change the stock (the log write is in the same transaction).
2. Add `TELEGRAM_ADMIN_IDS=<owner numeric id>` to `/etc/vialabote-shop/app.env` (the id: send `/start` to @userinfobot, or take `from=` from the poller log).
3. Deploy as above (`vm-site2-release.sh deploy <sha7>`) — both the app and the poller must be the V2 versions (V1 bridge never sends `answerCallbackQuery`).
4. Smoke from the owner account: every menu button; Статистика -> День/Неделя/Месяц; Остатки -> товар -> +1 -> Применить -> Отмена (nothing written); one real stock change and its `StockChangeLog` row; from another account: «Нет доступа».

Rollback: as above; the `StockChangeLog` table can stay (nothing reads it in 7da4097). To make the bot read-only again without a rollback: remove `TELEGRAM_ADMIN_IDS` (then read access falls back to ADMIN in DB) and restart SITE_2.
