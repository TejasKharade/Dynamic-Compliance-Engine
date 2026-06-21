# Free Deployment Guide

This project should be deployed as three pieces:

1. Frontend: Vercel, Netlify, or GitHub Pages.
2. Backend API: Render free web service.
3. Graph database: Neo4j AuraDB Free.

For hackathon judging, the recommended setup is:

- Frontend on Vercel.
- Backend on Render.
- Database on Neo4j AuraDB Free.

## 1. Create Neo4j AuraDB Free

1. Go to Neo4j Aura and create one free AuraDB instance.
2. Save the generated password immediately.
3. Copy the Bolt URI, username, and password.

Backend environment variables:

```env
NEO4J_URI=neo4j+s://your-instance.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_generated_password
OPENAI_API_KEY=your_openai_key
```

## 2. Deploy Backend on Render

1. Push this repo to GitHub.
2. In Render, create a new Blueprint or Web Service from the repo.
3. If using the blueprint, Render will read `render.yaml`.
4. If creating manually:
   - Environment: Python
   - Build command: `pip install -r requirements.txt`
   - Start command: `uvicorn src.api.main:app --host 0.0.0.0 --port $PORT`
   - Health check path: `/health`
5. Add the environment variables listed above.
6. After deploy, open:

```text
https://your-render-service.onrender.com/health
```

Expected response:

```json
{"status":"ok"}
```

## 3. Deploy Frontend on Vercel

1. Import the same GitHub repo in Vercel.
2. Set the project root directory to:

```text
frontend
```

3. Use:
   - Framework preset: Vite
   - Build command: `npm run build`
   - Output directory: `dist`
4. Add this environment variable:

```env
VITE_API_BASE_URL=https://your-render-service.onrender.com
```

5. Deploy.

## 4. Judge-Day Checklist

- Open the Render backend URL 5-10 minutes before judging to wake the free instance.
- Open `/health` and confirm `{"status":"ok"}`.
- Open the Vercel frontend URL and run a sample policy evaluation.
- Keep the backend tab open during judging.
- Do not expose `OPENAI_API_KEY` in the frontend. It belongs only in Render environment variables.

## Notes

Render free services can have cold starts after inactivity, so the first request may be slow. For a live demo, warm it up before judges open the site.

Vercel and GitHub Pages are excellent for static frontends, but this app also needs a Python API, so the backend must be hosted separately.
