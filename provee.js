/* ===== Recibir de proveedor (CEDIS) — módulo autónomo para la app de Entradas =====
   Se carga con <script type="module" src="./provee.js"></script>.
   Reutiliza el Firebase ya inicializado por la app; inyecta su propia pantalla y botón.
   Incluye captura de evidencias (fotos) comprimidas antes de guardar. */
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, getDocs, getDoc, doc, setDoc, addDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const _apps = getApps();
const _app = _apps.length ? _apps[0] : initializeApp({ apiKey:'AIzaSyCpFCqO25oDdBne1mOiJarY-ZEBBX0jOVk', authDomain:'bellissima-entradas.firebaseapp.com', projectId:'bellissima-entradas' });
const db = getFirestore(_app);

let PROV_FILTRO = 'pend';
let PROV_ACTUAL = null;
let PROV_LIST = null;
let PROV_FOTOS = [];   // {dataUrl?, id?, nombre}
const CH = 700000;

const money = n => '$' + (Number(n)||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});

const SCREENS_HTML = `
<div id="s-provee" class="screen">
  <style>
    #s-provee .pv-card,#s-provee-det .pv-card{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#fff;border:1px solid var(--line,#e5e5e5);border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:pointer}
    #s-provee .pv-card:active{background:#faf6fc}
    .pv-b{display:inline-block;padding:3px 9px;border-radius:99px;font-size:11.5px;font-weight:600;white-space:nowrap}
    .pv-ok{background:#f0fdf4;color:#16a34a}.pv-falt{background:#fef2f2;color:#dc2626}.pv-pend{background:#fffbeb;color:#d97706}
    #s-provee .pv-chip{padding:6px 12px;border:1px solid var(--line,#e5e5e5);background:#fff;border-radius:99px;font-size:12.5px;cursor:pointer;color:var(--muted,#777)}
    #s-provee .pv-chip.on{background:var(--brand,#6b21a8);border-color:var(--brand,#6b21a8);color:#fff;font-weight:600}
    #s-provee-det .pv-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--line,#eee)}
    #s-provee-det .pv-row.pv-rfalt{background:#fef2f2}#s-provee-det .pv-row.pv-rsob{background:#fffbeb}
    #s-provee-det .pv-desc{font-size:12.5px;flex:1;min-width:0}
    #s-provee-det .pv-nums{display:flex;align-items:center;gap:8px;white-space:nowrap}
    #s-provee-det .pv-nums input{width:64px;padding:6px 8px;border:1px solid var(--line,#ccc);border-radius:8px;font-size:14px;text-align:right}
    #s-provee-det .pv-f{width:44px;text-align:right;font-weight:700;font-size:12.5px}
    #s-provee-det .pv-list{border:1px solid var(--line,#eee);border-radius:12px;overflow:hidden;background:#fff}
    #s-provee-det .pv-foto{position:relative;width:72px;height:72px;border-radius:10px;overflow:hidden;border:1px solid var(--line,#ddd);background:#f6f6f6;cursor:pointer;flex:0 0 auto}
    #s-provee-det .pv-foto img{width:100%;height:100%;object-fit:cover}
    #s-provee-det .pv-foto .pv-x{position:absolute;top:2px;right:2px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:99px;width:20px;height:20px;font-size:12px;line-height:1;cursor:pointer}
    #s-provee-det .pv-foto .pv-saved{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22px;color:#6b21a8}
    #s-provee-det .pv-add{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1px dashed var(--brand,#6b21a8);color:var(--brand,#6b21a8);border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;background:#faf6fc}
  </style>
  <div class="topbar">
    <button class="btn-ico" onclick="show('s-home');window.renderHome&&window.renderHome()">←</button>
    <h2>Recibir de proveedor</h2>
  </div>
  <p style="font-size:13px;color:var(--muted,#777);margin-bottom:12px">Revisa la mercancía que llega del proveedor al CEDIS contra su factura. El faltante que registres aquí es el que se le reclama al proveedor (nota de crédito) — es distinto al faltante del reparto a sucursales.</p>
  <div id="prov-chips" style="display:flex;gap:6px;margin-bottom:14px">
    <span class="pv-chip on" data-f="pend" onclick="proveeFiltro('pend')">Por revisar</span>
    <span class="pv-chip" data-f="rev" onclick="proveeFiltro('rev')">Revisadas</span>
    <span class="pv-chip" data-f="all" onclick="proveeFiltro('all')">Todas</span>
  </div>
  <div id="prov-list"></div>
</div>
<div id="s-provee-det" class="screen">
  <div class="topbar">
    <button class="btn-ico" onclick="show('s-provee');renderProveeList()">←</button>
    <h2 id="prov-det-titulo">Revisión</h2>
  </div>
  <div id="prov-det-meta" class="card-flat" style="margin-bottom:1rem"></div>
  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
    <input id="prov-buscar" placeholder="Buscar producto…" style="flex:1;min-width:150px;padding:8px 10px;border:1px solid var(--line,#ccc);border-radius:8px;font-size:14px" oninput="renderProveeDet()">
    <button class="btn btn-sm btn-s" onclick="proveeMarcarCompleto()">Todo llegó completo</button>
  </div>
  <div id="prov-det-resumen" style="margin-bottom:8px"></div>
  <div id="prov-det-body" class="pv-list"></div>
  <div style="margin-top:16px">
    <label style="font-weight:600;font-size:13px;color:#1e1b24">Evidencias (fotos)</label>
    <p style="font-size:12px;color:var(--muted,#777);margin:2px 0 8px">Toma fotos de la mercancía o del faltante. Sirven como prueba para reclamar al proveedor.</p>
    <div id="prov-fotos" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"></div>
  </div>
  <button class="btn" style="margin-top:1rem;width:100%" onclick="guardarRecepcionProveedor()">Guardar revisión</button>
  <div id="prov-det-status" style="font-size:13px;margin-top:8px;min-height:18px;color:var(--brand,#6b21a8)"></div>
</div>`;

/* ---------- fotos ---------- */
function comprimirImagen(file){
  return new Promise((res,rej)=>{
    const img=new Image(); const url=URL.createObjectURL(file);
    img.onload=()=>{ URL.revokeObjectURL(url);
      let w=img.width, h=img.height; const max=1200;
      if(w>max||h>max){ const s=Math.min(max/w,max/h); w=Math.round(w*s); h=Math.round(h*s); }
      const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      res(cv.toDataURL('image/jpeg',0.7));
    };
    img.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error('imagen inválida')); };
    img.src=url;
  });
}
async function guardarFoto(dataUrl, nombre){
  const b64=dataUrl.slice(dataUrl.indexOf(',')+1);
  const n=Math.ceil(b64.length/CH);
  const ref=await addDoc(collection(db,'adjuntos'), {nombre:nombre||'foto.jpg', tipo:'image/jpeg', nChunks:n, ts:Date.now()});
  for(let i=0;i<n;i++) await setDoc(doc(db,'adjuntos',ref.id,'chunks',String(i)), {d:b64.slice(i*CH,(i+1)*CH)});
  return ref.id;
}
async function abrirFotoGuardada(id){
  try{
    const meta=await getDoc(doc(db,'adjuntos',id)); if(!meta.exists()){ alert('No encontré la foto.'); return; }
    const m=meta.data(); let s=''; for(let i=0;i<m.nChunks;i++){ const d=await getDoc(doc(db,'adjuntos',id,'chunks',String(i))); if(d.exists()) s+=d.data().d; }
    const bin=atob(s), arr=new Uint8Array(bin.length); for(let k=0;k<bin.length;k++) arr[k]=bin.charCodeAt(k);
    const url=URL.createObjectURL(new Blob([arr],{type:m.tipo||'image/jpeg'})); window.open(url,'_blank'); setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(e){ alert('Error: '+e.message); }
}
function renderFotos(){
  const cont=document.getElementById('prov-fotos'); if(!cont) return;
  let h='';
  PROV_FOTOS.forEach((f,i)=>{
    if(f.dataUrl){
      h+='<div class="pv-foto" onclick="proveeVerFoto('+i+')"><img src="'+f.dataUrl+'"><button class="pv-x" onclick="event.stopPropagation();proveeFotoDel('+i+')">✕</button></div>';
    } else {
      h+='<div class="pv-foto" onclick="proveeVerFoto('+i+')"><div class="pv-saved">📷</div><button class="pv-x" onclick="event.stopPropagation();proveeFotoDel('+i+')">✕</button></div>';
    }
  });
  h+='<label class="pv-add">📷 Agregar foto<input type="file" accept="image/*" multiple style="display:none" onchange="proveeFotoAdd(this.files)"></label>';
  cont.innerHTML=h;
}
window.proveeFotoAdd=async function(files){
  if(!files||!files.length) return;
  const st=document.getElementById('prov-det-status'); if(st) st.textContent='Procesando foto(s)…';
  for(const f of files){
    if(!/^image\//.test(f.type)) continue;
    try{ const dataUrl=await comprimirImagen(f); PROV_FOTOS.push({dataUrl, nombre:f.name||'foto.jpg'}); }catch(e){}
  }
  if(st) st.textContent='';
  renderFotos();
};
window.proveeFotoDel=function(i){ PROV_FOTOS.splice(i,1); renderFotos(); };
window.proveeVerFoto=function(i){
  const f=PROV_FOTOS[i]; if(!f) return;
  if(f.dataUrl){ const w=window.open(''); if(w) w.document.write('<img src="'+f.dataUrl+'" style="max-width:100%">'); }
  else if(f.id){ abrirFotoGuardada(f.id); }
};

/* ---------- datos ---------- */
async function cargarFacturas(){
  const out=[];
  const snap=await getDocs(collection(db,'ordenesCompra'));
  const revisados={};
  try{ const recSnap=await getDocs(collection(db,'recibosProveedor')); recSnap.forEach(d=>{ revisados[d.id]=d.data(); }); }catch(e){}
  snap.forEach(d=>{ const o=d.data();
    (o.compras||[]).forEach(c=>{ if(!c.folio) return;
      const prods=c.productosRecibidos||[];
      const r=revisados[c.folio];
      out.push({folioE:String(c.folio), folioS:o.folio||'', prov:o.proveedor||'', fecha:c.fechaCompra||o.fechaLlegada||'', nProd:prods.length, revisado:!!r, totalFalt:r?(r.totalFaltante||0):0, prods});
    });
  });
  out.sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)));
  return out;
}

function proveeFiltro(f){
  PROV_FILTRO=f;
  document.querySelectorAll('#prov-chips [data-f]').forEach(el=>{ el.classList.toggle('on', el.getAttribute('data-f')===f); });
  renderProveeList();
}

async function renderProveeList(){
  const cont=document.getElementById('prov-list');
  if(!cont) return;
  cont.innerHTML='<p style="color:var(--muted,#777);padding:16px">Cargando facturas…</p>';
  const list=await cargarFacturas();
  PROV_LIST=list;
  const filt=list.filter(x=> PROV_FILTRO==='all' || (PROV_FILTRO==='pend'&&!x.revisado) || (PROV_FILTRO==='rev'&&x.revisado));
  if(!filt.length){ cont.innerHTML='<p style="color:var(--muted,#777);padding:16px">No hay facturas '+(PROV_FILTRO==='pend'?'por revisar':(PROV_FILTRO==='rev'?'revisadas':''))+'.</p>'; return; }
  let h='';
  for(const x of filt){
    const badge = x.revisado ? (x.totalFalt>0?'<span class="pv-b pv-falt">Faltó '+money(x.totalFalt)+'</span>':'<span class="pv-b pv-ok">Completo</span>') : '<span class="pv-b pv-pend">Por revisar</span>';
    h+='<div class="pv-card" onclick="abrirRevisionProveedor(\''+x.folioE+'\')">'+
      '<div style="min-width:0"><b>'+x.folioE+'</b> · '+x.prov+
      '<div style="font-size:12px;color:var(--muted,#777)">'+x.fecha+' · '+x.nProd+' productos</div></div>'+
      '<div>'+badge+'</div></div>';
  }
  cont.innerHTML=h;
}

async function abrirRevisionProveedor(folioE){
  const list=PROV_LIST||await cargarFacturas();
  const f=list.find(x=>x.folioE===folioE);
  if(!f) return;
  const byClave={};
  f.prods.forEach(p=>{ const k=String(p.clave);
    if(!byClave[k]) byClave[k]={clave:k, desc:p.descripcion||p.desc||'', facturado:0, costo:p.costoPromedio||0};
    byClave[k].facturado += (p.cantRecibida||0);
  });
  const prefill={};
  PROV_FOTOS=[];
  try{ const d=await getDoc(doc(db,'recibosProveedor',folioE)); if(d.exists()){ const dd=d.data(); (dd.items||[]).forEach(it=>{ prefill[String(it.clave)]=it.recibido; }); (dd.fotos||[]).forEach(ft=>{ PROV_FOTOS.push({id:ft.id, nombre:ft.nombre||'foto.jpg'}); }); } }catch(e){}
  const items=Object.keys(byClave).map(k=>{ const b=byClave[k]; return {clave:b.clave, desc:b.desc, facturado:b.facturado, costo:b.costo, recibido:(prefill[k]!=null?prefill[k]:b.facturado)}; });
  items.sort((a,b)=> a.desc<b.desc?-1:(a.desc>b.desc?1:0));
  PROV_ACTUAL={folioE:f.folioE, folioS:f.folioS, prov:f.prov, fecha:f.fecha, items};
  document.getElementById('prov-det-titulo').textContent=f.folioE;
  document.getElementById('prov-det-meta').innerHTML='<b>'+f.prov+'</b><br><span style="font-size:12px;color:var(--muted,#777)">Factura '+f.folioE+' · orden '+f.folioS+' · '+f.fecha+' · '+items.length+' productos</span>';
  document.getElementById('prov-buscar').value='';
  document.getElementById('prov-det-status').textContent='';
  renderProveeDet();
  renderFotos();
  window.show('s-provee-det');
}

function pvResumen(){
  let totFalt=0,nFalt=0;
  for(const it of PROV_ACTUAL.items){ const falta=Math.max(0,it.facturado-it.recibido); if(falta>0){ totFalt+=falta*it.costo; nFalt++; } }
  const el=document.getElementById('prov-det-resumen');
  if(el) el.innerHTML = nFalt>0 ? '<span class="pv-b pv-falt">'+nFalt+' con faltante · '+money(totFalt)+'</span>' : '<span class="pv-b pv-ok">Todo completo</span>';
}

function renderProveeDet(){
  if(!PROV_ACTUAL) return;
  const q=(document.getElementById('prov-buscar').value||'').trim().toLowerCase();
  const body=document.getElementById('prov-det-body');
  pvResumen();
  let h='', shown=0;
  for(let i=0;i<PROV_ACTUAL.items.length;i++){ const it=PROV_ACTUAL.items[i];
    if(q && (it.clave+' '+it.desc).toLowerCase().indexOf(q)<0) continue;
    const falta=it.facturado-it.recibido;
    const cls=falta>0?'pv-row pv-rfalt':(falta<0?'pv-row pv-rsob':'pv-row');
    const marca=falta>0?('−'+falta):(falta<0?('+'+(-falta)):'✓');
    const col=falta>0?'#dc2626':(falta<0?'#d97706':'#16a34a');
    h+='<div class="'+cls+'">'+
      '<div class="pv-desc"><b>'+it.clave+'</b> '+it.desc+'</div>'+
      '<div class="pv-nums">'+
        '<span style="font-size:11px;color:var(--muted,#777)">fact. '+it.facturado+'</span>'+
        '<input type="number" min="0" value="'+it.recibido+'" onchange="proveeSet('+i+',this.value)">'+
        '<span class="pv-f" style="color:'+col+'">'+marca+'</span>'+
      '</div></div>';
    shown++; if(shown>=300) break;
  }
  body.innerHTML = h || '<p style="color:var(--muted,#777);padding:12px">Sin coincidencias.</p>';
  if(shown>=300) body.innerHTML += '<p style="color:var(--muted,#777);padding:10px;font-size:12px">Mostrando 300 — usa la búsqueda para ver el resto.</p>';
}

function proveeSet(idx,val){
  if(!PROV_ACTUAL||!PROV_ACTUAL.items[idx]) return;
  let v=parseInt(val,10); if(isNaN(v)||v<0) v=0;
  PROV_ACTUAL.items[idx].recibido=v;
  renderProveeDet();
}
function proveeMarcarCompleto(){
  if(!PROV_ACTUAL) return;
  for(const it of PROV_ACTUAL.items) it.recibido=it.facturado;
  renderProveeDet();
}

async function guardarRecepcionProveedor(){
  if(!PROV_ACTUAL) return;
  const st=document.getElementById('prov-det-status'); st.textContent='Guardando…';
  const items=[]; let totFalt=0;
  for(const it of PROV_ACTUAL.items){
    const falta=Math.max(0, it.facturado-it.recibido);
    items.push({clave:it.clave, desc:it.desc, facturado:it.facturado, recibido:it.recibido, faltante:falta, costo:it.costo});
    if(falta>0) totFalt+=falta*it.costo;
  }
  try{
    // subir fotos nuevas (dataUrl); conservar las ya guardadas (id)
    const fotos=[];
    for(let i=0;i<PROV_FOTOS.length;i++){ const ft=PROV_FOTOS[i];
      if(ft.id){ fotos.push({id:ft.id, nombre:ft.nombre||'foto.jpg'}); }
      else if(ft.dataUrl){ st.textContent='Subiendo foto '+(i+1)+'…'; const id=await guardarFoto(ft.dataUrl, ft.nombre); fotos.push({id, nombre:ft.nombre||'foto.jpg'}); }
    }
    st.textContent='Guardando…';
    await setDoc(doc(db,'recibosProveedor',PROV_ACTUAL.folioE), {
      folio:PROV_ACTUAL.folioE, folioOrden:PROV_ACTUAL.folioS, proveedor:PROV_ACTUAL.prov, fecha:PROV_ACTUAL.fecha,
      items, totalFaltante:Math.round(totFalt*100)/100, fotos, revisado:true, ts:Date.now()
    });
    st.textContent='';
    window.show('s-provee'); renderProveeList();
  }catch(e){ st.textContent='Error al guardar: '+e.message; }
}

/* exponer handlers */
window.proveeFiltro=proveeFiltro;
window.renderProveeList=renderProveeList;
window.abrirRevisionProveedor=abrirRevisionProveedor;
window.renderProveeDet=renderProveeDet;
window.proveeSet=proveeSet;
window.proveeMarcarCompleto=proveeMarcarCompleto;
window.guardarRecepcionProveedor=guardarRecepcionProveedor;

function initUI(intentos){
  intentos=intentos||0;
  const home=document.getElementById('s-home');
  if(!home){ if(intentos<40) setTimeout(()=>initUI(intentos+1),300); return; }
  if(!document.getElementById('s-provee')){
    const tmp=document.createElement('div');
    tmp.innerHTML=SCREENS_HTML;
    const parent=home.parentNode;
    while(tmp.firstChild) parent.appendChild(tmp.firstChild);
  }
  if(!document.getElementById('pv-navbtn')){
    let adminBtn=null;
    document.querySelectorAll('#s-home button').forEach(b=>{ if((b.getAttribute('onclick')||'').indexOf('renderAdminLista')>=0) adminBtn=b; });
    const nb=document.createElement('button');
    nb.id='pv-navbtn';
    nb.className=adminBtn?adminBtn.className:'btn btn-sm btn-s';
    nb.textContent='📦 De proveedor';
    nb.setAttribute('onclick',"show('s-provee');renderProveeList()");
    if(adminBtn && adminBtn.parentNode) adminBtn.parentNode.insertBefore(nb, adminBtn.nextSibling);
    else home.insertBefore(nb, home.firstChild);
  }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>initUI());
else initUI();
