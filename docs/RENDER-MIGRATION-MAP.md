# Render migration mapping

Decision recorded November 22, 2026 (America/Chicago).

| Item | Mapping |
| --- | --- |
| Repository | `Paypal_Portal` |
| Reviewed source | [`20c502f56ed4`](https://github.com/estibancreations-svg/Paypal_Portal/commit/20c502f56ed40ae22ec5409c4fd3b200711d030c) |
| Placement | Existing Render service |
| Repository action | Render inventory already shows this repository on a main-tracking Node web service. Confirm actual health and ownership before any future changes. |
| Hosting decision | Render is the application host for approved runtimes. |
| Data and identity | Retain each existing Supabase binding for Postgres, Auth and Storage where applicable. Preserve each system's access and data boundary. |

## Release evidence

The verified sample contains 27 failed Vercel preview checks across nine GrantOS commit SHAs (three linked projects per SHA), one intervening commit with three successful previews, and a separately observed production availability block. These checks show two documented failure episodes around a temporary recovery. The sample establishes a lower bound on checks, with no claim about total historical incidents.

The [enterprise decision and forensic evidence](https://github.com/estibancreations-svg/Master-System-Buildout/blob/docs/render-migration-2026-11-22/docs/forensics/2026-11-22-render-migration.md) records the exact SHAs, preview results, production effect, migration waves and rollback gate. [GrantOS PR #66](https://github.com/estibancreations-svg/MASTER_CEO_DASHBOARD/pull/66) separately records invariant test failures and uncertified production status.

## Cutover criteria

For a confirmed hosted application, record the Render service, source SHA, build and health checks, data binding, access tests, verified target domain and rollback procedure. Promote after applicable GitHub Quality Gates and runtime checks pass on the exact candidate. Documentation-only repositories carry the mapping in GitHub.
