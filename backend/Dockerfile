FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ffmpeg \
    libpq-dev \
    procps \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chmod +x entrypoint.sh
RUN addgroup --system app && adduser --system --ingroup app --home /home/app app \
    && mkdir -p /var/run/celery \
    && chown -R app:app /app /home/app /var/run/celery

EXPOSE 8000

USER app

CMD ["sh", "entrypoint.sh"]
