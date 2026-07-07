# Marketing Stats Service — Planning Doc

Status: **planning only.** Do not start building until Activations is fully migrated to its own repo and Thrift Fest is over. This service has no deadline; the event does.

## What it is

The third microservice in the Silver Glider ecosystem, behind the main app alongside Ticketing Core and Activations. It owns marketing analytics and outbound: subscriber lists, campaign stats, best-booth leads, call/hotline tracking, and the outbound Resend/Twilio marketing sends.

It is a **reporting and outbound layer** — it mostly reads data the other two services already produce, aggregates it, and sends campaigns. It should not own the source-of-truth for orders, tickets, or votes.

## Deployment shape (same pattern as Activations)

- **New GitHub repo** — e.g. `silver-glider-marketing`
- **New Railway service** in the same `honest-beauty` project
- **Shared Postgres** — the same database the other two services use
- Node.js + Express, CommonJS, `railway up` to deploy, `/health` endpoint with SHA — mirror the Activations setup exactly so the ops story is identical

## Database strategy: shared DB, own prefix

Everything today lives under `sg_` in one Postgres. Marketing Stats joins that same database with its **own** table prefix so ownership is legible:

| Prefix | Owner | Examples |
|--------|-------|----------|
| `sg_` (ticketing) | Ticketing Core | `sg_events`, `sg_orders`, `sg_tickets`, `sg_users` |
| `sg_activation*` | Activations | `sg_activations`, `sg_participants`, `sg_activation_votes`, `sg_activation_optins` |
| `mkt_` (new) | Marketing Stats | `mkt_campaigns`, `mkt_sends`, `mkt_leads`, `mkt_call_events` |

**Rule of ownership:** a service only writes to its own prefix. Marketing Stats *reads* `sg_*` tables (orders, subscribers, optins, votes) but never writes to them. That keeps the boundary clean without needing service-to-service APIs.

## What Marketing Stats reads from the shared DB

These already exist and are exactly the "marketing concerns that originate elsewhere" from the ecosystem diagram:

- `sg_activation_optins` — email opt-ins captured at activations (the SF concert picks list)
- `sg_users` / `sg_orders` — ticket buyers, for buyer-based campaigns and LTV
- `sg_activation_votes` + `sg_participants` — **Best Booth Leads**: vendors who competed, their contact info, how they performed. High-value B2B lead list.

## What Marketing Stats owns (writes to `mkt_*`)

- `mkt_campaigns` — a campaign definition (subject, body, audience query, channel)
- `mkt_sends` — one row per recipient per campaign (sent/opened/clicked/bounced) for stats
- `mkt_leads` — enriched/deduped lead records built from the reads above
- `mkt_call_events` — hotline / Twilio Voice tracking (from the diagram's "Hotline Tracking")

## First real feature when built

The **weekly Friday picks email** — currently listed as "still needed" in HANDOFF.md. It's the natural first job for this service: read `sg_activation_optins`, compose the 3-show email, send via Resend, and log each send in `mkt_sends` for open/click stats. That single feature justifies standing the service up.

## Open decisions for later

1. Does the outbound Resend sending move here entirely, or stay split (transactional in each service, marketing here)? Recommendation: transactional emails (booth confirmation, welcome) stay with the service that triggers them; *bulk campaigns* live here.
2. Admin UI — its own panel, or a tab in an existing admin? Lightest path: its own small admin, same JWT pattern as Activations.
3. Shared env vars — `DATABASE_URL`, `RESEND_API_KEY` reused; document them the same way the Activations handoff does.

## Migration order (when the time comes)

1. Finish Activations → own repo (Gabriel, in progress)
2. Run Thrift Fest
3. Create `silver-glider-marketing` repo + Railway service from this plan
4. Build the Friday picks email as the first feature
5. Layer in campaign stats and lead exports after
