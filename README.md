# Sistema Flamez

Sistema de gestão para produção em impressão 3D: produtos, custos, encomendas, filamentos, máquinas, estoque de produtos e indicadores. Interface em português, responsiva, com servidor Node.js e armazenamento persistente no servidor.

**O projeto está preparado para instalação; nenhuma publicação é feita automaticamente.** Não existe integração com Google Planilhas. Os links do Google Drive para baixar modelos STL/3MF continuam funcionando.

## Hospedagem com banco SQLite

O [passo a passo para a VPS Hostinger](docs/HOSTINGER-PASSO-A-PASSO.md) inclui banco SQLite persistente, migração dos registros JSON, autenticação, HTTPS e backups. Execute `npm run hosting:package` para gerar o pacote de código sem dados privados. `npm run setup:production` cria credenciais e configuração para `compose.hostinger.yaml` sem sobrescrever configurações existentes.

Instalações sem configuração usam JSON. Nesta instalação local, os dados foram migrados e conferidos em SQLite em 17/09/2026; o `.env` privado seleciona `STORAGE_BACKEND=sqlite` e backups diários. Para migrar outra instalação, pare o servidor, faça backup, configure `DATA_DIR` e execute `npm run db:migrate -- --confirm`; depois use `STORAGE_BACKEND=sqlite`. O banco `DATA_DIR/flamez.sqlite3` guarda os registros de negócio, incluindo gastos e entregas parciais. Os comandos de backup/restauração funcionam com ambos os formatos; as exportações continuam em JSON. A sessão Bambu permanece em arquivos privados separados. Não alterne de volta para JSON depois de migrar: os JSON anteriores são apenas cópias históricas.

## Requisitos e execução local

- Node.js **22.16 ou superior**; use a versão 22 LTS atualizada na hospedagem.
- Um único processo do sistema por diretório de dados.
- A biblioteca MQTT.js recebe a telemetria opcional da Bambu Cloud.

```sh
npm ci
npm start
```

Abra `http://localhost:5177`. Sem configuração, o servidor aceita apenas conexões locais, mantém os arquivos de dados existentes e preserva a senha de exclusão `1234`.

Para configurar, copie `.env.example` para `.env`. O servidor carrega esse arquivo automaticamente. Não envie `.env`, senhas, backups ou dados da empresa ao GitHub.

## Funcionalidades

- **Custos da empresa:** gastos em cartões com descrição, valor, data, categoria e observações individuais. Use Novo gasto e Salvar gasto; a busca filtra os cartões e seu total. Os registros fazem parte dos backups em `sheets.local.json`.

### Monitoramento Bambu Cloud (experimental)

Na aba **Máquinas**, use **Conectar Bambu**. Informe o e-mail da conta Bambu e, depois, o código enviado pela Bambu. Esta implementação inicial atende contas globais (fora da China) com acesso por código de e-mail. A autenticação pode ser recusada pela Bambu; erros são exibidos sem contornar suas proteções. A compatibilidade real com sua conta e firmware precisa ser validada.

O servidor local recebe relatórios pela nuvem, sem computador junto das impressoras e sem Bambu Studio aberto. Os cartões mostram progresso, tempo restante, status e as temperaturas atuais do bico e da mesa, quando informados. O botão **+** abre os demais dados disponíveis, como temperaturas-alvo, camadas, etapa, velocidade, sinal Wi-Fi, ventiladores e AMS. Campos ausentes no modelo, firmware ou relatório não são inventados. Impressoras devem permanecer conectadas à Bambu Cloud, e não em modo LAN-only. É necessário acesso de saída HTTPS e MQTT TLS na porta 8883.

A sessão Bambu é salva com AES-256-GCM em `DATA_DIR/bambu-session.local.json`; a chave aleatória fica em `DATA_DIR/bambu-session.key`, com permissão restrita no servidor. Senha e código de e-mail não são armazenados. O token não é enviado ao navegador. Ao reiniciar o servidor, a conexão é restaurada; se expirar ou for revogada, será necessário autenticar novamente. Desconectar remove a sessão salva. Esses dois arquivos são privados e não entram no Git nem no backup de gestão: para migrar a sessão, transfira ambos por um meio seguro; alternativamente, conecte novamente no novo servidor. Na hospedagem, preserve o volume `DATA_DIR` entre reinícios e publicações. O painel marca dados sem atualização por mais de dois minutos como desatualizados. Usa uma conexão MQTT por conta, com intervalo de reconexão de um minuto.

O monitor solicita um relatório de status ao conectar e a cada minuto, além de receber atualizações espontâneas. A tela consulta o servidor a cada cinco segundos e retoma a consulta ao recuperar a internet ou voltar à janela. Não envia comandos para controlar impressões. As automações de gestão descritas abaixo atualizam cadastros, produção e estoque local. A resposta depende da disponibilidade da Bambu e da impressora. Utiliza protocolo comunitário, sem garantia de estabilidade da Bambu. Referências: [configuração](https://docs.page/greghesp/ha-bambulab/setup) e [campos disponíveis](https://docs.page/greghesp/ha-bambulab/entities).

Na aba **Produção**, o painel **Produção automática** mostra em tempo real o arquivo, a máquina, o progresso, o tempo restante e a camada. O nome do arquivo é comparado aos SKUs cadastrados: `A01.3mf`, `A01(02).3mf` e `A01 (12).3mf` são identificados como o mesmo SKU `A01`. Arquivos sem correspondência continuam visíveis com o nome original e a indicação de que não possuem SKU reconhecido.

Quando um trabalho começa, a integração cria imediatamente um registro destacado em **Produção registrada**. O registro acompanha o status Em produção, Concluída ou Falhou, as horas observadas e a máquina. Quantidade, filamento e desperdício ficam pendentes quando a impressora não fornece esses dados. Alertas recebidos são gravados nas observações e nas ocorrências com data e hora de Brasília. O **Log automático** agrupa os trabalhos por dia e preserva arquivo, SKU reconhecido, máquina, duração, início, término e resultado.

### Detecção de impressoras e histórico diário

A lista da conta Bambu é consultada a cada minuto. Novas impressoras são salvas na sessão criptografada e incluídas no monitoramento automaticamente, identificadas pelo número de série. Alterações de nome são atualizadas sem perder o histórico; remover uma impressora da conta não exclui seus registros anteriores. Essa detecção alimenta Bambu Cloud, Log e **Máquinas cadastradas**. Um cadastro existente com nome exatamente igual e único é vinculado, preservando seus valores; caso contrário, é criado um cadastro. Valores financeiros desconhecidos permanecem vazios e o ícone vermelho informa os campos pendentes.

### Automação de máquinas e produções

O servidor mantém em `sheets.local.json` um registro persistente de cada impressão acompanhada. Ao receber FINISH ou FAILED, soma o tempo RUNNING observado ao total de uso e ao ciclo de manutenção de 400 horas. Pausas e intervalos sem telemetria não são estimados. Impressões que começaram antes do acompanhamento têm somente as horas observadas registradas. Repetição do relatório e reinício não duplicam horas. Apagar uma produção manual estorna suas horas como antes; apagar uma produção vinculada não apaga o uso físico já registrado pela Bambu.

Ao salvar uma nova produção **Em produção** com uma máquina integrada, ela é vinculada à impressão atual (se recente) ou à próxima impressão iniciada. Apenas uma produção em andamento por máquina pode ser vinculada. Um relatório antigo de conclusão não finaliza um cadastro novo. O estado FINISH confirma o término; percentual 100 isolado não é suficiente. Quando todas as impressões vinculadas terminam com sucesso, o sistema conclui a produção, usa as horas acompanhadas para os custos e executa a baixa de filamento existente, sem duplicação. Vários SKUs no mesmo trabalho repartem suas horas proporcionalmente às horas previstas. Estoque insuficiente bloqueia a baixa e exibe uma pendência na produção; as horas físicas continuam preservadas.

Alertas `print_error`, `mc_print_error_code`, HMS, pausas e interrupções ficam em **Ocorrências da impressora**, com o horário de recebimento em Brasília e o código fornecido. Referência dos campos: [código-fonte oficial do Bambu Studio](https://github.com/bambulab/BambuStudio/blob/master/src/slic3r/GUI/DeviceManager.cpp). Não se presume um diagnóstico quando a Bambu informa apenas um código. Pausas não mudam para Falhou: uma impressão pode continuar depois de trocar o filamento. Quando a Bambu informa FAILED, o sistema registra a interrupção, marca Falhou e usa 100% de desperdício previsto por padrão, mantendo o botão Ajustar para corrigir a quantidade real; as horas vêm da telemetria acompanhada. Se uma produção reúne impressões de várias máquinas, aguarda todas terminarem e marca Parcial quando houver resultados mistos. Produções antigas não são vinculadas retroativamente; salvar uma delas em andamento habilita o vínculo. Os painéis de produção e máquinas cadastradas se atualizam a cada 10 segundos, sem substituir formulários em edição.

O botão **i** de cada cartão exibe somente hoje e ontem. A aba **Log** permite expandir cada impressora para consultar todos os dias desde sua detecção. Os intervalos são separados à meia-noite em `America/Sao_Paulo`, independentemente do fuso do servidor: 15 horas iniciadas às 15h resultam em 9h no primeiro dia e 6h no seguinte.

As horas são estimadas a partir dos estados recebidos: `RUNNING` soma impressão, `PAUSE` fica separado. Relatórios repetidos não duplicam horas; intervalos sem comunicação por mais de dois minutos, reconexões e reinícios não são extrapolados. O histórico começa com o monitoramento, sem recuperar retroativamente impressões antigas. O servidor precisa permanecer ligado para acompanhar os intervalos. O relatório sinaliza períodos sem dados.

O arquivo `DATA_DIR/bambu-usage.local.json` guarda os totais por dia, não credenciais, e está incluído no backup de gestão. Preserve `DATA_DIR` na hospedagem. Backups antigos sem esse histórico preservam o arquivo existente ao restaurar. O fechamento de um dia não requer a interface aberta: acontece pela divisão dos intervalos e os registros permanecem disponíveis no Log.

### Gestão

- **Produtos:** cadastro, nomes e variações, calculadora por lote, seleção de máquina para custo por hora, anúncios Shopee, observações e download de modelos do Drive.
- **Encomendas:** pedidos e acompanhamento das etapas, em cartões expansíveis.
- **Produção:** agrupamento por dia, produtos e produções avulsas, máquina, material, marca, cor, consumo, status e custos históricos.
- **Filamentos:** estoque, configurações por marca/modelo/linha/cor, parâmetros de impressão, fotos e Log de movimentações.
- **Máquinas:** aquisição, vida útil, manutenção, custo por hora, horas acumuladas e aviso a cada 400 horas desde a referência de manutenção.
- **Estoque de produtos:** cartão por SKU com foto, total calculado e quantidades por cor em uma seção expansível. Os ajustes são manuais; salve cores e foto em Salvar estoque. Quantidades antigas ficam como Sem cor definida até serem distribuídas.
- **Relatório diário e Painel do mês:** gráficos, custos, desperdício, horas por máquina, comparações e projeções.

### Produção, estoque e horas

Selecione o filamento existente no estoque, com marca e cor cadastradas, e informe os gramas previstos por item. O preço por kg usado no cadastro vem desse filamento.

| Status | Estoque de filamentos | Horas da máquina |
| --- | --- | --- |
| Em produção | Não movimenta nem reserva saldo | Não soma |
| Concluída | Desconta o consumo total; desperdício zero | Soma o tempo informado |
| Parcial | Desconta o total, incluindo a parte descartada | Soma o tempo informado |
| Falhou | Desconta o desperdício efetivo; por padrão, 100% do previsto | Soma o tempo efetivo; pode ser ajustado |

Exemplo: 1 kg menos 300 g deixa 0,700 kg. Se a falha consumiu apenas 40 g, a baixa é de 0,040 kg e o saldo fica em 0,960 kg.

Ajustar, reabrir ou excluir uma produção registra a diferença como baixa/estorno no Log. Repetir um salvamento não desconta novamente. Saldo insuficiente impede a gravação. Exclusões exigem a senha de confirmação e recalculam também as horas. Produções antigas sem vínculo com o estoque não geram baixas retroativas automaticamente; complete o vínculo ao editá-las.

O desperdício é uma parte do total, não um consumo adicional. O estoque de produtos acabados permanece manual. As horas são atribuídas à data registrada na produção, sem divisão automática entre dias.

### Cálculos

```text
Custo da máquina por hora =
  (valor de aquisição + manutenção estimada) / vida útil em horas
  + custo de funcionamento por hora

Custo do filamento = gramas consumidos / 1000 × preço do kg

Custo unitário do produto =
  (materiais + horas × depreciação/h + energia + outros custos do lote)
  / quantidade do lote + outros custos por item
```

Selecionar uma máquina na calculadora preenche o custo por hora; o campo também aceita valor manual. Esse valor é copiado no momento da seleção. O custo total da máquina já inclui funcionamento: confira o campo Energia para não contabilizar a mesma despesa duas vezes.

Custos e preços de produções salvas são históricos. O painel não calcula lucro real sem receitas; as projeções são estimativas baseadas no ritmo registrado, não garantias.

## Preparação para hospedagem

O sistema precisa de **Node.js executando o backend**. Enviar apenas `public/` a uma hospedagem estática ou PHP não é suficiente.

A Hostinger possui [opções de hospedagem Node.js](https://www.hostinger.com/support/node-js-hosting-options-at-hostinger/) e um [guia para aplicações Node.js](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/). Para esta versão, a opção documentada com controle do disco persistente é **VPS**. Em um plano gerenciado, confirme antes o suporte ao servidor Node personalizado, diretório gravável persistente entre implantações e uma única instância. Não use armazenamento temporário de build para os dados.

Consulte [o guia de instalação na Hostinger](docs/HOSTINGER.md) para configuração, transferência dos registros, HTTPS e manutenção.

### Variáveis de ambiente

| Variável | Uso |
| --- | --- |
| `NODE_ENV` | `development` local; `production` na hospedagem |
| `HOST` | Local: `127.0.0.1`; VPS com proxy: `127.0.0.1`; container/gerenciado: `0.0.0.0` |
| `PORT` | Porta do processo; padrão `5177` |
| `DATA_DIR` | Diretório de dados; **absoluto e obrigatório em produção**, fora de `public/` e da pasta substituída pelo deploy |
| `APP_ORIGIN` | Origem HTTPS exata em produção, ex.: `https://sistema.exemplo.com`, sem barra final |
| `AUTH_USERNAME` | Usuário proprietário do sistema |
| `AUTH_PASSWORD_HASH` | Hash scrypt gerado pelo comando abaixo; não é a senha em texto |
| `AUTO_LOGIN_BY_IP` | `true` permite entrada automática após 4 logins corretos do mesmo IP |
| `TRUSTED_PROXY_IPS` | IPs dos proxies reversos controlados; vazio ao acessar diretamente o Node |
| `PRODUCTION_DELETE_PASSWORD` | Senha independente para excluir produções; obrigatória em produção, mínimo 4 caracteres |
| `BACKUP_DIR` | Destino opcional do comando de backup; padrão `DATA_DIR/backups` |
| `BACKUP_INTERVAL_HOURS` | Intervalo do backup automático: 24 h em produção, desativado localmente; `0` desativa |
| `BACKUP_KEEP` | Quantidade de backups automáticos mantidos; padrão 30. Cópias manuais não são apagadas |

Gere credenciais no computador ou servidor de confiança:

```sh
npm run credentials
```

O comando exibe uma senha aleatória de acesso, seu hash e uma senha de exclusão. Guarde as senhas em um gerenciador; configure apenas o hash em `AUTH_PASSWORD_HASH`. Não compartilhe essa saída. Você pode escolher o usuário e a senha de exclusão.

Em produção, a inicialização falha quando faltam as configurações obrigatórias. O login protege páginas e APIs; a sessão dura 8 horas e usa cookie HttpOnly, SameSite e Secure. Reiniciar o servidor encerra sessões. Há limite de tentativas de login, validação de origem nas gravações, limite de corpo de 4 MB e bloqueio de incorporação em outros sites. A senha de exclusão é conferida no servidor, nunca embutida no JavaScript público.

É uma aplicação privada para **um proprietário**, sem cadastro público, recuperação de senha por e-mail ou permissões por funcionário. Para trocar o acesso, gere novo hash, altere o ambiente e reinicie. No modo autenticado, os dados do servidor têm prioridade sobre o cache do navegador. Evite editar simultaneamente o mesmo registro em dois dispositivos: a última gravação prevalece.

## Dados, atualização e backup

A persistência usa o backend selecionado em `STORAGE_BACKEND`. No SQLite, os quatro documentos de gestão abaixo ficam dentro de `flamez.sqlite3`; no modo JSON, são arquivos separados. As exportações e backups mantêm a compatibilidade entre ambos os formatos:

| Arquivo | Conteúdo |
| --- | --- |
| `sheets.local.json` | Cadastros, produção, máquinas, estoques e Log |
| `product-costs.local.json` | Calculadora, anúncios, observações e configurações de produtos |
| `access.local.json` | IPs, contagem de logins corretos, autorizações e histórico recente de acesso |
| `bambu-usage.local.json` | Horas diárias acompanhadas de cada impressora |
| `bambu-session.local.json` + `bambu-session.key` | Sessão Bambu criptografada e chave privada; fora do backup de gestão |

O nome histórico `sheets` identifica a estrutura interna de dados; não representa conexão com um serviço externo. Os arquivos ficam em `DATA_DIR`; localmente, sem essa variável, permanecem na raiz do projeto. As fotos de filamentos são armazenadas junto dos dados. Arquivos de modelo permanecem no Google Drive e dependem das permissões do link.

No modo JSON, as gravações usam arquivo temporário, sincronização e troca atômica por arquivo. No SQLite, os documentos relacionados são gravados em transação, com WAL e sincronização completa. Uma fila serializa alterações e uma trava impede duas instâncias no mesmo diretório. Dados corrompidos geram erro em vez de serem substituídos silenciosamente por registros vazios. Esta versão usa **um servidor e um disco persistente**; não está configurada para múltiplas réplicas ou banco gerenciado.

Com o servidor **parado** e `DATA_DIR` correto:

```sh
npm run backup
npm run restore -- /caminho/flamez-DATA.json --confirm
```

O backup reúne cadastros, custos, acessos e histórico diário Bambu com checksum. Backups antigos sem acessos continuam aceitos e reiniciam as autorizações por IP; sem histórico Bambu, preservam o arquivo existente. A restauração valida o backup e guarda cópia dos arquivos anteriores em `DATA_DIR/backups/antes-restauracao-*`. Os comandos manuais de backup/restauração exigem servidor parado. Para verificar uma cópia sem restaurar, use `npm run backup:verify -- CAMINHO`. O checksum detecta corrupção acidental; mantenha cópias também em destino confiável separado da VPS.

Em produção, o próprio servidor cria uma cópia ao iniciar (se já houver registros) e a cada 24 horas, sem interromper a Bambu Cloud. As gravações de negócio são serializadas com a captura. Apenas as 30 cópias automáticas mais recentes são mantidas, e a retenção só acontece depois de uma nova cópia verificada. Cópias manuais e cópias anteriores à restauração permanecem intactas. Os intervalos e a retenção são configuráveis. Falhas aparecem no log do serviço; `GET /api/system/status`, autenticado, informa o último backup bem-sucedido. Uma cópia local não substitui backup externo. Credenciais Bambu não entram nessas cópias.

Antes de atualizar: finalize os salvamentos, pare o serviço, faça backup e atualize somente o código. Preserve `DATA_DIR`, ambiente e backups. Para transferir dados deste computador, use o backup completo e siga a lista de arquivos no guia de hospedagem. Nunca sobrescreva dados reais com arquivos vazios de uma instalação nova.

## Verificações

```sh
npm run check
npm test
npm run preflight
```

Os testes usam diretórios temporários, sem alterar os registros reais. Cobrem consumo e estorno de filamento, horas, repetição de salvamentos, concorrência, proteção de login/API, origem, limites, dados privados, backup e restauração. O GitHub Actions executa as verificações em Node 22, auditoria de dependências e construção da imagem Docker. `preflight` deve rodar no servidor de destino, com o ambiente de produção carregado; verifica configuração, diretórios e escrita sem imprimir credenciais. No computador local é esperado que a configuração de desenvolvimento apareça como pendente para hospedagem.

`GET /healthz` é público e retorna apenas a disponibilidade do processo. Os logs operacionais saem no console e não devem conter credenciais ou registros completos.

## Estrutura

```text
public/          Interface, estilos e cálculos compartilhados
lib/             Configuração, autenticação, persistência e trava
scripts/         Verificação, credenciais, backup e restauração
tests/           Testes isolados
server.js        Servidor HTTP e regras dos cadastros
.env.example     Modelo de configuração, sem segredos
Dockerfile       Imagem opcional para VPS com Docker
compose.yaml     Serviço com volume persistente
deploy/         Exemplos de systemd e Nginx
docs/           Guia de instalação
```

A integração antiga do Apps Script, seu arquivo de configuração e a logo antiga sem uso foram removidos. As funcionalidades do Drive, Shopee e os dados atuais foram preservados.

## Login e reconhecimento por IP

O assistente de configuração de produção usa o usuário `Flamez3D` e armazena a senha somente como hash. As credenciais não são incluídas no GitHub: configure-as ao transferir para hospedagem. O modo local sem credenciais fica limitado a `127.0.0.1`.

Usuário e senha de acesso aceitam letras maiúsculas ou minúsculas; os demais caracteres precisam corresponder. O botão de olho permite mostrar ou ocultar a senha digitada. Gere os hashes usando a versão atual de `npm run credentials`, que aplica essa mesma regra antes de calcular o hash. Hashes antigos, gerados com letras maiúsculas antes dessa alteração, precisam ser regenerados.

Com `AUTO_LOGIN_BY_IP=true`, o quarto login com senha correta autoriza esse IP a entrar automaticamente nos próximos acessos. Falhas, atualização da página, reaproveitamento de sessão e entradas automáticas não aumentam a contagem. A interface não possui aba Acessos. As rotas administrativas autenticadas de consulta/revogação permanecem disponíveis; revogar um IP encerra suas sessões e mudar as credenciais invalida as autorizações antigas. **Sair** abre a tela de senha sem entrar automaticamente de novo naquele momento.

O IP público pode ser compartilhado por vários computadores. Nesse caso, o reconhecimento libera a mesma rede, não um dispositivo específico. Um IP dinâmico pode ser atribuído a outra pessoa posteriormente. Para exigir senha, desative `AUTO_LOGIN_BY_IP` ou revogue os acessos.

Atrás de Nginx, configure `TRUSTED_PROXY_IPS` com os IPs exatos do proxy controlado e mantenha o Node inacessível diretamente pela internet. O servidor aceita apenas o último endereço acrescentado a `X-Forwarded-For` por esse proxy. Cabeçalhos de encaminhamento sem proxy configurado não contam para liberar entrada automática. Em Docker, use o IP do proxy visto pelo container, não presuma que seja `127.0.0.1`.

`access.local.json` não é público e não é versionado. O histórico interno mantém os últimos 1.000 eventos; senhas e tokens não são gravados nesse histórico.
