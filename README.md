# Edital Defensoria-Geral do Exercito

Formulario de avaliacao do candidato com analise heuristica de IA e relatorios.

> O painel administrativo agora roda em um projeto separado: `../Edital painel`.
> Esta API expoe rotas `/api/admin/*` consumidas pelo painel via CORS.

## Variaveis de ambiente (`.env`)

```
PORT=3000
ADMIN_PIN=DGE-2026
ADMIN_SESSION_SECRET=troque-este-segredo
MIN_PERFORMANCE_PERCENT=70
EXAM_START_AT=2026-06-19T15:00:00Z
EXAM_END_AT=2026-06-21T23:00:00Z
MIN_FORM_DURATION_MS=30000
LOG_LEVEL=info

# Opcionais
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DISCORD_WEBHOOK_URL=
PUBLIC_ADMIN_URL=https://edital-painel.vercel.app
ADMIN_PANEL_ORIGIN=https://edital-painel.vercel.app
IP_HASH_SALT=troque-este-salt

# Login Discord no painel (OAuth)
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=
DISCORD_ALLOWED_USERS=mudinhoxy,titaniabrjv,yoursalf_.7

# 2FA opcional por cargo no Discord (exige o cargo no servidor indicado)
DISCORD_GUILD_ID=
DISCORD_REQUIRED_ROLE_ID=

# Backup automatico (Vercel Cron envia Authorization: Bearer CRON_SECRET)
CRON_SECRET=
```

`ADMIN_PANEL_ORIGIN` autoriza CORS para o projeto separado do painel.
Use `*` apenas em desenvolvimento. `PUBLIC_ADMIN_URL` faz a rota `/admin`
redirecionar para o painel externo.

### Recursos adicionais

- **Login Discord + 2FA por cargo**: se `DISCORD_GUILD_ID` e
  `DISCORD_REQUIRED_ROLE_ID` estiverem definidos, o login exige que o usuario
  tenha o cargo no servidor (alem de estar na allowlist).
- **Log de auditoria**: toda acao admin (login, status, config, revisor,
  limpeza, backup) e gravada na tabela `defensoria_audit` (ou `data/audit.json`).
- **Rascunho no servidor**: o formulario sincroniza o rascunho via
  `POST /api/draft` para recuperar de outro dispositivo.
- **Presenca em tempo real**: candidatos enviam heartbeat (`POST /api/presence`)
  e o painel mostra quantos estao preenchendo agora.
- **Backup diario**: `vercel.json` agenda `GET /api/cron/backup` (06:00 UTC);
  com `DISCORD_WEBHOOK_URL` o snapshot vai como anexo no canal.
- **Antifraude extra**: deteccao de DevTools, fingerprint do navegador,
  contagem de revisoes e maior inatividade sao salvos e exibidos no painel.
- **Healthcheck real**: `GET /api/health` testa Supabase e Groq de verdade.

As datas `EXAM_START_AT` / `EXAM_END_AT` estao em **UTC**. O padrao acima cobre
`19/06/2026 12:00` ate `21/06/2026 20:00` no fuso `America/Sao_Paulo` (UTC-3).

## Rodar local no Windows (so para testar)

1. Instale o [Node.js 20+](https://nodejs.org/) (LTS).
2. Abra o **PowerShell** dentro da pasta `Edital defensoria`.
3. Instale dependencias e suba:

```powershell
npm install
copy NUL .env   # crie e edite com as variaveis acima
npm run dev
```

4. Abra `http://127.0.0.1:3000` para o candidato e `http://127.0.0.1:3000/admin`
   para o painel.

Sem `SUPABASE_URL`, os envios sao salvos em `data/submissions.json`. Sem
`GROQ_API_KEY`, a analise de IA cai na heuristica local.

### Testes

```powershell
npm test
```

## Hospedar na Vercel

A Vercel **nao tem disco persistente**, entao em producao voce **precisa do Supabase**
(senao cada deploy perde os envios).

### Passo a passo

1. **Crie o projeto no Supabase** (gratis) em https://supabase.com/.
2. No SQL Editor, cole e execute o arquivo `supabase-schema.sql`.
3. Em **Project Settings -> API**, pegue:
   - `Project URL` -> sera o `SUPABASE_URL`
   - `service_role` key (mantenha em segredo) -> sera o `SUPABASE_SERVICE_ROLE_KEY`
4. **Suba o codigo para um repositorio Git** (GitHub, GitLab ou Bitbucket).
5. Em https://vercel.com/, clique **Add New -> Project** e importe o repo.
6. Em **Environment Variables**, defina:
   - `ADMIN_PIN`
   - `ADMIN_SESSION_SECRET`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `EXAM_START_AT`, `EXAM_END_AT`
   - `GROQ_API_KEY` (opcional)
   - `DISCORD_WEBHOOK_URL` (opcional)
   - `PUBLIC_ADMIN_URL` (ex.: `https://edital-defensoria.vercel.app`)
7. Clique **Deploy**. O `vercel.json` ja mapeia todas as rotas para `server.js`
   rodando como funcao serverless.
8. Acesse `https://<seu-projeto>.vercel.app` (candidato) e
   `https://<seu-projeto>.vercel.app/admin` (admin).

### Se aparecer HTML puro sem design

Isso acontece quando a Vercel nao empacota `styles.css`, `app.js` ou `assets/`.
O `vercel.json` deste projeto ja inclui esses arquivos em `includeFiles` e o
`server.js` serve `/styles.css`, `/app.js`, `/manifest.json`, `/sw.js` e
`/assets/*` com MIME correto. Depois de atualizar esses arquivos, faca um novo
deploy completo na Vercel.

Na Vercel, configure obrigatoriamente:

- `ADMIN_PIN`
- `ADMIN_SESSION_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MIN_PERFORMANCE_PERCENT`

Sem Supabase em producao, a API de envio retorna erro porque funcoes serverless
nao possuem disco persistente.

### Webhook do Discord

1. No canal desejado, **Editar canal -> Integracoes -> Webhooks -> Novo webhook**.
2. Copie a URL e cole em `DISCORD_WEBHOOK_URL` (no `.env` local ou na Vercel).
3. Toda submissao dispara um embed; o botao "Gerar magic link" no painel admin
   manda o link no mesmo canal e copia para a area de transferencia.

### Janela do edital

- `EXAM_START_AT` / `EXAM_END_AT` sao validados no servidor. Fora desse periodo
  o `POST /api/submissions` retorna `400` e o front mostra banner laranja.

### PWA / offline

- `manifest.json` e `sw.js` ja sao servidos. O service worker faz cache do
  formulario para o candidato continuar lendo se a internet cair. Envios so vao
  quando a conexao volta (o `fetch` falha com toast de erro).

## Anti-cola e anti-bot

- Cada candidato recebe um seed proprio que embaralha **ordem das questoes** e
  **alternativas** (`shuffleWithSeed`). O servidor sempre conhece o `originalIndex`.
- Honeypot `middlename` (invisivel) + checagem de duracao minima do formulario
  (`MIN_FORM_DURATION_MS`, padrao 30s) descartam bots.
- Rate limit em memoria: 3 envios por IP por minuto.
- Similaridade Jaccard (4-shingles) entre subjetivas - exibe % e nome do
  candidato com maior overlap.
