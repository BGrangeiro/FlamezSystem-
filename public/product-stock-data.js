const invalid = message => Object.assign(new Error(message), {statusCode:400});
export function stockColors(data = {}) {
  if (data.Cores) {
    const colors=JSON.parse(data.Cores);
    if(!Array.isArray(colors))throw invalid('Lista de cores inválida.');
    return colors;
  }
  const quantity=Number(data.Quantidade||0);
  if(!Number.isSafeInteger(quantity)||quantity<0)throw invalid('Quantidade de estoque inválida.');
  return quantity>0?[{color:'Sem cor definida',quantity}]:[];
}
export function normalizeProductStock(data, previous = {}) {
  let colors;
  try {colors=stockColors({...previous,...data});} catch {throw invalid('Lista de cores inválida.');}
  if(colors.length>100)throw invalid('Use até 100 cores por produto.');
  const seen=new Set();let total=0;
  colors=colors.map(item=>{
    if(!item || typeof item!=='object')throw invalid('Cor inválida.');
    const color=String(item.color||'').trim().replace(/\s+/g,' '),quantity=Number(item.quantity);
    if(!color||color.length>80)throw invalid('Informe um nome de cor com até 80 caracteres.');
    const key=color.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    if(seen.has(key))throw invalid('Esta cor já foi adicionada. Ajuste a quantidade na linha existente.');
    if(item.quantity===''||!Number.isSafeInteger(quantity)||quantity<0)throw invalid('Informe uma quantidade inteira maior ou igual a zero para cada cor.');
    seen.add(key);total+=quantity;return {color,quantity};
  });
  if(!Number.isSafeInteger(total))throw invalid('Quantidade total acima do limite permitido.');
  const photo=data.Foto ?? previous.Foto ?? '';
  if(photo && (typeof photo!=='string'||photo.length>2000000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)))throw invalid('Foto inválida. Escolha uma imagem JPG, PNG ou WebP.');
  const standalone=String(data.Avulso ?? previous.Avulso ?? '')==='true';
  const product=String(data.Produto ?? previous.Produto ?? '').trim().replace(/\s+/g,' ');
  if(standalone&&(!product||product.length>160))throw invalid('Informe o nome do produto avulso com até 160 caracteres.');
  return {SKU:standalone?'':String(data.SKU||previous.SKU||'').trim(),Produto:standalone?product:'',Avulso:standalone?'true':'',Quantidade:String(total),Cores:JSON.stringify(colors),Foto:photo};
}
