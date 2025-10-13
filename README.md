# extra_brain_client

## Gusto OAuth Setup

Environment variables:

- `GUSTO_CLIENT_ID`
- `GUSTO_CLIENT_SECRET`
- `GUSTO_AUTH_BASE` (optional, defaults to `https://api.gusto.com`)
- `GUSTO_SCOPES` (optional, defaults to `user.read company.read`)
- `BASE_URL` (backend base URL, e.g., `http://localhost:5001` or your prod URL)

Redirect URI to register in Gusto developer portal:

`<BASE_URL>/api/integrations/gusto/callback`

Endpoints:

- `GET /api/integrations/gusto/connect` (auth required) – redirects to Gusto consent
- `GET /api/integrations/gusto/callback` – exchanges code for tokens and stores connection
- `POST /api/integrations/gusto/disconnect` (auth required) – removes connection

