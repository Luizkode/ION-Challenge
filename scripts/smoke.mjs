import assert from 'node:assert/strict';
const base=process.env.SMOKE_URL??'http://127.0.0.1:3000';
const login=await fetch(base+'/login');assert.equal(login.status,200);const html=await login.text();assert(html.includes('ION'));assert(html.includes('Entre na competição'));assert.equal(login.headers.get('x-frame-options'),'DENY');
for(const path of ['/','/admin','/meetings','/validation','/history']){const r=await fetch(base+path,{redirect:'manual'});assert.equal(r.status,307,path+' must require authentication');assert.equal(new URL(r.headers.get('location'),base).pathname,'/login');}
console.log('HTTP aprovado: login renderizado, headers de segurança e 5 rotas protegidas.');
