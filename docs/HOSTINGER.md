# Instalação na Hostinger

Para uma instalação nova na VPS informada, use [o roteiro completo com SQLite e HTTPS automático](HOSTINGER-PASSO-A-PASSO.md). O roteiro abaixo continua como alternativa systemd/Nginx e documentação do modo JSON. Para SQLite nessa alternativa, acrescente `STORAGE_BACKEND=sqlite` ao ambiente e migre os registros antes de iniciar o serviço.

Este documento prepara uma publicação futura. Nenhuma conta, domínio ou hospedagem foi alterada.

## Escolha do ambiente

O projeto executa um servidor Node.js próprio com dados JSON em disco. A Hostinger oferece [Node.js gerenciado e VPS](https://www.hostinger.com/support/node-js-hosting-options-at-hostinger/). O roteiro abaixo usa VPS Linux com uma instância, Nginx e disco persistente.

Para hospedagem Node.js gerenciada, confirme no seu plano:

- Suporte ao backend `server.js`, executado com `npm start`, e Node 22.16 ou superior.
- Configuração das variáveis de ambiente e da porta fornecida pela plataforma.
- Diretório persistente gravável, fora da pasta removida/substituída durante os deploys.
- Apenas uma instância usando esse diretório.
- Processo sempre ativo (sem suspensão por inatividade) e conexões de saída HTTPS e MQTT TLS na porta 8883 para acompanhar a Bambu mesmo sem usuários com o site aberto.
- HTTPS no domínio configurado em `APP_ORIGIN`.

Sem garantia de persistência do disco, esta versão não deve ser publicada nesse ambiente. Use VPS ou planeje uma migração específica para banco de dados antes de publicar. Não envie apenas a pasta `public/`.

## VPS: instalação inicial

1. Prepare uma VPS Linux com Node 22 atualizado, Nginx e certificado HTTPS. Use usuário de serviço `flamez`, sem privilégios de administrador. Libere externamente apenas HTTPS/HTTP e o acesso administrativo necessário.
2. Coloque o repositório em `/opt/flamez`. Crie `/var/lib/flamez` e `/var/lib/flamez/backups`, pertencentes ao usuário `flamez`, com permissão `700`. O código pode ficar somente leitura para esse usuário.
3. Na pasta do projeto, execute `npm ci`, `npm run check` e `npm test`. Não copie arquivos `.local.json` da empresa para o repositório.
4. Execute `npm run credentials`. Guarde a senha de acesso e a senha de exclusão em local seguro.
5. Crie `/etc/flamez/flamez.env`, com acesso restrito ao administrador, usando o exemplo abaixo. O systemd lê esse arquivo; não é necessário colocar `.env` dentro do código.

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=5177
DATA_DIR=/var/lib/flamez
APP_ORIGIN=https://sistema.seudominio.com
AUTH_USERNAME=Flamez3D
AUTO_LOGIN_BY_IP=true
TRUSTED_PROXY_IPS=127.0.0.1,::1
AUTH_PASSWORD_HASH=COLE_O_HASH_GERADO
PRODUCTION_DELETE_PASSWORD=COLE_A_SENHA_DE_EXCLUSAO
BACKUP_INTERVAL_HOURS=24
BACKUP_KEEP=30
```

6. Antes do primeiro início, transfira os dados atuais conforme a próxima seção. Ou comece com diretório vazio, se desejar uma instalação sem registros.
7. Instale `deploy/flamez.service` em `/etc/systemd/system/flamez.service`. Confira o caminho de Node (`command -v node`), diretórios e usuário. O exemplo usa `/usr/bin/node`. O serviço executa a verificação `preflight` antes de iniciar. Execute `sudo systemctl daemon-reload` e `sudo systemctl enable --now flamez`.
8. Adapte `deploy/nginx.conf.example` ao domínio e obtenha um certificado válido, por exemplo via Certbot. A base HTTP serve para essa preparação. Depois, use o resultado do Certbot ou `deploy/nginx-https.conf.example`, substituindo domínio e caminhos dos certificados, e execute `sudo nginx -t` antes de recarregar. Não exponha a porta 5177 à internet.
9. Confira `curl http://127.0.0.1:5177/healthz`, os logs com `journalctl -u flamez` e o acesso pelo domínio HTTPS. Faça login, confira os registros e teste uma produção controlada antes de iniciar o uso real.

`APP_ORIGIN` precisa coincidir exatamente com o domínio usado no navegador. A senha e o cookie não funcionarão corretamente acessando um domínio alternativo ou HTTP em produção. O sistema só usa o IP encaminhado quando a conexão vem de um proxy listado em TRUSTED_PROXY_IPS. Com essa configuração correta, o limite de tentativas e o reconhecimento usam o IP real acrescentado pelo Nginx.

## Transferência dos registros existentes

1. No computador atual, aguarde o término dos salvamentos automáticos. Pare o servidor.
2. Faça `npm run backup` e confira a cópia com `npm run backup:verify -- CAMINHO`. O backup inclui `sheets.local.json`, `product-costs.local.json`, `access.local.json` e `bambu-usage.local.json`.
3. Prefira transferir e restaurar esse backup. Se optar por cópia manual, transfira os quatro arquivos existentes para `/var/lib/flamez` por SFTP/SCP, com serviço parado, preservando nomes, proprietário `flamez` e permissões `600`. Para migrar também a sessão Bambu, transfira separadamente `bambu-session.local.json` **e** `bambu-session.key`; eles não entram no backup. Nunca transfira `.flamez.lock` nem coloque dados no GitHub.
4. Alternativamente, envie o backup e execute a restauração com o mesmo usuário de serviço:

```sh
cd /opt/flamez
sudo -u flamez env DATA_DIR=/var/lib/flamez npm run restore -- /caminho/acessivel/backup.json --confirm
```

5. Inicie o serviço e confira produtos, custos, estoque, produção e horas. A exportação não depende de Google Planilhas. As fotos de filamentos estão dentro dos dados; os modelos STL/3MF continuam no Drive.

## Atualização e backup

O diretório de dados deve sobreviver a toda atualização. Não use `git clean`, substituição de volume ou reimplantação para apagar `/var/lib/flamez`.

Antes de atualizar, pare o serviço e faça o backup:

```sh
sudo systemctl stop flamez
cd /opt/flamez
sudo -u flamez env DATA_DIR=/var/lib/flamez npm run backup
```

Copie o backup para fora da VPS. Atualize o código, execute verificações e reinicie com `sudo systemctl start flamez`. Se uma verificação falhar, volte à versão anterior do código antes de reiniciar. Para restaurar dados, pare o serviço e use `npm run restore -- CAMINHO --confirm` com `DATA_DIR` correto.

O backup manual exige uma curta parada. Os backups automáticos do servidor não interrompem o monitoramento: em produção ocorrem ao iniciar com dados existentes e a cada 24 horas, mantendo 30 cópias automáticas verificadas. Ajuste `BACKUP_INTERVAL_HOURS` e `BACKUP_KEEP` conforme necessário. Faça a cópia externa dos arquivos finalizados e monitore falhas no journal. A retenção não apaga backups manuais nem a cópia anterior à restauração. A trava `.flamez.lock` evita duas instâncias; se o servidor informar trava inválida, verifique os processos antes de removê-la.

## Alternativa: Docker na VPS

O `Dockerfile` executa como usuário sem privilégios. O `compose.yaml` mantém os registros em volume nomeado e publica a porta somente no loopback da VPS.

1. Configure `.env` com origem HTTPS, usuário, hash e senha de exclusão. O Compose define `NODE_ENV=production` e `DATA_DIR=/var/lib/flamez` dentro do container.
2. Execute `docker compose build` e `docker compose up -d`.
3. Use Nginx e HTTPS na frente de `127.0.0.1:5177`, como no roteiro anterior.
4. Para backup, pare o serviço e use `docker compose run --rm --no-deps flamez npm run backup`; depois inicie novamente. O arquivo gerado fica no volume de dados: copie-o para um destino externo.
5. Na migração inicial, restaure o backup no volume antes de começar a usar. Exemplo: `docker compose run --rm --no-deps -v /caminho/backup.json:/tmp/backup.json:ro flamez npm run restore -- /tmp/backup.json --confirm`. Não rode simultaneamente a instalação systemd e o container contra os mesmos dados.

O Compose permite 40 segundos para finalizar gravações ao parar, limita logs e usa sistema de arquivos somente leitura fora do volume persistente e `/tmp`. Confira a configuração sem imprimir segredos com `docker compose config --quiet`. Após criar o diretório de backups no volume ou restaurar os dados, execute `docker compose run --rm --no-deps flamez npm run preflight`. Quando o proxy estiver no host, descubra seu IP visto pelo container antes de configurar `TRUSTED_PROXY_IPS`; não copie automaticamente o loopback do exemplo systemd.

**Não execute `docker compose down -v` em uma instalação com dados reais:** essa opção remove o volume. Atualizar a imagem não exige remover o volume.

Os exemplos foram preparados e revisados no projeto; a publicação, certificados, permissões e persistência devem ser validados no plano e servidor escolhidos.

### Reconhecimento por IP

O exemplo acima confia apenas no Nginx local. O encaminhamento já está definido em `deploy/nginx.conf.example`. Em hospedagem gerenciada ou Docker, confirme o endereço real do proxy visto pelo Node e ajuste `TRUSTED_PROXY_IPS`. Sem proxy configurado, requisições encaminhadas continuam aceitando login por senha, mas não são autorizadas automaticamente pelo IP do proxy. Nunca confie em todos os IPs.

O arquivo `access.local.json` contém o histórico e as permissões por IP e é incluído nos novos backups. Ao migrar manualmente, você pode deixar esse arquivo de fora para exigir novamente quatro logins corretos no destino.
## Sessão Bambu persistente

O monitoramento restaura automaticamente a sessão de `DATA_DIR`. Preserve esse diretório em disco/volume persistente entre publicações. A sessão criptografada (`bambu-session.local.json`) depende da chave privada (`bambu-session.key`) no mesmo diretório. Nunca publique esses arquivos. Para migrar a sessão local, transfira os dois com segurança; ou faça uma nova conexão Bambu após hospedar. O backup de gestão não inclui essas credenciais. Expiração/revogação pela Bambu exige novo código.

## Antes de usar a hospedagem de verdade

- Configurar VPS/plano compatível, domínio, DNS, HTTPS e variáveis privadas.
- Restaurar e conferir os registros, imagens, histórico diário e horas das máquinas.
- Reiniciar o serviço e confirmar que registros e conexão Bambu permanecem disponíveis.
- Testar login, salvamento, estoque, conclusão de uma impressão e uma restauração em ambiente isolado.
- Conferir backups automáticos, organizar cópia fora da VPS e acompanhar espaço livre.
- Parar a instalação antiga quando o servidor hospedado assumir o acompanhamento, evitando dois bancos independentes divergindo.

O projeto mantém JSON para preservar as funcionalidades atuais. Para múltiplas instâncias ou armazenamento efêmero, será necessária uma migração própria para banco de dados. Este preparo não publica o site nem configura automaticamente sua conta Hostinger.
