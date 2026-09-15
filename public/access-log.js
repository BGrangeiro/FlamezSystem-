const el=(tag,cls='',text='')=>{const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;};
export async function showAccessLog(api) {
  const dialog=el('dialog','access-dialog');dialog.setAttribute('aria-label','Acessos ao sistema');
  const header=el('div','access-header');header.append(el('h2','','Acessos ao sistema'));
  const close=el('button','ghost-light-button','Fechar');close.type='button';close.onclick=()=>dialog.close();header.append(close);
  const body=el('div','access-body','Carregando acessos…');
  dialog.append(header,el('p','access-description','Após 4 entradas com senha correta, o IP pode entrar automaticamente. Você pode revogar esse acesso a qualquer momento.'),body);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
  const draw=async()=>{
    try {
      const data=await api('/api/auth/accesses');if(!dialog.isConnected)return;body.replaceChildren();
      for(const record of data.addresses){
        const card=el('div','access-ip'),summary=el('div');summary.append(el('strong','',record.ip),el('p','',`${record.passwordLogins} de 4 entradas · ${record.trusted?'Entrada automática ativa':'Senha necessária'}`),el('small','',`Último acesso: ${new Date(record.lastLoginAt).toLocaleString('pt-BR')}`));card.append(summary);
        if(record.trusted){const revoke=el('button','ghost-light-button','Revogar acesso');revoke.type='button';revoke.onclick=async()=>{revoke.disabled=true;try{await api('/api/auth/revoke-ip',{method:'POST',body:JSON.stringify({ip:record.ip})});await draw();}catch(e){revoke.disabled=false;revoke.textContent=e.message;}};card.append(revoke);}body.append(card);
      }
      if(!data.addresses.length)body.append(el('p','','Nenhuma entrada com senha correta registrada.'));
      body.append(el('h3','','Histórico recente'));
      const list=el('div','access-events');
      for(const event of data.events){const method=event.method==='automatic'?'Entrada automática':event.method==='revoked'?'Acesso revogado':event.success?'Login com senha':'Tentativa recusada';list.append(el('p','',`${new Date(event.at).toLocaleString('pt-BR')} · ${event.ip} · ${method}`));}
      body.append(list);
    }catch(e){body.textContent=e.message;}
  };
  await draw();
}
