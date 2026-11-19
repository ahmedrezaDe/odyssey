# Odyssey

A personal career workspace I built for my own job search: track job leads, get AI feedback on a CV, practise interview questions and draft networking emails, all in one dashboard.

> **Status: working prototype, not a production product.** Several features call a real LLM; others are tracking/CRUD screens or still placeholders (see the table below). I built it to learn how a full-stack AI application fits together.

## What works

| Feature | What it does | Status |
|---|---|---|
| CV Roaster | Sends your CV to an LLM (Groq, Llama 3) and returns structured critique | Working (LLM) |
| Interview practice | Generates questions for a role and evaluates your answers | Working (LLM) |
| Networking drafts | Drafts outreach emails for a contact and role | Working (LLM) |
| Profile parsing | Extracts a structured profile from your CV text | Working (LLM), partly placeholder |
| Job leads | Save, update and track job leads in Supabase | Working (database) |
| Dashboard and stats | Overview of leads and activity | Working (database) |
| CV generation, document studio | Tailored CVs and documents per lead | Placeholder output |
| CRM sync, email sending | HubSpot/Salesforce sync, SMTP sending | Mock / needs configuration |

## Architecture

```
React 19 frontend (TanStack Router, Tailwind, Radix UI)
        │  REST (JSON)
        ▼
FastAPI backend ──► Groq API (LLM features)
        │
        ▼
Supabase (PostgreSQL + Auth)
```

- **Frontend:** React 19, TanStack Router and Query, Zustand, Tailwind CSS, Radix UI, Vite
- **Backend:** FastAPI (Python), Pydantic, Supabase client, optional Redis cache, rate limiting, admin token management
- **AI:** Groq-hosted Llama 3 models via a retrying API wrapper; prompts in `backend/prompts.py`
- **Deployment:** both parts are configured for Vercel (`vercel.json`)

## Running it locally

You need Python 3.11+, Node.js 20+, a Supabase project and a Groq API key.

```bash
# 1. Configuration
cp .env.example .env          # fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, GROQ_API_KEY, VITE_* values

# 2. Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn api.index:app --reload --port 8000

# 3. Frontend (second terminal)
cd frontend
npm install
npm run dev
```

The frontend expects `VITE_ODYSSEY_API_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The database tables used are `user_profiles`, `job_leads`, `networking_drafts` and `user_webhooks`; there are no migration scripts yet.

## What I learned

- Splitting an AI app into a typed frontend, an API layer and a database, and keeping secrets out of the client
- Wrapping an LLM API with retries, rate limits and structured prompts so output is usable by the UI
- How quickly scope grows: the next step for this project is replacing the placeholder features rather than adding new ones

## How it was built

Designed and specified by me (Ahmed Reza). Much of the code was written with AI coding assistants (the first UI scaffold came from Lovable), then reviewed, run and tested by me. This repository is a clean snapshot of my private development repo.

## License

MIT
