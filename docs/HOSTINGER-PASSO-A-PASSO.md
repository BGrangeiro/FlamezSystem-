# Publicar o Sistema Flamez na sua VPS Hostinger

VPS informada: **85.31.63.215**. Domínio informado como registrado na Hostinger: **flamez3d.io**. O sistema operacional ainda precisa ser confirmado. Este roteiro não reinstala a VPS e não substitui outros sites. Os comandos de Docker abaixo supõem uma VPS Linux com Docker Compose instalado e portas 80/443 livres.

Em 17/09/2026, os dados deste computador foram migrados e conferidos em SQLite, com backup anterior e posterior. A configuração local `.env` seleciona SQLite e backups a cada 24 horas enquanto o servidor estiver ligado. O pacote de código e o backup para transferência estão em `artifacts/hostinger/`. A VPS ainda não recebeu esses arquivos.

## O que ficará salvo

A instalação preparada usa **SQLite**, no arquivo `/var/lib/flamez/flamez.sqlite3`. Produtos, calculadoras, observações, encomendas e entregas parciais, gastos, estoques, produção, máquinas, acessos e histórico Bambu ficam no banco. Cada gravação dos registros relacionados ocorre em transação. Os arquivos JSON antigos permanecem disponíveis após a migração, mas deixam de ser a fonte ativa.

A pasta `/var/lib/flamez` fica fora do código em `/opt/flamez`. Atualizar o site não remove os registros. Backups verificados são criados diariamente em `/var/lib/flamez/backups`, com retenção de 30 cópias automáticas. Também é necessário manter cópias fora da VPS.

A sessão Bambu e sua chave continuam em arquivos privados na mesma pasta de dados. Você pode fazer uma nova conexão Bambu no site publicado; o histórico de uso é incluído no backup, mas as credenciais Bambu não.

## 1. Verificar a VPS no painel

Entre em Hostinger → VPS → Gerenciar. Confira o IP, sistema operacional, acesso SSH e backups. Não use a opção de reinstalar o sistema operacional se a VPS já contém dados ou outros sites.

No computador, abra o PowerShell:

```powershell
ssh root@85.31.63.215
```

No primeiro acesso, compare a impressão digital SSH com a chave mostrada/consultada no terminal confiável da VPS. Na VPS, o comando `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` mostra a impressão digital. Somente depois confirme a confiança no computador. Digite a senha da VPS diretamente no terminal; não envie senha na conversa.

Se a VPS usa outro usuário/porta, utilize os dados exibidos no painel. Confira o ambiente:

```sh
cat /etc/os-release
docker --version
docker compose version
ss -ltnp
```

Se Docker não existir, siga a instalação oficial correspondente ao sistema. Para Ubuntu: https://docs.docker.com/engine/install/ubuntu/. Se as portas 80/443 já estiverem ocupadas por Nginx, Apache, CloudPanel ou outro proxy, integre o app ao proxy existente seguindo `docs/HOSTINGER.md`; não pare serviços existentes para seguir este roteiro.

## 2. Preparar o domínio

Na Hostinger, abra **Domínios → Portfólio de domínios → flamez3d.io**. O proprietário informou que o registro já foi feito. Confira no painel se o domínio está ativo e se há verificação de e-mail pendente. Na consulta pública realizada durante esta preparação, o domínio ainda não resolvia; confira a ativação e o DNS no painel antes de solicitar o certificado HTTPS.

No domínio que você possuir, abra **Gerenciar → DNS / Nameservers** e configure:

| Tipo | Nome | Aponta para | TTL |
| --- | --- | --- | --- |
| A | @ | 85.31.63.215 | padrão |

Esse registro publica o endereço sem `www`. Confira se há um registro A/AAAA conflitante para `@` antes de alterá-lo. Preserve registros de e-mail (MX/TXT) e qualquer site existente. A propagação pode levar até 24 horas. Se o DNS estiver em outro provedor, faça a alteração nesse provedor. [Guia oficial da Hostinger](https://www.hostinger.com/support/1583227-how-to-point-a-domain-to-your-vps-at-hostinger/).

Os exemplos seguintes usam `flamez3d.io`. No PowerShell, confira `Resolve-DnsName flamez3d.io -Type A`: o endereço retornado deve ser `85.31.63.215`.

Libere entrada TCP 80 e 443 no firewall da VPS e mantenha seu acesso SSH administrativo. A porta 5177 ficará interna, sem publicação na internet. A Bambu precisa de saída TCP 443 e 8883. O proxy Caddy cuida do certificado HTTPS quando o DNS e essas portas estão funcionando.

## 3. Gerar o pacote e o backup no computador

Abra PowerShell dentro da pasta `FlamezSystem-`. Antes, confira no navegador os custos/calculadoras e salve alterações pendentes. Se os valores só existem no navegador, eles precisam ser salvos antes do backup. Depois pare o servidor local.

```powershell
npm ci
npm run check
npm test
npm run hosting:package
npm run backup
```

O código está em `artifacts/hostinger/flamez-app.tar.gz`; o comando de backup informa o arquivo JSON em `backups`. Um backup já foi preparado em `artifacts/hostinger/flamez-data.json`. Se continuar usando o site local após essa preparação, substitua-o pelo backup mais recente com o servidor parado antes de transferir:

```powershell
$latestBackup = Get-ChildItem -LiteralPath backups -File -Filter 'flamez-*.json' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Copy-Item -LiteralPath $latestBackup.FullName -Destination artifacts/hostinger/flamez-data.json
```

Confira e transfira:

```powershell
npm run backup:verify -- artifacts/hostinger/flamez-data.json
scp artifacts/hostinger/flamez-app.tar.gz artifacts/hostinger/flamez-app.tar.gz.sha256 artifacts/hostinger/flamez-data.json root@85.31.63.215:/root/
```

O pacote de código não contém dados privados, senhas, SQLite ou sessão Bambu. `flamez-data.json` contém os registros da empresa e deve ficar privado. Nunca coloque esse arquivo em `public/` ou no GitHub.

## 4. Instalar o código e criar acesso

Na VPS, para uma instalação nova:

```sh
cd /root
sha256sum -c flamez-app.tar.gz.sha256
mkdir -p /opt/flamez
# Extraia aqui somente se /opt/flamez for a pasta deste sistema.
tar -xzf flamez-app.tar.gz -C /opt/flamez
install -d -m 700 -o 1000 -g 1000 /var/lib/flamez /var/lib/flamez/backups
cd /opt/flamez
```

Crie a configuração com seu domínio real:

```sh
docker run --rm -v /opt/flamez:/workspace -w /workspace node:22-alpine node scripts/setup-production.js --origin https://flamez3d.io --data-dir /var/lib/flamez --output .env
```

Anote o usuário e as duas senhas que o comando mostra. O login será exigido; reconhecimento automático por IP fica desativado. O script se recusa a sobrescrever um `.env` existente. Preserve esse arquivo nas atualizações.

```sh
docker compose -f compose.hostinger.yaml config --quiet
docker compose -f compose.hostinger.yaml build
```

A configuração usa a rede Docker `172.30.77.0/24`, com IP fixo `.2` para o proxy e `.3` para o aplicativo. O pool dinâmico `172.30.77.128/25` fica separado desses endereços. Se a rede já estiver ocupada, ajuste a subnet, o pool, os dois IPs e `TRUSTED_PROXY_IPS` juntos antes de iniciar.

## 5. Importar os registros para o banco

O servidor ainda deve estar parado e `/var/lib/flamez` deve pertencer a esta instalação nova. O backup exportado pode ser restaurado diretamente no banco SQLite. Copie o arquivo privado com permissão de leitura para o usuário do container (UID 1000):

```sh
install -m 600 -o 1000 -g 1000 /root/flamez-data.json /var/lib/flamez/import-backup.json
docker compose -f compose.hostinger.yaml run --rm --no-deps flamez npm run backup:verify -- /var/lib/flamez/import-backup.json
docker compose -f compose.hostinger.yaml run --rm --no-deps flamez npm run restore -- /var/lib/flamez/import-backup.json --confirm
docker compose -f compose.hostinger.yaml run --rm --no-deps flamez npm run preflight
```

O checksum é validado antes da restauração e a gravação no SQLite ocorre em transação. Se houver arquivos JSON antigos de uma instalação anterior nesse diretório, pare e faça a migração documentada no README; não sobrescreva registros existentes para seguir uma instalação nova. Preserve o modo `STORAGE_BACKEND=sqlite` nas futuras restaurações.

## 6. Iniciar e conferir

```sh
docker compose -f compose.hostinger.yaml up -d
docker compose -f compose.hostinger.yaml ps
docker compose -f compose.hostinger.yaml logs --tail=80
```

Abra `https://flamez3d.io`, entre com as credenciais geradas e confira seus cadastros, entregas, custos e estoque. Faça uma alteração controlada, reinicie o app e confira se permaneceu salva:

```sh
docker compose -f compose.hostinger.yaml restart flamez
```

Conecte a Bambu novamente pelo site hospedado. Quando a VPS assumir o acompanhamento, mantenha a instalação local parada para não criar dois históricos independentes. Acompanhe a primeira impressão e confirme a atualização das horas/estoque.

## 7. Backup fora da VPS e atualizações

Os backups automáticos continuam mesmo com o navegador fechado. No PowerShell, baixe cópias para outro computador/disco:

```powershell
New-Item -ItemType Directory -Force backups-hostinger
scp 'root@85.31.63.215:/var/lib/flamez/backups/flamez-auto-*.json' backups-hostinger/
```

Confira também a programação de backups/snapshots disponível no painel Hostinger. O agendamento de cópia externa ainda depende do destino escolhido; guardar tudo apenas no disco da VPS não cobre perda desse disco.

Antes de atualizar o código:

```sh
cd /opt/flamez
docker compose -f compose.hostinger.yaml stop flamez
docker compose -f compose.hostinger.yaml run --rm --no-deps flamez npm run backup
```

Transfira e extraia o novo pacote de código na mesma pasta, preservando `.env` e `/var/lib/flamez`. Em seguida:

```sh
docker compose -f compose.hostinger.yaml build
docker compose -f compose.hostinger.yaml run --rm --no-deps flamez npm run preflight
docker compose -f compose.hostinger.yaml up -d
```

Não exclua `/var/lib/flamez`, não copie um banco vazio por cima do atual e não use `docker compose down -v` para atualizar.

## Estado desta preparação

Código, banco SQLite com os registros atuais, backups e roteiro estão preparados localmente. A publicação ainda exige confirmar propriedade/registro do domínio, identidade SSH/acesso, sistema operacional e portas livres. A sessão Hostinger do navegador externo não está acessível no navegador do Codex, que abriu a tela de login. A chave SSH da VPS ainda não é conhecida neste computador. A configuração Docker/Caddy deve ser validada na VPS: este computador não tem Docker instalado.

Fontes: [SSH na Hostinger](https://www.hostinger.com/support/5723772-how-to-connect-to-your-vps-via-ssh-at-hostinger/), [backups da VPS](https://www.hostinger.com/support/1583232-how-to-back-up-or-restore-a-vps-at-hostinger/), [Docker no Ubuntu](https://docs.docker.com/engine/install/ubuntu/), [proxy Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
