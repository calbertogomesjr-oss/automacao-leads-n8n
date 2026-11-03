#!/usr/bin/env bash
# Instala o agente nutri na VPS. Rode dentro da pasta agente-nutri:  bash instalar.sh
set -euo pipefail
cd "$(dirname "$0")"

verde() { printf '\033[32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[33m%s\033[0m\n' "$*"; }

if ! command -v docker > /dev/null; then
  echo "Docker não encontrado. Instale com: curl -fsSL https://get.docker.com | sh"
  exit 1
fi
if ! docker compose version > /dev/null 2>&1; then
  echo "O plugin 'docker compose' não está instalado."
  exit 1
fi

if [ -f .env ]; then
  amarelo "Já existe um .env aqui. Mantendo a configuração atual."
else
  echo
  verde "== Configuração do agente =="
  read -rp "Domínio público do site [nutri.stfu.fun]: " dominio
  dominio=${dominio:-nutri.stfu.fun}
  dominio=${dominio#https://}; dominio=${dominio#http://}; dominio=${dominio%/}
  echo
  echo "Token da sua assinatura do Claude."
  echo "No seu computador, rode 'claude setup-token' e cole aqui o token gerado."
  read -rsp "Token (não aparece enquanto digita): " token_claude; echo
  read -rp "Limite de pedidos por dia [30]: " limite
  token=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')

  umask 077
  cat > .env <<EOF
TOKEN=${token}
DOMINIO=${dominio}
URL_PUBLICA=https://${dominio}
PORTA_LOCAL=3100
AGENTE=claude
CLAUDE_CODE_OAUTH_TOKEN=${token_claude}
MODELO=
LIMITE_DIARIO=${limite:-30}
TEMPO_LIMITE_MIN=15
EOF
  verde ".env criado."
fi

# O appId só pode ser escolhido antes do primeiro build do app.
if ! docker volume inspect agente-nutri_dados > /dev/null 2>&1; then
  atual=$(grep -o '"appId": *"[^"]*"' template/capacitor.config.json | cut -d'"' -f4)
  echo
  echo "Identificador do app Android (não pode mudar depois). Atual: ${atual}"
  read -rp "Novo identificador (ex.: br.com.anasilva.nutri) ou Enter para manter: " app_id
  if [ -n "${app_id}" ]; then
    if [[ ! "${app_id}" =~ ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$ ]]; then
      echo "Identificador inválido: use letras minúsculas, números e pontos (ex.: br.com.ana.nutri)."
      exit 1
    fi
    sed -i "s/\"appId\": *\"[^\"]*\"/\"appId\": \"${app_id}\"/" template/capacitor.config.json
  fi
  read -rp "Nome do app no celular [Nutri]: " app_nome
  if [ -n "${app_nome}" ]; then
    python3 - "${app_nome}" <<'PY' 2> /dev/null || sed -i "s/\"appName\": *\"[^\"]*\"/\"appName\": \"${app_nome//\"/}\"/" template/capacitor.config.json
import json, sys
p = 'template/capacitor.config.json'
c = json.load(open(p))
c['appName'] = sys.argv[1]
json.dump(c, open(p, 'w'), indent=2, ensure_ascii=False)
PY
  fi
fi

echo
verde "== Construindo e subindo (o primeiro build baixa o Android SDK e leva alguns minutos) =="
docker compose up -d --build

echo
verde "== Pronto! =="
porta=$(grep '^PORTA_LOCAL=' .env | cut -d= -f2)
dominio=$(grep '^DOMINIO=' .env | cut -d= -f2)
echo "Teste local:    curl -s http://127.0.0.1:${porta:-3100}/saude"
echo "Teste público:  curl -s https://${dominio}/saude   (o DNS precisa apontar para esta VPS)"
echo
echo "Falta, no n8n: credencial 'Header Auth' do nó Executar agente:"
echo "       Nome:  Authorization"
echo "       Valor: Bearer <o TOKEN do .env>"
echo "     Para ver o TOKEN no seu terminal (não cole em chats):  grep '^TOKEN=' .env"
echo
echo "Acompanhe o primeiro APK sendo gerado com:  docker logs -f agente-nutri"
