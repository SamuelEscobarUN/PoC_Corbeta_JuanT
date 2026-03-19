#!/bin/bash
# Script para crear usuarios de prueba en Cognito
# Uso: ./scripts/create-test-users.sh <USER_POOL_ID>

USER_POOL_ID=$1

if [ -z "$USER_POOL_ID" ]; then
  echo "Uso: ./scripts/create-test-users.sh <USER_POOL_ID>"
  echo "Puedes encontrar el User Pool ID en la salida de 'npx ampx sandbox'"
  exit 1
fi

echo "=== Creando usuario Administrator ==="
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username admin@test.com \
  --user-attributes Name=email,Value=admin@test.com Name=email_verified,Value=true \
  --temporary-password "Admin123!" \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username admin@test.com \
  --password "Admin123!" \
  --permanent

aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$USER_POOL_ID" \
  --username admin@test.com \
  --group-name Administrator

echo "  admin@test.com / Admin123! -> grupo Administrator"

echo ""
echo "=== Creando usuario Operator ==="
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username operador@test.com \
  --user-attributes Name=email,Value=operador@test.com Name=email_verified,Value=true \
  --temporary-password "Operador123!" \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username operador@test.com \
  --password "Operador123!" \
  --permanent

aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$USER_POOL_ID" \
  --username operador@test.com \
  --group-name Operator

echo "  operador@test.com / Operador123! -> grupo Operator"

echo ""
echo "=== Usuarios creados ==="
echo "Admin:    admin@test.com     / Admin123!"
echo "Operador: operador@test.com  / Operador123!"
echo ""
echo "Ambas contraseñas son permanentes (no pedirá cambio al primer login)."
