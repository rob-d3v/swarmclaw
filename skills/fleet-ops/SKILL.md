---
name: fleet-ops
description: "Operate a self-hosted Dokploy PaaS fleet from chat: list/inspect services, read deploy logs, and deploy/redeploy/stop/start containers via the Dokploy REST API. Also talk to a Hermes messaging-agent API and provision keys on an OmniRoute LLM router. Use when: (1) checking the status or logs of a deployed app, (2) deploying/redeploying/stopping/starting a service, (3) sending a command to a Hermes agent, (4) minting an OmniRoute API key. NOT for: building images locally, editing source, or DNS changes."
metadata:
  {
    "openclaw":
      {
        "emoji": "🛰️",
        "requires": { "bins": ["curl"], "env": ["DOKPLOY_API_BASE", "DOKPLOY_API_KEY"] },
      },
  }
---

# Fleet Ops Skill

Drive a self-hosted **Dokploy** control plane (and the apps it runs) over its REST
API with `curl`. All endpoints take the API key in an `x-api-key` header.

## Credentials (injected as env vars)

These are provided to the `execute` sandbox as credentials — never hard-code them.

| Env var | What |
|---------|------|
| `DOKPLOY_API_BASE` | Dokploy API base, e.g. `https://<host>/api` |
| `DOKPLOY_API_KEY` | Dokploy API key (sent as `x-api-key`) |
| `HERMES_API_URL` | Hermes gateway base URL (optional) |
| `HERMES_API_SERVER_KEY` | Hermes API auth key (optional) |
| `OMNIROUTE_API_BASE` | OmniRoute base URL (optional) |
| `OMNIROUTE_MGMT_KEY` | OmniRoute management key for provisioning (optional) |
| `FLEET_CONTROL_URL` | Fleet Control API base, e.g. `http://fleet-control-api:8080` |
| `FLEET_CONTROL_KEY` | Bearer token for the Fleet Control API |

> Run the `execute` tool with the **host** backend. The runtime has real
> `curl`, `grep`, `sed` but **NO `python3` and NO `jq`** — parse JSON by reading
> it directly or with `grep -o`. Credentials are pre-injected as the env vars
> above; never ask for them.

## Setup helper

```bash
H="x-api-key: $DOKPLOY_API_KEY"
B="$DOKPLOY_API_BASE"
CT="Content-Type: application/json"
```

## The fleet as JSON

`project.all` returns the whole tree (projects → environments → compose
services). Read it directly, or pull fields with `grep`:

```bash
# service names:
curl -s -H "$H" "$B/project.all" | grep -o '"name":"[^"]*"'
# names + status pairs interleaved:
curl -s -H "$H" "$B/project.all" | grep -o '"name":"[^"]*"\|"composeStatus":"[^"]*"'
# raw (just read the JSON yourself):
curl -s -H "$H" "$B/project.all"
```

Each compose object looks like
`{"composeId":"...","name":"hermes-ania","composeStatus":"running",...}`.
To act on a service, read its `composeId` from that raw JSON next to the
matching `"name"`.

## Inspect one service

```bash
curl -s -H "$H" "$B/compose.one?composeId=$CID"
```

## Deploy logs (latest deployment)

```bash
DID=$(curl -s -H "$H" "$B/deployment.allByCompose?composeId=$CID" \
  | grep -o '"deploymentId":"[^"]*"' | head -1 | sed 's/.*:"//;s/"$//')
[ -n "$DID" ] && curl -s -H "$H" "$B/deployment.readLogs?deploymentId=$DID&tail=200"
```

## Lifecycle — deploy / redeploy / stop / start

```bash
curl -s -H "$H" -H "$CT" -d "{\"composeId\":\"$CID\"}" "$B/compose.deploy"
curl -s -H "$H" -H "$CT" -d "{\"composeId\":\"$CID\"}" "$B/compose.redeploy"
curl -s -H "$H" -H "$CT" -d "{\"composeId\":\"$CID\"}" "$B/compose.stop"
curl -s -H "$H" -H "$CT" -d "{\"composeId\":\"$CID\"}" "$B/compose.start"
```

> **Destructive actions** (stop, redeploy of a healthy prod service) — confirm
> intent with the requester before running. Deploys can fail Let's Encrypt
> challenges if DNS is wrong; check the host resolves to the VPS first.

## Change env / source (advanced)

```bash
curl -s -H "$H" -H "$CT" \
  -d "{\"composeId\":\"$CID\",\"env\":\"KEY=value\nKEY2=value2\"}" \
  "$B/compose.saveEnvironment"
# then redeploy to apply
```

## Add / remove / list Hermes agents (Fleet Control API)

Hermes agents are spun up by a server-side factory exposed at
`$FLEET_CONTROL_URL` (internal overlay service). Each agent = its own container
`hermes-<slug>` with an isolated OmniRoute key + budget. Use this instead of
hand-driving Dokploy for Hermes agents — it does OmniRoute key + compose +
deploy + persona/rule seeding in one call.

```bash
FH="Authorization: Bearer $FLEET_CONTROL_KEY"
U="$FLEET_CONTROL_URL"

# List all Hermes agents + status (returns JSON — read it directly)
curl -s -H "$FH" "$U/agents"

# Add an agent (creates OmniRoute key+budget, deploys, seeds SOUL/AGENTS)
curl -s -H "$FH" -H "$CT" -d '{
  "slug":"fotografo",
  "rule":"Atende clientes de estudio de fotografia, faz orcamentos",
  "persona":"Recepcionista simpatica do estudio",
  "budget_usd":20,
  "rag":"fotografo-kb"
}' "$U/agents"
# Response includes a dnsAction: add A record <slug>.agents -> 64.181.172.102

# Remove an agent (stop+delete compose, revoke OmniRoute key; DNS left for operator)
curl -s -X DELETE -H "$FH" "$U/agents/fotografo"
```

> Adding an agent returns a `dnsAction` — the new `<slug>.agents.aniamodels.shop`
> needs an A record to `64.181.172.102` before its gateway URL serves TLS. The
> operator (human) must add that DNS record; the agent runs regardless on the
> overlay.

## Talk to a Hermes agent (if configured)

```bash
curl -s -H "Authorization: Bearer $HERMES_API_SERVER_KEY" -H "$CT" \
  -d '{"message":"status"}' "$HERMES_API_URL/api/..."   # see Hermes API docs
```

## Provision an OmniRoute key (if configured)

OmniRoute is an OpenAI-compatible LLM router. Mint a scoped key for another app:

```bash
curl -s -H "Authorization: Bearer $OMNIROUTE_MGMT_KEY" -H "$CT" \
  -d '{"name":"app-x","providers":["..."]}' \
  "$OMNIROUTE_API_BASE/api/keys"   # adjust to the OmniRoute provisioning route
# Hand the returned key to the requesting app; it then calls
# $OMNIROUTE_API_BASE/v1/chat/completions like any OpenAI endpoint.
```

## Notes

- Never print a key. Output is secret-redacted, but don't `echo $DOKPLOY_API_KEY`.
- Resolve `composeId` by name each run — ids are environment-specific.
- One service = one docker-compose stack in Dokploy; status is `composeStatus`.
