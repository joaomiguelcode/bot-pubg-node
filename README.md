# 🎮 Bot PUBG para Discord (Node.js v14)

Versão moderna, performática e reformulada em **Node.js (Discord.js v14)** do bot de clã de PUBG.

---

## ✨ Principais Diferenciais e Melhorias

- **⚡ Performance 10x mais rápida:** Busca em lote (*batching*) até 10 jogadores por requisição na API do PUBG, eliminando esperas demoradas.
- **🛡️ Cache Inteligente Anti Rate-Limit:** Evita estouro de requisições (`429 Too Many Requests`) na API pública do PUBG.
- **🔮 Suporte a Slash Commands (`/`) e Prefixo (`!`):** Funciona tanto com comandos modernos de barra do Discord quanto com comandos clássicos no chat.
- **📊 Estatísticas Aprofundadas:**
  - **K/D Ratio** real (Kills / Mortes)
  - **ADR** (Average Damage per Round - Dano Médio por Partida)
  - **Win Rate (%)** e **Top 10 Rate (%)**
  - **Headshot %**
  - **Abate mais distante (Longest Kill)** em metros
  - **Recorde de abates em uma única partida**
- **🔍 Validação em Tempo Real:** O comando `/registrar` checa se o nick realmente existe no PUBG antes de salvar.
- **⚔️ Confronto Direto (`/comparar`):** Permite comparar 2 jogadores lado a lado destacando quem leva a coroa em cada métrica.
- **📁 Migração e Persistência Segura:** Migra automaticamente os dados legados de `membros_cla.json` e salva no novo formato seguro com persistência atômica.
- **🔒 Segurança Total:** Tokens movidos para variáveis de ambiente (`.env`).

---

## 📋 Comandos Disponíveis

| Comando | Descrição | Exemplo |
| :--- | :--- | :--- |
| `/ranking` | Exibe o ranking do clã com filtros de modo, métrica e período | `/ranking modo:Squad FPP ordenar:K/D` ou `!ranking` |
| `/perfil` | Ficha detalhada do jogador (K/D, ADR, Headshots, etc.) | `/perfil jogador:HAWK_NK` ou `!perfil` |
| `/registrar` | Vincula seu Discord ao seu Nick no PUBG (com validação na API) | `/registrar nick:MeuNick` ou `!registrar MeuNick` |
| `/comparar` | Compara dois guerreiros do clã lado a lado | `/comparar jogador1:Nick1 jogador2:Nick2` |
| `/membros` | Lista todos os combatentes registrados no clã | `/membros` ou `!membros` |
| `/desvincular` | Remove o vínculo do nick de PUBG | `/desvincular` |
| `/ajuda` | Central de ajuda com guia dos comandos | `/ajuda` ou `!ajuda` |

---

## ⚙️ Instalação e Execução

### 1. Pré-requisitos
- **Node.js 18+** instalado (o projeto foi testado e homologado no Node 24).

### 2. Configurar o `.env`
O arquivo `.env` já vem pré-configurado com suas credenciais atuais:
```env
DISCORD_TOKEN=seu_token_do_discord
DISCORD_CLIENT_ID=seu_client_id
COMMAND_PREFIX=!
PUBG_TOKEN=seu_token_do_pubg
PUBG_PLATFORM=steam
CLAN_NAME="Nocturnal Knights"
CACHE_TTL_SECONDS=300
```

### 3. Registrar os Slash Commands (opcional, já executado)
Para atualizar ou reenviar os comandos de barra (`/`) para o Discord:
```bash
npm run deploy-commands
```

### 4. Iniciar o Bot
```bash
npm start
```
Para modo de desenvolvimento com recarregamento automático:
```bash
npm run dev
```

---

## 🗂️ Estrutura do Código

```
bot-pubg-node/
├── .env                  # Tokens e configurações de ambiente
├── .env.example          # Exemplo de configuração
├── package.json          # Dependências e scripts npm
├── README.md             # Esta documentação
├── data/
│   └── membros.json      # Base de dados de membros do clã
└── src/
    ├── index.js          # Ponto de entrada do bot
    ├── config.js         # Central de configuração
    ├── deploy-commands.js# Publicador de Slash Commands
    ├── services/
    │   ├── pubgService.js    # Conector PUBG API com cache e batching
    │   └── storageService.js # Gerenciador de armazenamento e migração
    └── commands/
        ├── index.js      # Registro unificado dos comandos
        ├── ranking.js    # /ranking
        ├── perfil.js     # /perfil
        ├── registrar.js  # /registrar
        ├── desvincular.js# /desvincular
        ├── comparar.js   # /comparar
        ├── membros.js    # /membros
        └── ajuda.js      # /ajuda
```
