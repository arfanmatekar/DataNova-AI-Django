# DataNova AI

DataNova AI is an authenticated data-analysis workspace integrated into the
existing Django project. It uses the project's SQLite database for persistent,
per-user projects, uploaded datasets, and learning milestones. The existing
storefront remains available at `/shop/`.

This Django repository is the standalone DataNova integration for the existing
SmartEcommerce project. It is separate from the Next.js DataNova AI project.

## Run locally

From the project root, install the Python dependencies, apply the migrations,
and start the development server:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Open <http://127.0.0.1:8000/> and create an account. Sign up automatically
creates your four learning milestones and opens your private workspace. Django
validates passwords and securely hashes them. If PowerShell blocks virtual
environment activation, run `python -m pip install -r requirements.txt`
without activating it.

Run the automated tests and Django checks:

```powershell
python manage.py test shop.tests
python manage.py check
```

## Features

- Create, search, filter, edit, and delete projects. Project status is
  Planning, Active, or Completed.
- Upload CSV, Excel `.xlsx`, and JSON files. Each project keeps the most
  recently uploaded dataset, with an interactive table and pagination.
- Generate local analytics, numeric summaries, charts, trends, sales totals,
  and outlier checks without an external AI service or API key.
- Generate a self-contained HTML report, open it in your browser, and print
  or save it to PDF.
- Complete learning milestones to update your learning score.
- Use Django authentication; every project, dataset, and milestone is private
  to its owner. Django administrator accounts sign in to `/admin/`.
- Visit `/shop/` to continue using the original storefront.

The question-answering feature is intentionally a deterministic, offline
analytics engine rather than an external generative-AI service: answers are
calculated from the uploaded dataset. An external provider can be integrated
behind `shop/analytics.py` if required, without changing file storage or the
browser-facing API.

## Upload limits

The supported uploads are UTF-8 `.csv`, `.xlsx` workbooks, and JSON arrays of
objects (or objects containing a `rows` array). Files are limited to 5 MB,
5,000 data rows, and 100 columns. CSV, Excel, and JSON uploads replace the
previous dataset in that project. For Excel files, DataNova reads the active
worksheet and cached cell values.

## Deployment

Before deployment, set `DJANGO_DEBUG=false`, set `DJANGO_SECRET_KEY` to a
private, randomly generated key, and set `DJANGO_ALLOWED_HOSTS` to
comma-separated trusted hostnames. The app refuses to start in production mode
without `DJANGO_SECRET_KEY`; for local development, it uses a clearly
development-only fallback. For example, in PowerShell:

```powershell
$env:DJANGO_DEBUG = "false"
$env:DJANGO_SECRET_KEY = "your-private-generated-secret"
$env:DJANGO_ALLOWED_HOSTS = "your.example.com"
python manage.py check --deploy
```

Also enforce HTTPS and secure session/CSRF cookies, serve static files through
a production static-file server, and configure database backups and logging.
Do not publish your local SQLite database, product uploads, database
credentials, or signing key. The current project uses SQLite; PostgreSQL
requires separately configuring Django's database settings and installing
the appropriate database driver.
