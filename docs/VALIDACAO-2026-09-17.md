# Validação funcional — 17/09/2026

Resultado: **80 testes aprovados, zero falhas, zero ignorados**. A suíte anterior tinha 52 testes; foram acrescentados 28 casos/subtestes. A contagem inclui o teste agregador de persistência e seus subtestes.

## Falhas reproduzidas e corrigidas

1. Editar informações de uma produção automática em andamento marcava o resultado como manual e impedia a conclusão automática. Agora somente a alteração do status ou um bloqueio manual anterior preserva essa decisão.
2. Na falha automática de uma produção com dados preenchidos, o consumo útil podia permanecer positivo e o custo não refletir o desperdício real. O resultado agora usa o cálculo de falha: consumo útil zero e custo proporcional ao material efetivamente desperdiçado.
3. Em lotes com uma impressão concluída e outra falha, o status global Parcial aplicava o mesmo cálculo a todos os itens. Agora cada item usa o resultado de sua impressora, mantendo o lote como Parcial.
4. Ao editar o produto durante uma impressão automática, a telemetria podia restaurar o SKU reconhecido pelo nome do arquivo. O produto selecionado e a quantidade agora são preservados.

Também ajustado o seletor de filamento: medição no navegador confirmou **43 px**, igual ao campo SKU, com a mesma largura da coluna.

## Execuções

- npm run check: 53 arquivos JavaScript com sintaxe válida.
- npm test: 80 testes aprovados.
- git diff --check: sem erros de espaços; apenas avisos do Git sobre conversão LF/CRLF.
- Navegador em cópia isolada na porta 5178, usando dados fictícios; nenhuma alteração de cadastro foi testada na base real.

## Validação de interface

| Fluxo executado | Resultado observado |
|---|---|
| Material: editar quantidade 2,5 → 7,5 e salvar | Retorna ao cartão, exibe quantidade, observação e botão de compra |
| Estoque de produtos: Branco 4 → 8, Preto 6 | Total 14 e retorno ao resumo com botão de alterações |
| Produção concluída → Falhou, 0,50 h e 20 g | Salva; custo de filamento R$ 2,00 e máquina R$ 0,65 |
| Trocar Produção → Máquinas → Produção | Falhou e custos permanecem; recarga também preservou valores |
| Selecionar A01-1 na edição | Preenche 12 unidades e 2,50 horas |
| Criar novo padrão do A01 | Gera A01-2, com 6 unidades e 1,25 horas, dentro de Produtos |
| Painel mensal | Custos, desperdício e horas conferem com a produção fictícia |
| Gráfico de máquinas: horas → custo | Altera total de 0,50 h para R$ 0,65 |
| Cadastrar gasto com 12,34 | Exibe R$ 12,34 e um gasto registrado |
| Todas as dez áreas laterais | Carregam sem erro de interface |
| Produção automática e Log sem conexão | Exibem estados vazios e orientação de conexão |
| Largura móvel 390 px: painel, estoques e produção | Sem transbordamento horizontal da página |
| Seletores de SKU e filamento | Ambos medidos com 43 px de altura |
| Console das telas visitadas | Nenhum erro ou aviso capturado |

## Casos automatizados, um por um

1. PASSOU — login ignora maiúsculas e minúsculas, mas exige os mesmos caracteres
2. PASSOU — IP é liberado após quatro logins corretos e continua salvo após reiniciar
3. PASSOU — contagem simultânea é preservada e proxies precisam de configuração explícita
4. PASSOU — produção automática reconhece SKU normal e cópias numeradas do mesmo arquivo
5. PASSOU — produção automática preserva nomes de arquivos sem SKU cadastrado
6. PASSOU — dados de uma produção automática sem SKU podem ser completados e salvos
7. PASSOU — trocar o produto de uma produção automática usa o cadastro selecionado
8. PASSOU — log automático agrupa itens por dia e mantém os mais recentes primeiro
9. PASSOU — campos de horas mostram duas casas e aceitam ponto ou vírgula
10. PASSOU — materiais validam quantidade decimal e unidade
11. PASSOU — falha registra consumo real mesmo acima da previsão e recalcula custo
12. PASSOU — material aceita foto e link de compra e rejeita links executáveis
13. PASSOU — cloud discovery preserves existing finance and uniquely links names without duplicates
14. PASSOU — automatic cloud production is created on start, records errors and finishes with observed time
15. PASSOU — finished job counts physical hours once, completes bound production and deducts stock once
16. PASSOU — old finish, pauses, lost connection and errors cannot create fictional runtime or finish a new job
17. PASSOU — report parser accepts error-only updates and clears resolved alerts
18. PASSOU — multiple SKUs share job hours and 100 percent alone does not finish a production
19. PASSOU — FAILED records actual observed hours and defaults to full waste; a later waste correction restores stock
20. PASSOU — manual failed outcome and waste survive subsequent cloud finish reports
21. PASSOU — automatic finalization is immutable on repeated reports and after restart
22. PASSOU — manual reopening cannot be completed again by old cloud reports or ledger
23. PASSOU — editing metadata during an active automatic print does not disable completion
24. PASSOU — cloud updates preserve a product selected manually while a print is active
25. PASSOU — repeated automatic alerts never duplicate observation lines
26. PASSOU — mixed results charge actual failed consumption instead of the full planned amount
27. PASSOU — automatic failure uses real failed consumption for previously completed input data
28. PASSOU — dependência MQTT ausente retorna diagnóstico de instalação sem expor a sessão
29. PASSOU — telemetria parcial preserva dados e troca de trabalho remove valores anteriores
30. PASSOU — conexão Bambu recebe somente relatórios, protege credenciais e expira dados
31. PASSOU — bloqueio da Bambu é informado sem tentar contornar a proteção
32. PASSOU — envio de código aceita sucesso vazio, mas login exige dados
33. PASSOU — página HTML e JSON inválido não são confundidos com código enviado
34. PASSOU — descoberta automática adiciona e salva impressoras, mantém telemetria e preserva histórico ao remover
35. PASSOU — identifica A1 Combo por AMS recebido e preserva nomes personalizados
36. PASSOU — AMS presence bits identify Combo without a detailed inventory
37. PASSOU — explicit absence overrides leftover slots and corrects a saved Combo model
38. PASSOU — sessão criptografada restaura após reinício e desconectar remove acesso salvo
39. PASSOU — 15 horas desde 15h dividem 9h e 6h em Brasília, independente do fuso do servidor
40. PASSOU — horas diárias persistem sem duplicar; pausas, falha, interrupção e reinício são tratados
41. PASSOU — gastos preservam observações e normalizam reais sem perder centavos
42. PASSOU — categorias de gastos validam novas opções e preservam categorias anteriores
43. PASSOU — manutenção vence em 400 horas desde a última referência
44. PASSOU — configuração bloqueia publicação sem credenciais e dados expostos
45. PASSOU — dados corrompidos não são substituídos por cadastros vazios
46. PASSOU — backup íntegro, restauração e exclusividade do diretório
47. PASSOU — HTTP: login, proteção de API, CSRF, limites, dados privados e logout
48. PASSOU — produção movimenta estoque e horas sem duplicar baixas
49. PASSOU — transição Em produção → Em produção: cálculo e repetição sem duplicação
50. PASSOU — transição Em produção → Concluída: cálculo e repetição sem duplicação
51. PASSOU — transição Em produção → Parcial: cálculo e repetição sem duplicação
52. PASSOU — transição Em produção → Falhou: cálculo e repetição sem duplicação
53. PASSOU — transição Concluída → Em produção: cálculo e repetição sem duplicação
54. PASSOU — transição Concluída → Concluída: cálculo e repetição sem duplicação
55. PASSOU — transição Concluída → Parcial: cálculo e repetição sem duplicação
56. PASSOU — transição Concluída → Falhou: cálculo e repetição sem duplicação
57. PASSOU — transição Parcial → Em produção: cálculo e repetição sem duplicação
58. PASSOU — transição Parcial → Concluída: cálculo e repetição sem duplicação
59. PASSOU — transição Parcial → Parcial: cálculo e repetição sem duplicação
60. PASSOU — transição Parcial → Falhou: cálculo e repetição sem duplicação
61. PASSOU — transição Falhou → Em produção: cálculo e repetição sem duplicação
62. PASSOU — transição Falhou → Concluída: cálculo e repetição sem duplicação
63. PASSOU — transição Falhou → Parcial: cálculo e repetição sem duplicação
64. PASSOU — transição Falhou → Falhou: cálculo e repetição sem duplicação
65. PASSOU — relatórios diário e mensal concordam em custos, peças e desperdício
66. PASSOU — custo de máquina e manutenção nos limites do ciclo
67. PASSOU — persistência isolada: cadastros, alterações, exclusões e status ao recarregar
68. PASSOU — materiais: foto, link, atualização decimal, recarga e exclusão
69. PASSOU — padrões: concorrência, edição, persistência e referência ao produto
70. PASSOU — estoque de produtos: quantidades por cor, recarga e edição
71. PASSOU — produção: concluir, falhar, reler de disco e preservar desperdício
72. PASSOU — online snapshot verifies all business records and excludes Bambu credentials
73. PASSOU — retention removes only old automatic backups and scheduler prevents overlap
74. PASSOU — hosting configuration validates backup settings and preflight uses no secret output
75. PASSOU — entregas parciais acumulam, preservam datas e não duplicam tentativas
76. PASSOU — entregas rejeitam quantidade excedente, data inválida e encomenda cancelada
77. PASSOU — estoque por cor soma as quantidades e preserva o legado
78. PASSOU — estoque por cor rejeita cores repetidas, quantidades e fotos inválidas
79. PASSOU — padrões recebem sequência por SKU e mantêm código na edição
80. PASSOU — padrões rejeitam produto inválido, quantidades fracionadas e horas inválidas

## Limites da validação

Esta é uma auditoria ampla, não uma garantia de ausência de todos os bugs possíveis. Os testes Bambu usam telemetria e serviços simulados; não foi iniciada, interrompida ou concluída uma impressão física, nem feito novo login externo com código real. AMS foi validado pelos cenários automatizados de presença, ausência explícita e telemetria incompleta. O modal de uma máquina conectada não foi validado visualmente com equipamento real nesta rodada. Fotos tiveram validação de dados, mas o envio de uma foto pelo seletor do sistema operacional não foi exercitado. Não houve teste prolongado de carga ou de dias de operação, nem publicação externa. As verificações móveis se limitaram às quatro telas indicadas. Os testes de backup/restauração e exclusão usam diretórios temporários.

As correções de cálculo valem para atualizações futuras. Registros históricos finalizados não foram recalculados automaticamente, para preservar ajustes manuais. O servidor principal não estava ouvindo na porta 5177 ao fim da auditoria; não foi iniciado automaticamente. Ao iniciar com npm start, carregará as correções.
