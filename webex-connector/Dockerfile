FROM python:3.12-slim

# Deliberately minimal: no ffmpeg/whisper/media-processing deps like the
# on-prem CUCM connector — this is a small event receiver + relay, kept cheap
# to run one instance per tenant.
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1
EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
