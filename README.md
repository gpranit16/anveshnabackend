# Anveshna Backend (Deployment Ready)

This is the Node.js backend for the Smart Pothole Detection system.

## Quick Deploy on Render

1. Open Render dashboard.
2. New -> Blueprint.
3. Connect this repo: `gpranit16/anveshnabackend`.
4. Render will detect `render.yaml`.
5. Add required environment variables in Render:
   - `MONGO_URI`
   - `FIREBASE_DB_URL`
   - `FIREBASE_SECRET`
   - `GOOGLE_MAPS_API_KEY`
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `JWT_SECRET`
   - optional `JWT_EXPIRES_IN` (default `12h`)
6. Deploy.

## Health check

- `GET /health` -> `{ ok: true }`

## Verify after deploy

- `GET /api/live-data`
- `POST /api/admin/login`

## Arduino compatibility

Arduino writes to Firebase:
- `/sensor_data/latest`

Backend reads from Firebase and pushes live updates to dashboard/admin.
