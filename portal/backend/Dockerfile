FROM python:3.12-slim

# The system-health page can shell out to `docker` to introspect sibling
# containers. That only makes sense on a host with a Docker socket (on-prem
# compose sets this arg to "true"); the cloud image on Fargate leaves it off.
ARG INSTALL_DOCKER_CLI=false

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && if [ "$INSTALL_DOCKER_CLI" = "true" ]; then \
         curl -fsSL "https://download.docker.com/linux/static/stable/$(uname -m)/docker-27.5.1.tgz" \
         | tar xz -C /usr/local/bin --strip-components=1 docker/docker; \
       fi \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
