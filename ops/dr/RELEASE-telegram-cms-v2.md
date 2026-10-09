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
