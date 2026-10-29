#!/usr/bin/env bash
set -euo pipefail
KEY="$HOME/.ssh/primeros_accesos.pem"
HOST="ubuntu@3.210.230.147"
SRC="/mnt/c/Users/LUIS GUSTAVO/Documents/PROYECTOS ANGULAR/mali-whatsapp/api/scripts/leads-prod-smoke-readonly.sh"
sed -i 's/\r$//' "$SRC"
scp -i "$KEY" -o StrictHostKeyChecking=accept-new "$SRC" "$HOST:/tmp/leads-prod-smoke-readonly.sh"
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$HOST" 'bash /tmp/leads-prod-smoke-readonly.sh'
