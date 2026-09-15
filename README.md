# Sistema Flamez

Sistema de gestão para produção em impressão 3D: produtos, custos, encomendas, filamentos, máquinas, estoque de produtos e indicadores. Interface em português, responsiva, com servidor Node.js e armazenamento persistente no servidor.

**O projeto está preparado para instalação; nenhuma publicação é feita automaticamente.** Não existe integração com Google Planilhas. Os links do Google Drive para baixar modelos STL/3MF continuam funcionando.

## Requisitos e execução local

- Node.js **22.16 ou superior**; use a versão 22 LTS atualizada na hospedagem.
- Um único processo do sistema por diretório de dados.
- Não há dependências de produção de terceiros.

```sh
npm ci
npm start
```

Abra `http://localhost:5177`. Sem configuração, o servidor aceita apenas conexões locais, mantém os arquivos de dados existentes e preserva a senha de exclusão `1234`.

Para configurar, copie `.env.example` para `.env`. O servidor carrega esse arquivo automaticamente. Não envie `.env`, senhas, backups ou dados da empresa ao GitHub.

## Funcionalidades

- **Produtos:** cadastro, nomes e variações, calculadora por lote, seleção de máquina para custo por hora, anúncios Shopee, observações e download de modelos do Drive.
- **Encomendas:** pedidos e acompanhamento das etapas, em cartões expansíveis.
- **Produção:** agrupamento por dia, produtos e produções avulsas, máquina, material, marca, cor, consumo, status e custos históricos.
- **Filamentos:** estoque, configurações por marca/modelo/linha/cor, parâmetros de impressão, fotos e Log de movimentações.
- **Máquinas:** aquisição, vida útil, manutenção, custo por hora, horas acumuladas e aviso a cada 350 horas desde a referência de manutenção.
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

Gere credenciais no computador ou servidor de confiança:

```sh
npm run credentials
```

O comando exibe uma senha aleatória de acesso, seu hash e uma senha de exclusão. Guarde as senhas em um gerenciador; configure apenas o hash em `AUTH_PASSWORD_HASH`. Não compartilhe essa saída. Você pode escolher o usuário e a senha de exclusão.

Em produção, a inicialização falha quando faltam as configurações obrigatórias. O login protege páginas e APIs; a sessão dura 8 horas e usa cookie HttpOnly, SameSite e Secure. Reiniciar o servidor encerra sessões. Há limite de tentativas de login, validação de origem nas gravações, limite de corpo de 4 MB e bloqueio de incorporação em outros sites. A senha de exclusão é conferida no servidor, nunca embutida no JavaScript público.

É uma aplicação privada para **um proprietário**, sem cadastro público, recuperação de senha por e-mail ou permissões por funcionário. Para trocar o acesso, gere novo hash, altere o ambiente e reinicie. No modo autenticado, os dados do servidor têm prioridade sobre o cache do navegador. Evite editar simultaneamente o mesmo registro em dois dispositivos: a última gravação prevalece.

## Dados, atualização e backup

A persistência continua em JSON, preservando a compatibilidade dos registros existentes:

| Arquivo | Conteúdo |
| --- | --- |
| `sheets.local.json` | Cadastros, produção, máquinas, estoques e Log |
| `product-costs.local.json` | Calculadora, anúncios, observações e configurações de produtos |
| `access.local.json` | IPs, contagem de logins corretos, autorizações e histórico recente de acesso |

O nome histórico `sheets` identifica a estrutura interna de dados; não representa conexão com um serviço externo. Os arquivos ficam em `DATA_DIR`; localmente, sem essa variável, permanecem na raiz do projeto. As fotos de filamentos são armazenadas junto dos dados. Arquivos de modelo permanecem no Google Drive e dependem das permissões do link.

As gravações usam arquivo temporário, sincronização e troca atômica por arquivo. Uma fila serializa alterações e uma trava impede duas instâncias no mesmo diretório. Arquivos corrompidos geram erro em vez de serem substituídos silenciosamente por dados vazios. Esta versão usa **um servidor e um disco persistente**; não está configurada para múltiplas réplicas ou banco gerenciado.

Com o servidor **parado** e `DATA_DIR` correto:

```sh
npm run backup
npm run restore -- /caminho/flamez-DATA.json --confirm
```

O backup reúne os arquivos de cadastros, custos e acessos com checksum. Backups antigos sem acessos continuam aceitos e reiniciam as autorizações por IP. A restauração valida o backup e guarda cópia dos arquivos anteriores em `DATA_DIR/backups/antes-restauracao-*`. A trava recusa backup/restauração enquanto o sistema está em execução. O checksum detecta corrupção acidental; mantenha cópias em um destino confiável e separado da VPS. Esses comandos não criam agendamento automático.

Antes de atualizar: finalize os salvamentos, pare o serviço, faça backup e atualize somente o código. Preserve `DATA_DIR`, ambiente e backups. Para transferir dados deste computador, aguarde os salvamentos da calculadora e copie os dois arquivos com o servidor parado. Nunca sobrescreva dados reais com arquivos vazios de uma instalação nova.

## Verificações

```sh
npm run check
npm test
```

Os testes usam diretórios temporários, sem alterar os registros reais. Cobrem consumo e estorno de filamento, horas, repetição de salvamentos, concorrência, proteção de login/API, origem, limites, dados privados, backup e restauração. O GitHub Actions executa as verificações em Node 22.

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

O acesso único desta instalação foi configurado como `Flamez3D` em `.env`, com a senha armazenada somente como hash. As credenciais não são incluídas no GitHub: configure-as também ao transferir para hospedagem.

Usuário e senha de acesso aceitam letras maiúsculas ou minúsculas; os demais caracteres precisam corresponder. O botão de olho permite mostrar ou ocultar a senha digitada. Gere os hashes usando a versão atual de `npm run credentials`, que aplica essa mesma regra antes de calcular o hash. Hashes antigos, gerados com letras maiúsculas antes dessa alteração, precisam ser regenerados.

Com `AUTO_LOGIN_BY_IP=true`, o quarto login com senha correta autoriza esse IP a entrar automaticamente nos próximos acessos. Falhas, atualização da página, reaproveitamento de sessão e entradas automáticas não aumentam a contagem. O botão **Acessos** mostra IP, quantidade de logins, último acesso e histórico, e permite revogar o reconhecimento. Revogar um IP encerra suas sessões; mudar as credenciais invalida as autorizações antigas. **Sair** abre a tela de senha sem entrar automaticamente de novo naquele momento.

O IP público pode ser compartilhado por vários computadores. Nesse caso, o reconhecimento libera a mesma rede, não um dispositivo específico. Um IP dinâmico pode ser atribuído a outra pessoa posteriormente. Para exigir senha, desative `AUTO_LOGIN_BY_IP` ou revogue os acessos.

Atrás de Nginx, configure `TRUSTED_PROXY_IPS` com os IPs exatos do proxy controlado e mantenha o Node inacessível diretamente pela internet. O servidor aceita apenas o último endereço acrescentado a `X-Forwarded-For` por esse proxy. Cabeçalhos de encaminhamento sem proxy configurado não contam para liberar entrada automática. Em Docker, use o IP do proxy visto pelo container, não presuma que seja `127.0.0.1`.

`access.local.json` não é público e não é versionado. O histórico mantém os últimos 1.000 eventos (até 100 exibidos em Acessos); senhas e tokens não são gravados no histórico.
