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

> The `execute` tool must have **network enabled** with these hosts allow-listed,
> and these credentials attached, or the calls below will fail offline.

## Setup helper

```bash
H="x-api-key: $DOKPLOY_API_KEY"
B="$DOKPLOY_API_BASE"
CT="Content-Type: application/json"
```

## Resolve a service by name → composeId

Services are addressed by `composeId`. Resolve it from the project tree instead of
hard-coding ids:

```bash
CID=$(curl -s -H "$H" "$B/project.all" | python3 -c '
import json,sys
name=sys.argv[1]
for p in json.load(sys.stdin):
  for e in p.get("environments",[]):
    for c in e.get("compose",[]):
      if c["name"]==name: print(c["composeId"])
' "OmniRoute1")
echo "$CID"
```

## Status of the whole fleet

```bash
curl -s -H "$H" "$B/project.all" | python3 -c '
import json,sys
for p in json.load(sys.stdin):
  for e in p.get("environments",[]):
    for c in e.get("compose",[]):
      print(c["name"].ljust(18), c.get("composeStatus","?"))'
```

## Inspect one service

```bash
curl -s -H "$H" "$B/compose.one?composeId=$CID" | python3 -m json.tool
```

## Deploy logs (latest deployment)

```bash
DID=$(curl -s -H "$H" "$B/deployment.allByCompose?composeId=$CID" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["deploymentId"] if d else "")')
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
