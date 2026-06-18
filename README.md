# Edital Defensoria-Geral do Exercito

Formulario de avaliacao com painel administrativo, analise heuristica de IA e relatorios.

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
PUBLIC_ADMIN_URL=https://seusite.vercel.app
```

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
