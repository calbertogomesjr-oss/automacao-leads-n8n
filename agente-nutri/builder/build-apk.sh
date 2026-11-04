#!/usr/bin/env bash
# Empacota www/ como APK Android (Capacitor) e publica em $PUBLICO_DIR/app.apk.
set -euo pipefail

cd "$PROJETO_DIR"

npm install --no-audit --no-fund --loglevel=error

if [ ! -d android ]; then
  npx cap add android
fi
# O app carrega o site ao vivo: uma mudanca de conteudo aparece ao reabrir o
# app, sem instalar APK novo. O endereco vem do .env de cada instalacao,
# nunca fixo aqui, para um cliente nao apontar para o site de outro.
if [ -n "${URL_PUBLICA:-}" ]; then
  node -e 'const fs=require("fs");const p="capacitor.config.json";const c=JSON.parse(fs.readFileSync(p,"utf8"));c.server={url:process.env.URL_PUBLICA,cleartext:false};fs.writeFileSync(p,JSON.stringify(c,null,2));'
fi

npx cap sync android

# Número de versão só cresce (mesmo depois de "desfazer"), senão o Android
# recusa a atualização por achar que é uma versão mais antiga.
arquivo_versao="$PUBLICO_DIR/versao.txt"
versao=$(( $(cat "$arquivo_versao" 2>/dev/null || echo 0) + 1 ))
sed -i -E "s/versionCode [0-9]+/versionCode ${versao}/; s/versionName \"[^\"]*\"/versionName \"1.${versao}\"/" android/app/build.gradle

# Mantém o nome do app igual ao do capacitor.config.json.
nome=$(node -p "require('./capacitor.config.json').appName")
node -e '
    const fs = require("fs");
    const [arq, nome] = process.argv.slice(1);
    const esc = nome.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\x27/g, "\\\x27");
    let xml = fs.readFileSync(arq, "utf8");
    xml = xml.replace(/(<string name="(app_name|title_activity_main)">)[^<]*(<\/string>)/g, `$1${esc}$3`);
    fs.writeFileSync(arq, xml);
' android/app/src/main/res/values/strings.xml "$nome"

cd android
./gradlew assembleDebug --no-daemon -q

cp app/build/outputs/apk/debug/app-debug.apk "$PUBLICO_DIR/app.apk.novo"
mv "$PUBLICO_DIR/app.apk.novo" "$PUBLICO_DIR/app.apk"
echo "$versao" > "$arquivo_versao"
echo "APK gerado: versão 1.${versao}"
