# Kubernetes deployment (reference manifests)

These manifests are a starting point for deploying BNP Decision Guard to a
Kubernetes cluster. They mirror the Docker Compose topology:

- `api-deployment.yaml` — NestJS API (expects a managed PostgreSQL with pgvector
  and an S3-compatible object store; point the env vars at them via the Secret).
- `web-deployment.yaml` — Next.js web app.
- `secrets.example.yaml` — template for required secrets. Copy, fill, and apply
  as `bnp-secrets`. Never commit real secrets.

For production also add: an Ingress with TLS (HTTPS termination), network
policies, resource limits tuned to your cluster, and a managed PostgreSQL with
the `vector` extension enabled.
