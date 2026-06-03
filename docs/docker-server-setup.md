# Muhaseb Docker Server Setup

This setup is for the main Windows server PC inside one store.

## Requirements

- Docker Desktop installed and running
- PowerShell opened as Administrator
- The server PC network profile should be `Private`

## Start Server

From the project root:

```powershell
npm run server:docker
```

The command will:

- create a root `.env` file if it does not exist
- configure Windows Firewall for LAN access
- build and start PostgreSQL, Redis, and the API
- run Prisma migrations
- seed baseline data, including the admin login and AFN base currency

## LAN Ports

Only these ports should be open to other computers and phones:

- `4000`: API
- `4001`: POS WebSocket
- `4002`: system health WebSocket

PostgreSQL and Redis are bound to `127.0.0.1`, so they are not exposed to the LAN.

## Client Connection

On desktop/mobile clients, use:

```text
http://SERVER-IP:4000
```

Example:

```text
http://192.168.0.253:4000
```

## First Login

Default seeded admin:

```text
username: admin
password: change-me-now
```

Change this password immediately after first login.

## Useful Commands

```powershell
docker compose ps
docker compose logs -f api
docker compose restart api
docker compose down
```

Backups and server config are stored in Docker volumes, so they survive container restart/rebuild.
