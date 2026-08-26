#!/usr/bin/env bash
# Verify the local observability stack is reachable.
set -euo pipefail

check() {
  local name=$1 url=$2
  if curl -sf "$url" >/dev/null; then
    echo "OK  $name ($url)"
  else
    echo "FAIL $name ($url)"
    return 1
  fi
}

echo "Checking StellarAgent observability stack..."
check "Prometheus" "http://localhost:9090/-/ready"
check "Grafana" "http://localhost:3001/api/health"
check "OTel Collector" "http://localhost:4318/v1/traces" || check "OTel metrics" "http://localhost:8889/metrics"
echo "Stack verification complete."
