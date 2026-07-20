/* ===== Complementos de pago (REP) — módulo autónomo para la app de Pagos =====
   Se carga con <script type="module" src="./rep.js"></script>.
   Agrega una pestaña "Complementos": sube el REP, lo lee, lo cruza con las facturas
   y verifica que los montos cuadren. Reutiliza el Firebase y el pdf.js de la app. */
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, getDocs, getDoc, setDoc, addDoc, doc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const _apps = getApps();
const _app = _apps.length ? _apps[0] : initializeApp({ apiKey:'AIzaSyCpFCqO25oDdBne1mOiJarY-ZEBBX0jOVk', authDomain:'bellissima-entradas.firebaseapp.com', projectId:'bellissima-entradas' });
const db = getFirestore(_app);

const money = n => '$'+(Number(n)||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
const num = s => parseFloat(String(s).replace(/,/g,''));
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

let REPS=[], FACTS=[], PAGOS=[], repPending=null;

/* ---------- Lectura del PDF ---------- */
async function textoPDF(file){
  let lib = window.pdfjsLib;
  if(!lib){ lib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js').then(()=>window.pdfjsLib); }
  if(lib.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const buf=await file.arrayBuffer();
  const pdf=await lib.getDocument({data:new Uint8Array(buf.slice(0))}).promise;
  let txt='';
  for(let p=1;p<=pdf.numPages;p++){ const pg=await pdf.getPage(p); const c=await pg.getTextContent(); for(const it of c.items) txt+=it.str+' '; txt+=' '; }
  return txt;
}

function leerREP(txt){
  const r={docs:[]};
  let m=txt.match(/Nombre\s*emisor\s*:?\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-z0-9 .,&]*?)\s+No\.?\s*de\s*serie/i);
  if(m) r.proveedor=m[1].trim();
  m=txt.match(/Folio\s*fiscal\s*:?\s*([0-9A-F-]{36})/i);
  r.folioFiscal = m?m[1].toUpperCase():'';
  m=txt.match(/(\d{4}-\d{2}-\d{2})[ T]?\d{0,2}:?\d{0,2}:?\d{0,2}\s+(?:Transferencia|Peso|Condonaci)/i) || txt.match(/(\d{4}-\d{2}-\d{2})/);
  if(m) r.fecha=m[1];
  // Documentos relacionados: UUID Serie Folio ... parcialidad saldoAnterior ... impPagado saldoInsoluto Síobjeto
  const re=/([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})\s+([A-Z]{1,4})\s+([0-9A-Za-z_-]+)\s+Peso\s*Mexicano\s+1\s+(\d+)\s+([\d,]+\.\d{2})[\s\S]*?([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+S[íi]/gi;
  const agg={}; let mm;
  while((mm=re.exec(txt))!==null){
    const uuid=mm[1].toUpperCase();
    if(uuid===r.folioFiscal) continue;
    if(!agg[uuid]) agg[uuid]={uuid, serie:mm[2], folio:mm[3], saldoAnterior:num(mm[5]), impPagado:0, saldoInsoluto:num(mm[7])};
    agg[uuid].impPagado += num(mm[6]);
    agg[uuid].saldoInsoluto = num(mm[7]);
  }
  r.docs=Object.values(agg);
  r.docs.forEach(d=>{ d.impPagado=Math.round(d.impPagado*100)/100; });
  r.montoTotal=Math.round(r.docs.reduce((s,d)=>s+d.impPagado,0)*100)/100;
  return r;
}

/* ---------- Datos ---------- */
async function cargarFacturas(){
  const out=[];
  const snap=await getDocs(collection(db,'ordenesCompra'));
  const totMan={}; try{ const t=await getDocs(collection(db,'facturasTotal')); t.forEach(d=>{ totMan[d.id]=d.data().total||0; }); }catch(e){}
  snap.forEach(d=>{ const o=d.data();
    (o.compras||[]).forEach(c=>{ if(!c.folio) return;
      let merc=0; (c.productosRecibidos||[]).forEach(p=>{ merc+=(p.importeTotal||0); });
      const tot = totMan[c.folio]>0 ? totMan[c.folio] : (Number(c.importeCompra)||0);
      out.push({folio:String(c.folio), proveedor:o.proveedor||'', total:tot, mercancia:Math.round(merc*100)/100});
    });
  });
  return out;
}
async function cargarPagos(){ const out=[]; try{ const s=await getDocs(collection(db,'pagos')); s.forEach(d=>{ const o=d.data(); o._id=d.id; out.push(o); }); }catch(e){} return out; }

/* Cruza un doc del REP con una factura del sistema */
function matchFactura(docREP){
  const pn = (docREP._prov||'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,6);
  let best=null;
  for(const f of FACTS){
    const fn = String(f.proveedor).toUpperCase().replace(/[^A-Z]/g,'').slice(0,6);
    const mismoProv = pn && fn && (pn===fn || fn.indexOf(pn)>=0 || pn.indexOf(fn)>=0);
    // el saldo anterior del REP = total de la factura
    const cuadraTotal = f.total>0 && Math.abs(f.total-docREP.saldoAnterior)<2;
    if(cuadraTotal && (mismoProv || !pn)){ best=f; break; }
    if(!best && cuadraTotal) best=f;
  }
  return best;
}
function pagosDe(folio){ let t=0; for(const p of PAGOS){ if(String(p.folio)===String(folio)) t+=Number(p.monto)||0; } return Math.round(t*100)/100; }

/* ---------- Adjuntos ---------- */
function b64(file){ return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>{ const s=String(fr.result); res(s.slice(s.indexOf(',')+1)); }; fr.onerror=()=>rej(new Error('No se pudo leer')); fr.readAsDataURL(file); }); }
const CH=700000;
async function guardarAdjunto(data,nombre){ if(!data) return null; const n=Math.ceil(data.length/CH); const ref=await addDoc(collection(db,'adjuntos'),{nombre:nombre||'rep.pdf',nChunks:n,ts:Date.now()}); for(let i=0;i<n;i++){ await setDoc(doc(db,'adjuntos',ref.id,'chunks',String(i)),{d:data.slice(i*CH,(i+1)*CH)}); } return ref.id; }
window.repVerAdjunto=async function(id){ try{ const meta=await getDoc(doc(db,'adjuntos',id)); if(!meta.exists()){ alert('No encontré el documento.'); return; } const m=meta.data(); let s=''; for(let i=0;i<m.nChunks;i++){ const d=await getDoc(doc(db,'adjuntos',id,'chunks',String(i))); if(d.exists()) s+=d.data().d; } const bin=atob(s), arr=new Uint8Array(bin.length); for(let k=0;k<bin.length;k++) arr[k]=bin.charCodeAt(k); const url=URL.createObjectURL(new Blob([arr],{type:'application/pdf'})); window.open(url,'_blank'); setTimeout(()=>URL.revokeObjectURL(url),60000); }catch(e){ alert('Error: '+e.message); } };

/* ---------- UI ---------- */
function verifDoc(d){
  const f=d._match;
  if(!f) return {cls:'b-warn', txt:'⚠ No encontré la factura', pag:0};
  const pag=pagosDe(f.folio);
  if(pag<=0) return {cls:'b-warn', txt:'⚠ Sin pago registrado ('+money(d.impPagado)+' según REP)', pag:0, folio:f.folio};
  if(Math.abs(pag-d.impPagado)<2) return {cls:'b-ok', txt:'✓ Cuadra con el pago', pag, folio:f.folio};
  return {cls:'b-dgr', txt:'⚠ REP '+money(d.impPagado)+' vs pago '+money(pag), pag, folio:f.folio};
}

async function renderREPList(){
  const cont=document.getElementById('rep-tb'); if(!cont) return;
  cont.innerHTML='<tr><td class="l" colspan="6">Cargando…</td></tr>';
  [REPS, FACTS, PAGOS] = await Promise.all([
    getDocs(collection(db,'complementosPago')).then(s=>{ const a=[]; s.forEach(d=>{ const o=d.data(); o._id=d.id; a.push(o); }); return a; }),
    cargarFacturas(), cargarPagos()
  ]);
  let totMonto=0; REPS.forEach(r=>totMonto+=(Number(r.montoTotal)||0));
  const st=document.getElementById('rep-stats');
  if(st) st.innerHTML='<div class="stat acc"><div class="n">'+money(totMonto)+'</div><div class="l">Total en complementos</div></div>'+
    '<div class="stat"><div class="n">'+REPS.length+'</div><div class="l">Complementos registrados</div></div>';
  document.getElementById('rep-count').textContent=REPS.length+' complementos';
  if(!REPS.length){ cont.innerHTML='<tr><td class="l" colspan="6"><div class="empty">Aún no hay complementos. Sube uno con el botón de arriba.</div></td></tr>'; return; }
  REPS.sort((a,b)=>String(b.fecha||'').localeCompare(String(a.fecha||'')));
  let h='';
  for(const r of REPS){
    (r.docs||[]).forEach((d,i)=>{
      d._prov=r.proveedor; d._match=FACTS.find(f=>String(f.folio)===String(d.facturaMatch)) || matchFactura(d);
      const v=verifDoc(d);
      h+='<tr>'+
        '<td class="l">'+(i===0?('<b>'+esc(r.proveedor||'')+'</b><span class="prov">'+esc((r.fecha||''))+'</span>'):'')+'</td>'+
        '<td class="l">'+(d._match?('<b>'+esc(d._match.folio)+'</b>'):'<span class="muted">'+esc(d.folio||'?')+'</span>')+'</td>'+
        '<td data-l="Pagado">'+money(d.impPagado)+'</td>'+
        '<td data-l="Saldo">'+money(d.saldoInsoluto)+'</td>'+
        '<td class="l"><span class="badge '+v.cls+'">'+v.txt+'</span></td>'+
        '<td>'+(i===0&&r.adjunto?'<button class="clip" onclick="repVerAdjunto(\''+r.adjunto+'\')">📎</button> ':'')+(i===0?'<button class="btn btn-sm btn-s" onclick="repBorrar(\''+r._id+'\')">Borrar</button>':'')+'</td>'+
      '</tr>';
    });
  }
  cont.innerHTML=h;
}

window.repBorrar=async function(id){ if(!confirm('¿Borrar este complemento?')) return; try{ const {deleteDoc}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'); await deleteDoc(doc(db,'complementosPago',id)); REPS=REPS.filter(r=>r._id!==id); renderREPList(); }catch(e){ alert('Error: '+e.message); } };

window.repAbrir=function(){
  document.getElementById('rep-file').value='';
  document.getElementById('rep-leyendo').textContent='';
  document.getElementById('rep-preview').innerHTML='';
  document.getElementById('rep-status').textContent='';
  document.getElementById('rep-save').disabled=true;
  repPending=null;
  document.getElementById('m-rep').classList.add('on');
};

async function repFile(){
  const fi=document.getElementById('rep-file'); const f=fi.files[0]; if(!f) return;
  const av=document.getElementById('rep-leyendo'); av.textContent='Leyendo el complemento…';
  try{
    if(!FACTS.length||!PAGOS.length){ [FACTS,PAGOS]=await Promise.all([cargarFacturas(),cargarPagos()]); }
    const t=await textoPDF(f);
    const rep=leerREP(t);
    if(!rep.docs.length){ av.textContent='No pude leer documentos relacionados en este PDF.'; return; }
    rep.docs.forEach(d=>{ d._prov=rep.proveedor; d._match=matchFactura(d); d.facturaMatch=d._match?d._match.folio:''; });
    if(!rep.proveedor){ const fm=rep.docs.find(d=>d._match); if(fm) rep.proveedor=fm._match.proveedor; }
    repPending={rep, data:await b64(f), nombre:f.name};
    av.textContent='✓ '+esc(rep.proveedor||'')+' · '+money(rep.montoTotal)+' · '+rep.docs.length+' factura(s)';
    // preview con verificación
    let h='<div style="margin-top:8px">';
    rep.docs.forEach(d=>{ const v=verifDoc(d);
      h+='<div class="lineitem"><span>'+(d._match?('<b>'+esc(d._match.folio)+'</b>'):('folio '+esc(d.folio)))+' · pagado '+money(d.impPagado)+'</span><span class="badge '+v.cls+'">'+v.txt+'</span></div>';
    });
    h+='</div>';
    const sinMatch=rep.docs.filter(d=>!d._match).length;
    if(sinMatch) h+='<div class="sug">No pude ligar '+sinMatch+' documento(s) a una factura. Se guardan de todos modos; puedes revisarlo.</div>';
    document.getElementById('rep-preview').innerHTML=h;
    document.getElementById('rep-save').disabled=false;
  }catch(e){ av.textContent='No pude leer el PDF: '+e.message; }
}

window.repGuardar=async function(){
  if(!repPending) return;
  const st=document.getElementById('rep-status'); st.textContent='Guardando…';
  try{
    st.textContent='Subiendo el PDF…';
    const adj=await guardarAdjunto(repPending.data, repPending.nombre);
    st.textContent='Guardando…';
    const rep=repPending.rep;
    const id = rep.folioFiscal || ('REP-'+Date.now());
    await setDoc(doc(db,'complementosPago',id), {
      folioFiscal:rep.folioFiscal||'', proveedor:rep.proveedor||'', fecha:rep.fecha||'',
      montoTotal:rep.montoTotal||0, adjunto:adj, ts:Date.now(),
      docs:rep.docs.map(d=>({uuid:d.uuid, folio:d.folio, impPagado:d.impPagado, saldoAnterior:d.saldoAnterior, saldoInsoluto:d.saldoInsoluto, facturaMatch:d.facturaMatch||''}))
    });
    st.textContent=''; repPending=null;
    window.cerrarModal('m-rep'); renderREPList();
  }catch(e){ st.textContent='Error: '+e.message; }
};
window.renderREPList=renderREPList;

/* ---------- Inyección de pestaña + panel + modal ---------- */
const PANEL_HTML = `
<div id="p-rep" style="display:none">
  <div class="stats" id="rep-stats"></div>
  <button class="btn" onclick="repAbrir()">+ Subir complemento (REP)</button>
  <div class="muted" id="rep-count" style="margin:12px 0 6px"></div>
  <div class="tablewrap">
    <table><thead><tr>
      <th class="l">Proveedor</th><th class="l">Factura</th><th>Pagado</th><th>Insoluto</th><th class="l">Verificación</th><th></th>
    </tr></thead><tbody id="rep-tb"></tbody></table>
  </div>
</div>`;
const MODAL_HTML = `
<div class="modal" id="m-rep"><div class="card">
  <h3>Complemento de pago (REP)</h3>
  <p class="muted">Sube el PDF del complemento. Lo leo, lo cruzo con tus facturas y verifico que los montos cuadren. Un REP puede amparar varias facturas.</p>
  <div class="fld"><label>PDF del complemento</label>
    <div class="drop"><input id="rep-file" type="file" accept="application/pdf"><div class="hint">Lo leo y detecto qué facturas ampara.</div></div>
    <div id="rep-leyendo" class="leyendo"></div>
  </div>
  <div id="rep-preview"></div>
  <div class="status" id="rep-status"></div>
  <div class="row2" style="margin-top:12px">
    <button class="btn btn-s" onclick="cerrarModal('m-rep')">Cancelar</button>
    <button class="btn" id="rep-save" onclick="repGuardar()" disabled>Guardar</button>
  </div>
</div></div>`;

function initUI(intentos){
  intentos=intentos||0;
  const tabs=document.querySelector('.tabs');
  const app=document.getElementById('app');
  if(!tabs||!app){ if(intentos<40) setTimeout(()=>initUI(intentos+1),300); return; }
  if(!document.getElementById('t-rep')){
    const b=document.createElement('button'); b.id='t-rep'; b.className='tab'; b.textContent='Complementos';
    b.setAttribute('onclick','repShow()'); tabs.appendChild(b);
  }
  if(!document.getElementById('p-rep')){ const tmp=document.createElement('div'); tmp.innerHTML=PANEL_HTML; while(tmp.firstChild) app.appendChild(tmp.firstChild); }
  if(!document.getElementById('m-rep')){ const tmp=document.createElement('div'); tmp.innerHTML=MODAL_HTML; while(tmp.firstChild) document.body.appendChild(tmp.firstChild);
    document.getElementById('m-rep').addEventListener('click',e=>{ if(e.target.id==='m-rep') e.currentTarget.classList.remove('on'); });
    document.getElementById('rep-file').addEventListener('change', repFile);
  }
  // monkey-patch verTab para ocultar el panel REP al cambiar de pestaña
  if(window.verTab && !window.verTab.__repWrapped){
    const orig=window.verTab;
    window.verTab=function(t){ const tr=document.getElementById('t-rep'); const pr=document.getElementById('p-rep'); if(tr)tr.classList.remove('on'); if(pr)pr.style.display='none'; return orig(t); };
    window.verTab.__repWrapped=true;
  }
}
window.repShow=function(){
  ['fact','nc','pag','prov'].forEach(k=>{ const t=document.getElementById('t-'+k), p=document.getElementById('p-'+k); if(t)t.classList.remove('on'); if(p)p.style.display='none'; });
  const tr=document.getElementById('t-rep'), pr=document.getElementById('p-rep'); if(tr)tr.classList.add('on'); if(pr)pr.style.display='block';
  renderREPList();
};

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>initUI());
else initUI();
