const form=document.querySelector('#loginForm'),error=document.querySelector('#error');
const password=form.querySelector('#password'),togglePassword=form.querySelector('#togglePassword');
togglePassword.addEventListener('click',()=>{
  const visible=password.type==='password';
  password.type=visible?'text':'password';
  const label=visible?'Ocultar senha':'Mostrar senha';
  togglePassword.setAttribute('aria-label',label);
  togglePassword.setAttribute('aria-pressed',String(visible));
  togglePassword.title=label;
});
// Sair explicitamente mantém o formulário aberto, mesmo para um IP reconhecido.
const allowAutomatic=new URLSearchParams(location.search).get('manual')!=='1';
if(allowAutomatic){
  const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
  try {
    const response=await fetch('/api/auth/automatic',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    if(response.ok && (await response.json()).authenticated)location.replace('/');
  }catch { /* Uma falha de reconhecimento não impede a entrada por senha. */ }
  finally {submit.disabled=false;}
}
form.addEventListener('submit',async event=>{
  event.preventDefault();const button=form.querySelector('button[type="submit"]');button.disabled=true;error.textContent='';
  try {
    const response=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});
    const data=await response.json();if(!response.ok)throw new Error(data.message||'Não foi possível entrar.');
    location.replace('/');
  }catch(e){error.textContent=e.message;button.disabled=false;}
});
