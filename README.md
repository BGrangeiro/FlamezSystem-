# Sistema Flamez local

Sistema local e independente para controlar produtos, encomendas, produção, filamentos, máquinas e peças pelo navegador.

Os dados principais ficam salvos em `sheets.local.json`. Os cálculos e configurações locais dos produtos ficam em `product-costs.local.json`.

## Modo local

O sistema não depende mais do Google Sheets para abrir, criar, editar ou excluir registros. A antiga planilha foi usada apenas como importação inicial dos dados que já existiam.

No futuro, a integração com planilha pode voltar como importação/exportação, mas o sistema atual usa os arquivos locais como fonte principal.

## Como rodar

Requer Node.js 18 ou superior. Clone o repositório e entre na pasta do projeto.
Não há dependências externas para instalar.

```bash
npm start
```

Depois abra:

```text
http://localhost:5177
```

## O que já está pronto

- Leitura e escrita nas abas `Produtos`, `Encomendas`, `Produção`, `Filamentos`, `Máquinas` e `Peças de Reposição`.
- Aba `Encomendas` em cards, com nome da encomenda, cliente, itens, entrega, status do processo, cancelamento, valor, quantidades, canal, contato e observações.
- Encomendas salvas abrem em modo leitura pela seta; o formulário aparece só depois de clicar em `Fazer alterações`.
- Produtos com seta para abrir a calculadora local de custo unitário.
- Lista de produtos em quadrantes: nome/SKU, valor de venda, valor unitário, anúncio ativo, observações e botão da Shopee.
- Observações locais por produto, abertas pelo quadrante de observações e salvas automaticamente.
- Criação de variações de produto: escolha um produto original, copie os dados para uma nova linha e salve a variação.
- Variações não aparecem como novos cards; elas ficam dentro da seta do produto original, em `Selecionar versão`.
- Dentro de cada produto, a seta abre opções internas como `Calculadora` e `Anúncios Shopee`.
- Cálculo local de custo por lote: material com múltiplos filamentos/cores, depreciação, energia e outros gastos.
- Anúncios Shopee com kits padrão de 1, 2, 3 e 4 unidades, calculando custo, taxas estimadas, adicionais como brindes e lucro real.
- Dados principais salvos em `sheets.local.json`.
- Cálculos de produto salvos automaticamente no computador enquanto você digita, sem criar colunas extras.
- Espelho local no navegador para não perder alterações se apertar F5 antes do arquivo terminar de salvar.
- Inclusão, edição e exclusão de linhas direto pelo sistema local.
- Servidor local sem dependências externas de npm.

## Cálculo do valor unitário

O custo é calculado por lote e depois dividido pela quantidade produzida:

```text
valor unitário =
  (soma dos materiais usados no lote
  + (horas do lote * depreciação por hora)
  + (potência W / 1000 * horas do lote * valor do kWh)
  + outros gastos do lote)
  / quantidade feita no lote
  + outros gastos por item

soma dos materiais =
  soma de cada (valor do kg do filamento * gramas usadas / 1000)
```

A depreciação começa com `R$ 0,80` por hora, mas pode ser alterada por produto.

## Lucro dos anúncios Shopee

Cada anúncio usa o custo unitário salvo na calculadora:

```text
custo do kit = valor unitário * unidades do kit
adicionais = custos extras daquele anúncio, como brindes
taxas estimadas = vendido por - recebo da Shopee
lucro real = recebo da Shopee - custo do kit - adicionais
```

As informações dos anúncios também ficam só no computador.

## Registros de produção

Em Produção, use Nova produção para registrar a data, um ou mais produtos,
quantidades e desperdício adicional em gramas. O consumo por unidade vem dos
materiais da calculadora do produto, dividido pela quantidade do lote.
O custo considera os preços por kg de cada material e inclui o desperdício,
avaliado pelo preço médio ponderado dos materiais desse produto.

Os cards mostram data, filamento total, desperdício e custo de filamento.
A seta abre os detalhes em leitura; Fazer alterações abre a edição.
Cada item guarda os consumos e preços utilizados, preservando o histórico.
Itens editados em produto ou quantidade são recalculados com a calculadora atual.
Registros anteriores continuam disponíveis para consulta e edição.

## Custo das máquinas

A aba Máquinas permite informar nome, modelo, status, valor de aquisição,
vida útil estimada em horas, manutenção total estimada durante essa vida útil
e custo de funcionamento por hora (padrão: R$ 0,11/h, ou 11 centavos).

O custo total por hora ligada é calculado automaticamente:

```text
custo por hora = (valor de aquisição + manutenção estimada) / vida útil em horas
                + custo de funcionamento por hora
```

Informe vida útil maior que zero para obter o cálculo. Cadastros antigos continuam
disponíveis; os campos antigos Local e Observações são preservados nos dados.

## Arquivos de dados

Os arquivos locais abaixo não são versionados no GitHub. Em uma instalação
nova, o sistema inicia sem os registros da empresa e cria os arquivos de dados
automaticamente. Para transferir os registros existentes entre computadores,
copie `sheets.local.json` e `product-costs.local.json` separadamente, com o
servidor parado. Mantenha cópias de segurança desses dois arquivos.

- `sheets.local.json`: produtos, encomendas, produção, filamentos, máquinas e peças.
- `product-costs.local.json`: calculadora, anúncios Shopee, observações locais e variações.
- `config.local.json`: arquivo antigo de integração; não é mais necessário para o modo atual.

## Horas de uso das máquinas

Em Máquinas, informe diretamente as Horas de uso atuais. O sistema soma as horas
vinculadas às produções finalizadas. Editar ou excluir uma produção recalcula o
contador sem duplicar horas. A edição manual ajusta o total atual.

## Status da produção

- Em produção: horas pendentes, sem acrescentar ao contador da máquina.
- Concluída: desperdício zero e horas totais somadas à máquina.
- Parcial: informe os gramas descartados, limitados ao filamento total do item.
- Falhou: todo o filamento vira desperdício. Informe, em cada item, as horas
  realmente gastas até interromper; somente essas horas entram na máquina.

O desperdício é uma parte do filamento total, não um consumo adicional.
Os registros antigos sem status continuam contabilizados como concluídos para
preservar o histórico. As regras também se aplicam às produções avulsas.

## Painel do mês e manutenção

O Painel do mês, abaixo de Peças, permite selecionar o mês e consultar produções,
consumo, desperdício, custos e horas por máquina. Lotes em produção não entram
nos totais de consumo/custo/horas; a contagem de peças usa lotes concluídos.

Cada máquina tem data da última manutenção e barra de ciclo de 350 horas.
Sem data cadastrada, o primeiro ciclo considera as horas totais de uso.
Ao informar uma data passada, as horas registradas nos dias posteriores entram
no ciclo. Para registrar uma revisão realizada agora, use Registrar manutenção
hoje: a barra zera, mas as horas totais da máquina são preservadas.
O aviso de manutenção necessária aparece ao atingir 350 horas no ciclo.
