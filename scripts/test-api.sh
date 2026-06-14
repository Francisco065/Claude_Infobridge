#!/bin/bash
# ============================================================
#  INFOBRIDGE — Smoke Test via cURL
#  Uso: bash scripts/test-api.sh [http://host:porta/api/v1]
# ============================================================
BASE="${1:-http://localhost:3000/api/v1}"
PASS=0; FAIL=0
GRN='\033[0;32m'; RED='\033[0;31m'; YLW='\033[1;33m'; RST='\033[0m'

ok()   { echo -e "${GRN}✅ PASS${RST} $1"; ((PASS++)); }
nok()  { echo -e "${RED}❌ FAIL${RST} $1 → $2"; ((FAIL++)); }
info() { echo -e "\n${YLW}▶  $1${RST}"; }

call() {
  local M=$1 P=$2 D=$3 T=$4
  local ARGS=(-s -w '\n%{http_code}' -X "$M" "$BASE$P" -H 'Content-Type: application/json')
  [[ -n "$D" ]] && ARGS+=(-d "$D")
  [[ -n "$T" ]] && ARGS+=(-H "Authorization: Bearer $T")
  curl "${ARGS[@]}"
}

body()   { echo "$1" | head -n -1; }
status() { echo "$1" | tail -1; }
field()  { body "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$2',''))" 2>/dev/null; }

echo "🚀  Infobridge Smoke Tests  →  $BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Health
info "1/8  Health check"
R=$(curl -s -w '\n%{http_code}' "$BASE/../health" 2>/dev/null || echo -e '\n000')
[[ $(status "$R") == "200" ]] && ok "GET /health" || nok "GET /health" "HTTP $(status $R)"

# 2. Login admin
info "2/8  Login"
R=$(call POST /auth/login '{"email":"admin@inovalogistica.com.br","senha":"Infobridge@2026"}')
[[ $(status "$R") == "200" ]] && ok "POST /auth/login" || { nok "POST /auth/login" "HTTP $(status $R)"; echo "$(body $R)"; exit 1; }
AT=$(field "$R" accessToken)
RT=$(field "$R" refreshToken)
echo "     token: ${AT:0:50}..."

# 3. Login inválido
info "3/8  Login inválido"
R=$(call POST /auth/login '{"email":"admin@inovalogistica.com.br","senha":"errada"}')
[[ $(status "$R") == "400" ]] && ok "POST /auth/login (senha errada → 400)" || nok "Login inválido" "esperava 400, recebeu $(status $R)"

# 4. GET /auth/me
info "4/8  Perfil do usuário"
R=$(call GET /auth/me "" "$AT")
[[ $(status "$R") == "200" ]] && ok "GET /auth/me" || nok "GET /auth/me" "$(status $R)"
echo "     email: $(field $R email)"

# 5. Listar usuários
info "5/8  Usuários"
R=$(call GET /usuarios "" "$AT")
[[ $(status "$R") == "200" ]] && ok "GET /usuarios" || nok "GET /usuarios" "$(status $R)"
echo "     meta: $(body $R | python3 -c 'import sys,json; d=json.load(sys.stdin); m=d.get("meta",{}); print(f"total={m.get(\"total\")} | páginas={m.get(\"totalPaginas\")}")' 2>/dev/null)"

# 6. Listar veículos
info "6/8  Veículos"
R=$(call GET /veiculos "" "$AT")
[[ $(status "$R") == "200" ]] && ok "GET /veiculos" || nok "GET /veiculos" "$(status $R)"
echo "     total: $(body $R | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("meta",{}).get("total"))' 2>/dev/null)"

# 7. Listar motoristas
info "7/8  Motoristas"
R=$(call GET /motoristas "" "$AT")
[[ $(status "$R") == "200" ]] && ok "GET /motoristas" || nok "GET /motoristas" "$(status $R)"

# 8. Refresh + Logout
info "8/8  Refresh e Logout"
R=$(call POST /auth/refresh "{\"refreshToken\":\"$RT\"}")
[[ $(status "$R") == "200" ]] && ok "POST /auth/refresh" || nok "POST /auth/refresh" "$(status $R)"
R=$(call POST /auth/logout "{\"refreshToken\":\"$RT\"}" "$AT")
[[ $(status "$R") == "204" ]] && ok "POST /auth/logout" || nok "POST /auth/logout" "$(status $R)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GRN}PASS: $PASS${RST}   ${RED}FAIL: $FAIL${RST}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
