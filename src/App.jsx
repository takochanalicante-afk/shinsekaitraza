import { useState, useEffect, useRef, useCallback } from "react";
import { db } from "./firebase.js";
import {
  collection, doc, onSnapshot, setDoc, deleteDoc,
  addDoc, serverTimestamp, query, orderBy, getDoc
} from "firebase/firestore";
import * as XLSX from "xlsx";
import jsQR from "jsqr";
import QRCode from "qrcode";

// ── Helpers ───────────────────────────────────────────────────────────────────
const today   = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10); };
const fmt     = d => { if (!d) return "—"; const [y, m, day] = d.split("-"); return `${day}/${m}/${y}`; };
const nowTime = () => new Date().toTimeString().slice(0, 5);
const isExp   = d => d && d < today();
const isNear  = d => d && d >= today() && d <= addDays(today(), 3);
let _s = Date.now();
const uid = () => "x" + (++_s).toString(36);

// ── Default categories ────────────────────────────────────────────────────────
const DEFAULT_CATS = [
  { id:"fondos",      label:"Fondos y caldos",        icon:"🍲" },
  { id:"salsas",      label:"Salsas y aderezos",       icon:"🥣" },
  { id:"carnes",      label:"Carnes y aves",           icon:"🥩" },
  { id:"pescados",    label:"Pescados y mariscos",     icon:"🐟" },
  { id:"verduras",    label:"Verduras y guarniciones", icon:"🥦" },
  { id:"pastas",      label:"Pastas y arroces",        icon:"🍝" },
  { id:"postres",     label:"Postres y repostería",    icon:"🍰" },
  { id:"panaderia",   label:"Panadería y masas",       icon:"🍞" },
  { id:"conservas",   label:"Conservas y marinados",   icon:"🫙" },
  { id:"precocinados",label:"Mise en place",           icon:"🧆" },
  { id:"bebidas",     label:"Bebidas y jarabes",       icon:"🥤" },
  { id:"otros",       label:"Otros",                   icon:"📦" },
];

// ── Nav ───────────────────────────────────────────────────────────────────────
const NAVS = [
  { id:"dashboard",   icon:"⊞", l:"Dashboard" },
  { id:"restaurants", icon:"🏠", l:"Locales" },
  { id:"products",    icon:"⬡", l:"Productos" },
  { id:"transfers",   icon:"⇄", l:"Transferencias" },
  { id:"history",     icon:"📋", l:"Historial" },
  { id:"settings",    icon:"⚙️",  l:"Ajustes" },
];

// ── Design tokens ─────────────────────────────────────────────────────────────
const OVR  = { position:"fixed", inset:0, background:"rgba(15,23,42,0.65)", backdropFilter:"blur(4px)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 };
const MDL  = { background:"#fff", borderRadius:16, padding:20, boxShadow:"0 24px 64px rgba(0,0,0,0.22)", width:"100%", maxWidth:480 };
const MHDR = { display:"flex", justifyContent:"space-between", alignItems:"center" };
const CBTN = { background:"none", border:"none", cursor:"pointer", fontSize:18, color:"#94a3b8", padding:4, lineHeight:1 };
const LBL  = { display:"flex", flexDirection:"column", gap:4, fontSize:12, fontWeight:600, color:"#475569" };
const INP  = { padding:"8px 10px", border:"1.5px solid #e2e8f0", borderRadius:8, fontSize:13, color:"#1e293b", outline:"none", width:"100%", boxSizing:"border-box", background:"#fff", fontFamily:"inherit" };
const IROW = { display:"flex", justifyContent:"space-between", fontSize:13, padding:"4px 0", borderBottom:"1px solid #f1f5f9" };

function B(v) {
  const base = { padding:"9px 16px", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer", border:"none", letterSpacing:"0.02em" };
  if (v==="primary") return { ...base, background:"#1e293b", color:"#fff" };
  if (v==="orange")  return { ...base, background:"#f97316", color:"#fff" };
  if (v==="ghost")   return { ...base, background:"#f1f5f9", color:"#475569" };
  if (v==="red")     return { ...base, background:"#fef2f2", color:"#dc2626", border:"1px solid #fecaca" };
  if (v==="green")   return { ...base, background:"#f0fdf4", color:"#16a34a", border:"1px solid #bbf7d0" };
  if (v==="blue")    return { ...base, background:"#eff6ff", color:"#2563eb", border:"1px solid #bfdbfe" };
}
function bdg(c) {
  const m = { red:["#fef2f2","#dc2626"], amber:["#fffbeb","#d97706"], green:["#f0fdf4","#16a34a"], neutral:["#f8fafc","#64748b"], blue:["#eff6ff","#2563eb"], purple:["#faf5ff","#7c3aed"] };
  return { background:m[c][0], color:m[c][1], border:`1px solid ${m[c][1]}33`, borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase", whiteSpace:"nowrap" };
}
function StatusBadge({ expiry }) {
  if (!expiry)        return <span style={bdg("neutral")}>Sin fecha</span>;
  if (isExp(expiry))  return <span style={bdg("red")}>Caducado</span>;
  if (isNear(expiry)) return <span style={bdg("amber")}>Caduca pronto</span>;
  return <span style={bdg("green")}>OK</span>;
}
function STitle({ children }) {
  return <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#94a3b8", marginBottom:8, marginTop:4 }}>{children}</div>;
}
function Spinner() {
  return <div style={{ width:32, height:32, border:"3px solid #e2e8f0", borderTopColor:"#f97316", borderRadius:"50%", animation:"spin .8s linear infinite" }}/>;
}

// ── iOS-safe Picker ───────────────────────────────────────────────────────────
function Picker({ label, value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  return (
    <div style={LBL}>
      {label}
      <div style={{ position:"relative" }}>
        <button type="button" onClick={() => setOpen(v => !v)}
          style={{ ...INP, textAlign:"left", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", color:selected?"#1e293b":"#94a3b8" }}>
          <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{selected ? selected.label : placeholder}</span>
          <span style={{ marginLeft:8, flexShrink:0, color:"#94a3b8", fontSize:11 }}>{open?"▲":"▼"}</span>
        </button>
        {open && (
          <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, background:"#fff", border:"1.5px solid #1e293b", borderRadius:8, zIndex:50, maxHeight:220, overflowY:"auto", boxShadow:"0 8px 24px rgba(0,0,0,.15)" }}>
            {options.map(o => (
              <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
                style={{ width:"100%", textAlign:"left", padding:"11px 14px", border:"none", borderBottom:"1px solid #f1f5f9", background:o.value===value?"#fff7ed":"#fff", color:o.value===value?"#f97316":"#1e293b", fontWeight:o.value===value?700:400, fontSize:13, cursor:"pointer", display:"block" }}>
                {o.value === value && <span style={{ marginRight:6 }}>✓</span>}{o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Firebase helpers ──────────────────────────────────────────────────────────
const COL = {
  restaurants: "restaurants",
  products:    "products",
  transfers:   "transfers",
  history:     "history",
  categories:  "categories",
  catalog:     "catalog",
  users:       "users",
  settings:    "settings",
};

async function fbSet(col, id, data) {
  await setDoc(doc(db, col, id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}
async function fbAdd(col, data) {
  return await addDoc(collection(db, col), { ...data, createdAt: serverTimestamp() });
}
async function fbDel(col, id) {
  await deleteDoc(doc(db, col, id));
}

// ── Excel export ──────────────────────────────────────────────────────────────
function exportXLS({ restaurants, products, transfers, history, categories, users }) {
  const wb  = XLSX.utils.book_new();
  const cats = categories.length ? categories : DEFAULT_CATS;
  const cmap = Object.fromEntries(cats.map(c => [c.id, c]));
  const umap = Object.fromEntries(users.map(u => [u.id, u]));

  const ws0 = XLSX.utils.json_to_sheet(restaurants.map(r => ({ Nombre:r.name, "CIF/NIF":r.cif||"", Dirección:r.address||"", Ciudad:r.city||"", CP:r.zip||"", Teléfono:r.phone||"", Email:r.email||"", Responsable:r.manager||"" })));
  XLSX.utils.book_append_sheet(wb, ws0, "Locales");

  const ws1 = XLSX.utils.json_to_sheet(products.map(p => ({ Nombre:p.name, Categoría:cmap[p.category]?.label||"—", Local:restaurants.find(r=>r.id===p.restaurantId)?.name||"—", Elaboración:fmt(p.elaboration), Caducidad:fmt(p.expiry), Estado:isExp(p.expiry)?"Caducado":isNear(p.expiry)?"Caduca pronto":"OK", Cantidad:p.quantity||"", Unidad:p.unit||"", Lote:p.lot||"" })));
  XLSX.utils.book_append_sheet(wb, ws1, "Productos");

  const ws2 = XLSX.utils.json_to_sheet(transfers.map(t => ({ Fecha:fmt(t.date), Hora:t.time||"—", Producto:products.find(p=>p.id===t.productId)?.name||"—", Origen:restaurants.find(r=>r.id===t.fromRestaurantId)?.name||"—", Destino:restaurants.find(r=>r.id===t.toRestaurantId)?.name||"—", Cantidad:t.qty||"", Firmado:umap[t.userId]?.name||"—", Nota:t.note||"" })));
  XLSX.utils.book_append_sheet(wb, ws2, "Transferencias");

  const TL = { created:"Creación", transferred:"Transferencia", edited:"Edición", scanned:"Escaneo" };
  const ws3 = XLSX.utils.json_to_sheet([...history].reverse().map(h => ({ Fecha:fmt(h.date), Hora:h.time||"—", Tipo:TL[h.type]||h.type, Producto:h.productName||"—", Local:restaurants.find(r=>r.id===h.restaurantId)?.name||"—", Usuario:umap[h.userId]?.name||"—", Detalle:h.detail||"" })));
  XLSX.utils.book_append_sheet(wb, ws3, "Historial");

  XLSX.writeFile(wb, `TrazaPro_${today()}.xlsx`);
}

// ── QR generation ─────────────────────────────────────────────────────────────
async function generateQR(data) {
  return await QRCode.toDataURL(JSON.stringify(data), { width:120, margin:1, color:{ dark:"#1e293b", light:"#ffffff" } });
}

// ── USER SELECT SCREEN ────────────────────────────────────────────────────────
function UserSelectScreen({ users, onSelect, onCreateFirst }) {
  return (
    <div style={{ minHeight:"100vh", background:"#1e293b", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:24 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width:64, height:64, background:"#f97316", borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", fontSize:32, marginBottom:16 }}>⊛</div>
      <div style={{ fontWeight:800, fontSize:24, color:"#fff", marginBottom:4 }}>TrazaPro</div>
      <div style={{ fontSize:13, color:"#64748b", marginBottom:32 }}>¿Quién eres?</div>

      {users.length === 0 ? (
        <div style={{ textAlign:"center" }}>
          <div style={{ color:"#94a3b8", fontSize:13, marginBottom:16 }}>No hay usuarios configurados todavía</div>
          <button onClick={onCreateFirst} style={{ ...B("orange"), fontSize:15, padding:"12px 28px" }}>Crear primer usuario</button>
        </div>
      ) : (
        <div style={{ display:"grid", gap:10, width:"100%", maxWidth:340 }}>
          {users.map(u => (
            <button key={u.id} onClick={() => onSelect(u)}
              style={{ background:"rgba(255,255,255,.06)", border:"1.5px solid rgba(255,255,255,.1)", borderRadius:12, padding:"14px 18px", cursor:"pointer", textAlign:"left", display:"flex", alignItems:"center", gap:14 }}>
              <div style={{ width:42, height:42, borderRadius:"50%", background:"#f97316", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0, fontWeight:800, color:"#fff" }}>
                {u.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight:700, fontSize:15, color:"#fff" }}>{u.name}</div>
                <div style={{ fontSize:12, color:"#64748b", marginTop:2 }}>{u.role || "Sin rol"}{u.restaurantName ? ` · ${u.restaurantName}` : ""}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── USER MODAL ────────────────────────────────────────────────────────────────
function UserModal({ user, restaurants, onClose, onSave, onDelete }) {
  const isNew = !user;
  const [f, setF] = useState(user || { name:"", role:"", restaurantId:"", pin:"" });
  const [confirmDel, setConfirmDel] = useState(false);
  const roles = ["Jefe de cocina","Cocinero/a","Ayudante de cocina","Responsable de local","Repartidor/a","Administración"];
  return (
    <div style={OVR} onClick={onClose}>
      <div style={{ ...MDL, maxWidth:420 }} onClick={e => e.stopPropagation()}>
        <div style={MHDR}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:"#64748b" }}>{isNew?"Nuevo usuario":"Editar usuario"}</div>
            {!isNew && <div style={{ fontWeight:800, fontSize:15, marginTop:2 }}>{f.name}</div>}
          </div>
          <button onClick={onClose} style={CBTN}>✕</button>
        </div>
        <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:12 }}>
          <label style={LBL}>Nombre completo *<input style={INP} value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="Ej: Ana García"/></label>
          <label style={LBL}>
            Rol / Puesto
            <select style={INP} value={f.role} onChange={e=>setF({...f,role:e.target.value})}>
              <option value="">Sin rol específico</option>
              {roles.map(r=><option key={r}>{r}</option>)}
            </select>
          </label>
          <label style={LBL}>
            Local asignado por defecto
            <select style={INP} value={f.restaurantId} onChange={e=>setF({...f,restaurantId:e.target.value})}>
              <option value="">Sin local fijo</option>
              {restaurants.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <div style={{ background:"#f8fafc", borderRadius:8, padding:10, fontSize:12, color:"#64748b", border:"1px solid #e2e8f0" }}>
            💡 No se usa contraseña — cualquier persona con acceso a la URL puede seleccionar cualquier usuario. Es un sistema de firma de responsabilidad, no de seguridad.
          </div>
          <div style={{ display:"flex", gap:8, marginTop:4 }}>
            <button onClick={() => { if(!f.name.trim())return; onSave({...f,id:f.id||uid(),name:f.name.trim()}); onClose(); }} style={{ ...B("primary"), flex:1 }} disabled={!f.name.trim()}>
              {isNew?"Crear usuario":"Guardar cambios"}
            </button>
            {!isNew && !confirmDel && <button onClick={()=>setConfirmDel(true)} style={{ ...B("red"), flexShrink:0 }}>🗑</button>}
            {!isNew && confirmDel && (
              <div style={{ display:"flex", gap:6, flex:1 }}>
                <button onClick={()=>{onDelete(f.id);onClose();}} style={{ ...B("red"), flex:1 }}>Sí, eliminar</button>
                <button onClick={()=>setConfirmDel(false)} style={{ ...B("ghost"), flex:1 }}>No</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── LABEL MODAL ───────────────────────────────────────────────────────────────
function LabelModal({ product, restaurants, categories, users, onClose }) {
  const [qrUrl, setQrUrl] = useState("");
  const rest  = restaurants.find(r => r.id === product.restaurantId);
  const cat   = categories.find(c => c.id === product.category);
  const creator = users.find(u => u.id === product.createdBy);

  useEffect(() => {
    generateQR({ id:product.id, name:product.name, elaboration:product.elaboration, expiry:product.expiry, restaurant:rest?.name, lot:product.lot, category:product.category })
      .then(setQrUrl);
  }, []);

  function print() {
    const w = window.open("", "_blank");
    w.document.write(`<html><head><title>Etiqueta</title><style>body{margin:0;font-family:'Courier New',monospace;background:#fff;display:flex;justify-content:center;padding:10mm}.label{width:85mm;border:2px solid #1e293b;border-radius:8px;padding:12px;display:flex;gap:10px}.info{flex:1;font-size:10px;color:#1e293b}.name{font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;border-bottom:2px solid #1e293b;padding-bottom:4px}.cat{font-size:9px;color:#64748b;margin-bottom:5px}.row{display:flex;justify-content:space-between;margin-bottom:2px}.key{color:#64748b;font-weight:700}.local{margin-top:5px;font-size:9px;background:#1e293b;color:#fff;border-radius:3px;padding:2px 5px;display:inline-block}.sign{margin-top:4px;font-size:8px;color:#94a3b8}@media print{@page{size:A6;margin:5mm}}</style></head><body onload="window.print()"><div class="label"><div style="flex-shrink:0"><img src="${qrUrl}" width="100" height="100"/></div><div class="info"><div class="name">${product.name}</div>${cat?`<div class="cat">${cat.icon} ${cat.label}</div>`:""}<div class="row"><span class="key">Elaboración:</span><span>${fmt(product.elaboration)}</span></div><div class="row"><span class="key">Caducidad:</span><span style="font-weight:900">${fmt(product.expiry)}</span></div>${product.quantity?`<div class="row"><span class="key">Cantidad:</span><span>${product.quantity} ${product.unit||""}</span></div>`:""} ${product.lot?`<div class="row"><span class="key">Lote:</span><span>${product.lot}</span></div>`:""}<div class="local">${rest?.name||"—"}</div>${creator?`<div class="sign">Elaborado por: ${creator.name}</div>`:""}</div></div></body></html>`);
    w.document.close();
  }

  return (
    <div style={OVR} onClick={onClose}>
      <div style={{ ...MDL, width:420 }} onClick={e => e.stopPropagation()}>
        <div style={MHDR}><span style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:"#64748b" }}>Etiqueta de producto</span><button onClick={onClose} style={CBTN}>✕</button></div>
        <div style={{ display:"flex", gap:14, alignItems:"flex-start", background:"#f8fafc", borderRadius:10, padding:14, border:"2px dashed #cbd5e1", margin:"14px 0", fontFamily:"'Courier New',monospace" }}>
          {qrUrl ? <img src={qrUrl} width={100} height={100} style={{ flexShrink:0 }}/> : <div style={{ width:100, height:100, background:"#f1f5f9", borderRadius:8, flexShrink:0 }}/>}
          <div style={{ flex:1, fontSize:11, color:"#1e293b" }}>
            <div style={{ fontSize:13, fontWeight:900, textTransform:"uppercase", letterSpacing:".05em", borderBottom:"2px solid #1e293b", paddingBottom:3, marginBottom:4 }}>{product.name}</div>
            {cat && <div style={{ fontSize:9, color:"#64748b", marginBottom:4 }}>{cat.icon} {cat.label}</div>}
            {[["Elaboración",fmt(product.elaboration)],["Caducidad",fmt(product.expiry)],product.quantity&&["Cantidad",`${product.quantity} ${product.unit}`],product.lot&&["Lote",product.lot]].filter(Boolean).map(([k,v]) => (
              <div key={k} style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}><span style={{ color:"#64748b", fontWeight:700 }}>{k}:</span><span style={{ fontWeight:k==="Caducidad"?900:400 }}>{v}</span></div>
            ))}
            <div style={{ marginTop:5, fontSize:9, background:"#1e293b", color:"#fff", borderRadius:3, padding:"2px 5px", display:"inline-block" }}>{rest?.name||"—"}</div>
            {creator && <div style={{ marginTop:3, fontSize:9, color:"#94a3b8" }}>Por: {creator.name}</div>}
          </div>
        </div>
        <button onClick={print} style={{ ...B("primary"), width:"100%", fontSize:14 }}>🖨️ Imprimir etiqueta</button>
      </div>
    </div>
  );
}

// ── SCANNER MODAL ─────────────────────────────────────────────────────────────
function ScannerModal({ onClose, products, restaurants, users, currentUser, onSaveTransfer }) {
  const fileRef  = useRef(null);
  const [mode,        setMode]        = useState("scan");
  const [err,         setErr]         = useState(null);
  const [scanned,     setScanned]     = useState(null);
  const [cart,        setCart]        = useState([]);
  const [destId,      setDestId]      = useState("");
  const [note,        setNote]        = useState("");
  const [transferred, setTransferred] = useState(false);
  const [processing,  setProcessing]  = useState(false);

  function decodeFile(file, onResult, onError) {
    setProcessing(true); setErr(null);
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        setProcessing(false);
        if (code) { try { onResult(JSON.parse(code.data)); return; } catch {} }
        onError("No se pudo leer el QR. Asegúrate de que la imagen sea clara.");
      };
      img.onerror = () => { setProcessing(false); onError("Error al cargar la imagen."); };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function handleFile(e) {
    const file = e.target.files?.[0]; if(!file) return;
    decodeFile(file,
      data => {
        const prod = products.find(p => p.id === data.id);
        if (!prod) { setErr("Producto no encontrado en la base de datos."); return; }
        if (mode === "multi") {
          setCart(prev => prev.find(i => i.product.id === prod.id) ? prev : [...prev, {product:prod, qty:""}]);
        } else {
          setScanned(data); setMode("confirm");
        }
      },
      msg => setErr(msg)
    );
    e.target.value = "";
  }

  function confirmSingle() {
    const prod = products.find(p => p.id === scanned.id);
    if (!prod || !destId) return;
    onSaveTransfer({ productId:prod.id, fromRestaurantId:prod.restaurantId, toRestaurantId:destId, qty:"", note, userId:currentUser?.id || "", date:today(), time:nowTime(), id:uid() });
    setTransferred(true);
    setTimeout(() => onClose(), 1400);
  }

  function confirmBulk() {
    if (!destId || cart.length === 0) return;
    cart.forEach(({product:p, qty}) => {
      onSaveTransfer({ productId:p.id, fromRestaurantId:p.restaurantId, toRestaurantId:destId, qty, note, userId:currentUser?.id||"", date:today(), time:nowTime(), id:uid() });
    });
    setMode("done");
  }

  const scannedProd    = scanned ? products.find(p => p.id === scanned.id) : null;
  const fromRest       = scannedProd ? restaurants.find(r => r.id === scannedProd.restaurantId) : null;
  const allDestOpts    = restaurants.map(r => ({value:r.id, label:r.name}));
  const singleDestOpts = scannedProd ? allDestOpts.filter(o => o.value !== scannedProd.restaurantId) : allDestOpts;

  const scanBtn = {
    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
    gap:10, padding:"28px 20px", borderRadius:14, border:"2px dashed #f97316",
    background:"#fff7ed", cursor:"pointer", width:"100%", textAlign:"center",
  };

  return (
    <div style={OVR} onClick={onClose}>
      <div style={{ ...MDL, width:440, maxHeight:"92vh", overflowY:"auto", padding:0 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding:"14px 18px", borderBottom:"1px solid #f1f5f9", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, background:"#fff", zIndex:10, borderRadius:"16px 16px 0 0" }}>
          <div>
            <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:"#64748b" }}>
              {mode==="scan"||mode==="confirm" ? "Escanear QR" : mode==="multi" ? "Carga múltiple" : "Completado"}
            </div>
            {mode==="multi"&&cart.length>0&&<div style={{ fontSize:11, color:"#f97316", fontWeight:700, marginTop:1 }}>{cart.length} productos en cola</div>}
          </div>
          <div style={{ display:"flex", gap:6 }}>
            {(mode==="scan"||mode==="confirm")&&<button onClick={()=>{setMode("multi");setScanned(null);}} style={{ ...B("ghost"), fontSize:11, padding:"4px 10px" }}>Carga múltiple</button>}
            {mode==="multi"&&<button onClick={()=>{setMode("scan");setCart([]);}} style={{ ...B("ghost"), fontSize:11, padding:"4px 10px" }}>Simple</button>}
            <button onClick={onClose} style={CBTN}>✕</button>
          </div>
        </div>

        <div style={{ padding:18, display:"flex", flexDirection:"column", gap:14 }}>
          {err && <div style={{ padding:12, background:"#fef2f2", borderRadius:8, color:"#dc2626", fontSize:13, display:"flex", justifyContent:"space-between" }}>{err}<button onClick={()=>setErr(null)} style={{ background:"none", border:"none", cursor:"pointer", color:"#dc2626", fontWeight:700 }}>✕</button></div>}
          {processing && <div style={{ textAlign:"center", padding:"12px 0", color:"#64748b", fontSize:13, display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}><Spinner/>Leyendo QR...</div>}

          {/* SCAN */}
          {mode==="scan"&&!processing&&(
            <>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={handleFile}/>
              <div onClick={()=>fileRef.current?.click()} style={scanBtn}>
                <div style={{ fontSize:52 }}>📷</div>
                <div style={{ fontWeight:800, fontSize:16, color:"#f97316" }}>Abrir cámara</div>
                <div style={{ fontSize:12, color:"#64748b", maxWidth:240 }}>Pulsa para fotografiar el código QR de la etiqueta</div>
              </div>
              <div style={{ textAlign:"center" }}>
                <input type="file" accept="image/*" style={{ display:"none" }} id="galleryPick" onChange={handleFile}/>
                <label htmlFor="galleryPick" style={{ ...B("ghost"), display:"inline-block", cursor:"pointer", fontSize:12 }}>O seleccionar de la galería</label>
              </div>
            </>
          )}

          {/* CONFIRM */}
          {mode==="confirm"&&scannedProd&&(
            <div>
              <div style={{ background:"#f0fdf4", border:"1px solid #86efac", borderRadius:10, padding:14, marginBottom:12 }}>
                <div style={{ fontWeight:800, fontSize:15, marginBottom:8, color:"#15803d" }}>✓ Producto identificado</div>
                {[["Nombre",scannedProd.name],["Origen",fromRest?.name||"—"],["Elaboración",fmt(scannedProd.elaboration)],["Caducidad",fmt(scannedProd.expiry)],scannedProd.quantity&&["Stock",`${scannedProd.quantity} ${scannedProd.unit||""}`]].filter(Boolean).map(([k,v]) => (
                  <div key={k} style={IROW}><span style={{ color:"#15803d", fontWeight:600 }}>{k}</span><span style={{ color:k==="Caducidad"&&isExp(scannedProd.expiry)?"#dc2626":"inherit" }}>{v}</span></div>
                ))}
              </div>
              {transferred
                ? <div style={{ background:"#f0fdf4", border:"1px solid #86efac", borderRadius:10, padding:14, textAlign:"center", fontWeight:700, color:"#15803d" }}>✓ Transferencia registrada</div>
                : <>
                    <Picker label="Local de destino" value={destId} onChange={setDestId} options={singleDestOpts} placeholder="Seleccionar destino..."/>
                    <label style={{ ...LBL, marginTop:10 }}>Nota<input style={INP} value={note} onChange={e=>setNote(e.target.value)} placeholder="Observaciones..."/></label>
                    <div style={{ display:"flex", gap:8, marginTop:12 }}>
                      <button onClick={confirmSingle} style={{ ...B("primary"), flex:1 }} disabled={!destId}>Confirmar transferencia</button>
                      <button onClick={()=>{setMode("scan");setScanned(null);}} style={{ ...B("ghost"), flexShrink:0 }}>← Volver</button>
                    </div>
                  </>
              }
            </div>
          )}

          {/* MULTI */}
          {mode==="multi"&&!processing&&(
            <div>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={handleFile}/>
              <div onClick={()=>fileRef.current?.click()} style={{ ...scanBtn, padding:"14px 20px", flexDirection:"row", gap:12, justifyContent:"flex-start" }}>
                <div style={{ fontSize:32 }}>📷</div>
                <div style={{ textAlign:"left" }}><div style={{ fontWeight:700, fontSize:14, color:"#f97316" }}>Escanear siguiente</div><div style={{ fontSize:11, color:"#64748b" }}>Pulsa para abrir la cámara</div></div>
              </div>
              {cart.length === 0
                ? <div style={{ textAlign:"center", padding:"12px 0", color:"#94a3b8", fontSize:13 }}>Cola vacía — escanea el primer producto</div>
                : <>
                    <div style={{ fontWeight:700, fontSize:13, marginBottom:8, marginTop:4 }}>Cola ({cart.length} productos)</div>
                    {cart.map(({product:p, qty}) => (
                      <div key={p.id} style={{ background:"#f8fafc", borderRadius:9, padding:"9px 12px", border:"1px solid #e2e8f0", display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:700, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</div>
                          <div style={{ fontSize:11, color:"#64748b" }}>{restaurants.find(r=>r.id===p.restaurantId)?.name||"—"}{p.quantity?` · ${p.quantity} ${p.unit||""}`:""}</div>
                        </div>
                        <input style={{ ...INP, width:68, padding:"5px 7px", fontSize:12, textAlign:"center" }} type="number" min="0" placeholder="Cant." value={qty} onChange={e=>setCart(c=>c.map(i=>i.product.id===p.id?{...i,qty:e.target.value}:i))}/>
                        <button onClick={()=>setCart(c=>c.filter(i=>i.product.id!==p.id))} style={{ ...B("red"), padding:"5px 8px", fontSize:12, flexShrink:0 }}>✕</button>
                      </div>
                    ))}
                    <Picker label="Destino (todos)" value={destId} onChange={setDestId} options={allDestOpts} placeholder="Seleccionar local..."/>
                    <label style={{ ...LBL, marginTop:10 }}>Nota<input style={INP} value={note} onChange={e=>setNote(e.target.value)} placeholder="Observaciones..."/></label>
                    <button onClick={confirmBulk} style={{ ...B("orange"), width:"100%", marginTop:12, fontSize:14 }} disabled={!destId||cart.length===0}>
                      Transferir {cart.length} producto{cart.length!==1?"s":""}
                    </button>
                  </>
              }
            </div>
          )}

          {/* DONE */}
          {mode==="done"&&(
            <div style={{ textAlign:"center", padding:"20px 0" }}>
              <div style={{ fontSize:48, marginBottom:10 }}>✅</div>
              <div style={{ fontWeight:800, fontSize:18, color:"#15803d", marginBottom:6 }}>Completado</div>
              <div style={{ fontSize:13, color:"#64748b", marginBottom:20 }}>{cart.length} producto{cart.length!==1?"s":""} transferido{cart.length!==1?"s":""} a <strong>{restaurants.find(r=>r.id===destId)?.name}</strong></div>
              <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
                <button onClick={()=>{setCart([]);setDestId("");setNote("");setMode("multi");}} style={{ ...B("orange"), flex:1 }}>Nueva carga</button>
                <button onClick={onClose} style={{ ...B("ghost"), flex:1 }}>Cerrar</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── RESTAURANT MODAL ──────────────────────────────────────────────────────────
function RestaurantModal({ restaurant, onClose, onSave, onDelete, productCount=0 }) {
  const isNew = !restaurant;
  const [f, setF] = useState(restaurant || { name:"", address:"", city:"", zip:"", phone:"", email:"", cif:"", manager:"", notes:"" });
  const [confirmDel, setConfirmDel] = useState(false);
  const set = k => e => setF(p => ({...p,[k]:e.target.value}));
  return (
    <div style={OVR} onClick={onClose}>
      <div style={{ ...MDL, maxWidth:520, maxHeight:"92vh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
        <div style={MHDR}>
          <div><div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:"#64748b" }}>{isNew?"Nuevo local":"Ficha del local"}</div>{!isNew&&<div style={{ fontWeight:800, fontSize:16, marginTop:2 }}>{f.name}</div>}</div>
          <button onClick={onClose} style={CBTN}>✕</button>
        </div>
        <div style={{ marginTop:16, display:"flex", flexDirection:"column", gap:12 }}>
          <div><STitle>Identificación</STitle>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <label style={{ ...LBL, gridColumn:"1/-1" }}>Nombre *<input style={INP} value={f.name} onChange={set("name")} placeholder="Ej: Local Centro"/></label>
              <label style={LBL}>CIF/NIF<input style={INP} value={f.cif} onChange={set("cif")} placeholder="B12345678"/></label>
              <label style={LBL}>Responsable<input style={INP} value={f.manager} onChange={set("manager")} placeholder="Nombre completo"/></label>
            </div>
          </div>
          <div><STitle>Contacto</STitle>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <label style={LBL}>Teléfono<input style={INP} value={f.phone} onChange={set("phone")}/></label>
              <label style={LBL}>Email<input style={INP} value={f.email} onChange={set("email")}/></label>
            </div>
          </div>
          <div><STitle>Dirección</STitle>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <label style={{ ...LBL, gridColumn:"1/-1" }}>Calle y número<input style={INP} value={f.address} onChange={set("address")}/></label>
              <label style={LBL}>Ciudad<input style={INP} value={f.city} onChange={set("city")}/></label>
              <label style={LBL}>CP<input style={INP} value={f.zip} onChange={set("zip")}/></label>
            </div>
          </div>
          <label style={LBL}>Notas<textarea style={{ ...INP, resize:"vertical", height:60 }} value={f.notes} onChange={set("notes")}/></label>
          {!isNew&&<div style={{ background:"#f8fafc", borderRadius:8, padding:10, fontSize:12, color:"#64748b" }}>{productCount} productos registrados</div>}
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={()=>{if(!f.name.trim())return;onSave({...f,id:f.id||uid()});onClose();}} style={{ ...B("primary"), flex:1 }} disabled={!f.name.trim()}>{isNew?"Crear local":"Guardar"}</button>
            {!isNew&&!confirmDel&&<button onClick={()=>setConfirmDel(true)} style={{ ...B("red"), flexShrink:0 }}>🗑</button>}
            {!isNew&&confirmDel&&<div style={{ display:"flex", gap:6, flex:1 }}><button onClick={()=>{onDelete(f.id);onClose();}} style={{ ...B("red"), flex:1 }}>Sí</button><button onClick={()=>setConfirmDel(false)} style={{ ...B("ghost"), flex:1 }}>No</button></div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PRODUCT MODAL ─────────────────────────────────────────────────────────────
function ProductModal({ product, restaurants, categories, catalog, currentUser, onClose, onSave }) {
  const isEdit = !!product;
  const [step, setStep] = useState(isEdit?"form":"pick");
  const [search, setSearch] = useState("");
  const defaultForm = { name:"", category:categories[0]?.id||"otros", restaurantId:currentUser?.restaurantId||restaurants[0]?.id||"", elaboration:today(), expiry:addDays(today(),7), quantity:"", unit:"kg", lot:"", notes:"" };
  const [f, setF] = useState(product||defaultForm);
  const [catOpen, setCatOpen] = useState(false);
  const curCat = categories.find(c=>c.id===f.category);

  function applyTemplate(tpl) {
    setF({ ...defaultForm, name:tpl.name, category:tpl.category, unit:tpl.unit, notes:tpl.notes||"", expiry:addDays(today(),tpl.defaultDays||7), elaboration:today() });
    setStep("form");
  }

  const grouped = {};
  catalog.filter(t=>!search||t.name.toLowerCase().includes(search.toLowerCase())).forEach(t=>{
    if(!grouped[t.category]) grouped[t.category]=[];
    grouped[t.category].push(t);
  });

  return (
    <div style={OVR} onClick={onClose}>
      <div style={{ ...MDL, width:500, maxHeight:"92vh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
        <div style={MHDR}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:"#64748b" }}>
              {isEdit?"Editar producto":step==="pick"?"Nuevo producto — Plantilla":"Nuevo producto — Detalles"}
            </div>
            {step==="form"&&!isEdit&&f.name&&<div style={{ fontWeight:800, fontSize:15, marginTop:1 }}>{f.name}</div>}
          </div>
          <div style={{ display:"flex", gap:6 }}>
            {step==="form"&&!isEdit&&<button onClick={()=>{setStep("pick");setF(defaultForm);}} style={{ ...B("ghost"), fontSize:11, padding:"4px 10px" }}>← Plantillas</button>}
            <button onClick={onClose} style={CBTN}>✕</button>
          </div>
        </div>

        {step==="pick"&&(
          <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:12 }}>
            <input style={INP} value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Buscar en el catálogo..."/>
            {catalog.length===0?(
              <div style={{ textAlign:"center", padding:"24px 0", color:"#94a3b8" }}>
                <div style={{ fontSize:32, marginBottom:8 }}>📋</div>
                <div style={{ fontWeight:600 }}>Catálogo vacío</div>
                <div style={{ fontSize:12, marginTop:4, marginBottom:14 }}>Añade plantillas en Ajustes → Catálogo</div>
                <button onClick={()=>setStep("form")} style={{ ...B("ghost"), fontSize:13 }}>Crear sin plantilla →</button>
              </div>
            ):(
              <>
                {Object.entries(grouped).map(([catId,items])=>{
                  const cat=categories.find(c=>c.id===catId);
                  return(
                    <div key={catId}>
                      <div style={{ fontSize:11, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>{cat?.icon} {cat?.label||catId}</div>
                      {items.map(tpl=>(
                        <button key={tpl.id} onClick={()=>applyTemplate(tpl)}
                          style={{ background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:10, padding:"10px 14px", cursor:"pointer", textAlign:"left", display:"flex", alignItems:"center", gap:10, width:"100%", marginBottom:6 }}>
                          <div style={{ width:36, height:36, borderRadius:8, background:"#fff", border:"1px solid #e2e8f0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{cat?.icon||"📦"}</div>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:700, fontSize:13 }}>{tpl.name}</div>
                            <div style={{ fontSize:11, color:"#94a3b8" }}>{tpl.unit} · caduca en {tpl.defaultDays}d</div>
                          </div>
                          <span style={{ color:"#94a3b8", fontSize:18 }}>›</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
                <div style={{ borderTop:"1px solid #f1f5f9", paddingTop:12 }}>
                  <button onClick={()=>setStep("form")} style={{ ...B("ghost"), width:"100%", fontSize:13 }}>✏️ Crear desde cero</button>
                </div>
              </>
            )}
          </div>
        )}

        {step==="form"&&(
          <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:11 }}>
            <div>
              <div style={{ fontSize:12, fontWeight:600, color:"#475569", marginBottom:5 }}>Categoría</div>
              {!catOpen
                ?<button onClick={()=>setCatOpen(true)} style={{ ...B("ghost"), width:"100%", textAlign:"left", display:"flex", alignItems:"center", gap:8 }}>{curCat?.icon||"📦"} {curCat?.label||"Seleccionar..."}<span style={{ marginLeft:"auto", color:"#94a3b8" }}>▾</span></button>
                :<div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5, maxHeight:220, overflowY:"auto" }}>{categories.map(c=><button key={c.id} onClick={()=>{setF({...f,category:c.id});setCatOpen(false);}} style={{ ...B(f.category===c.id?"primary":"ghost"), textAlign:"left", padding:"6px 9px", fontSize:12, display:"flex", alignItems:"center", gap:5 }}>{c.icon} {c.label}</button>)}</div>
              }
            </div>
            <label style={LBL}>Nombre *<input style={INP} value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="Ej: Caldo de pollo"/></label>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <label style={LBL}>Local *<select style={INP} value={f.restaurantId} onChange={e=>setF({...f,restaurantId:e.target.value})}>{restaurants.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
              <label style={LBL}>Lote<input style={INP} value={f.lot} onChange={e=>setF({...f,lot:e.target.value})} placeholder="L2025-001"/></label>
              <label style={LBL}>Elaboración<input style={INP} type="date" value={f.elaboration} onChange={e=>setF({...f,elaboration:e.target.value})}/></label>
              <label style={LBL}>Caducidad<input style={INP} type="date" value={f.expiry} onChange={e=>setF({...f,expiry:e.target.value})}/></label>
              <label style={LBL}>Cantidad<input style={INP} type="number" min="0" value={f.quantity} onChange={e=>setF({...f,quantity:e.target.value})} placeholder="0"/></label>
              <label style={LBL}>Unidad<select style={INP} value={f.unit} onChange={e=>setF({...f,unit:e.target.value})}>{["kg","g","l","ml","ud","raciones","bandejas","porciones"].map(u=><option key={u}>{u}</option>)}</select></label>
            </div>
            <label style={LBL}>Notas / Alérgenos<textarea style={{ ...INP, resize:"vertical", height:60 }} value={f.notes} onChange={e=>setF({...f,notes:e.target.value})} placeholder="Alérgenos, ingredientes..."/></label>
            <button onClick={()=>{if(!f.name||!f.restaurantId)return;onSave({...f,id:f.id||uid(),createdBy:currentUser?.id||""});onClose();}} style={{ ...B("primary"), width:"100%" }} disabled={!f.name||!f.restaurantId}>
              {isEdit?"Guardar cambios":"Registrar elaboración"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── TRANSFER MODAL ────────────────────────────────────────────────────────────
function TransferModal({ products, restaurants, currentUser, onClose, onSave }) {
  const [f, setF] = useState({ productId:"", toRestaurantId:"", qty:"", note:"" });
  const prod     = products.find(p => p.id === f.productId);
  const fromRest = prod ? restaurants.find(r => r.id === prod.restaurantId) : null;
  const destOptions = restaurants.filter(r => !prod || r.id !== prod.restaurantId).map(r => ({value:r.id,label:r.name}));
  const productOptions = products.map(p => ({ value:p.id, label:`${p.name} — ${restaurants.find(r=>r.id===p.restaurantId)?.name||""}` }));

  const stock      = parseFloat(prod?.quantity);
  const hasStock   = prod && !isNaN(stock) && prod.quantity !== "" && prod.quantity !== undefined && prod.quantity !== null;
  const qtyVal     = parseFloat(f.qty);
  const overStock  = hasStock && !isNaN(qtyVal) && qtyVal > stock;
  const remaining  = hasStock && !isNaN(qtyVal) ? Math.max(0, stock - qtyVal) : null;

  return (
    <div style={OVR} onClick={onClose}>
      <div style={{ ...MDL, width:420 }} onClick={e=>e.stopPropagation()}>
        <div style={MHDR}><span style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:".08em", color:"#64748b" }}>Nueva transferencia</span><button onClick={onClose} style={CBTN}>✕</button></div>
        <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:11 }}>
          <Picker label="Producto" value={f.productId} onChange={v=>setF({...f,productId:v,toRestaurantId:""})} options={productOptions} placeholder="Seleccionar producto..."/>
          {prod&&(
            <div style={{ background:overStock?"#fef2f2":"#f8fafc", borderRadius:8, padding:10, fontSize:12, color:"#475569", border:`1px solid ${overStock?"#fecaca":"#e2e8f0"}` }}>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <span>Origen: <strong>{fromRest?.name||"—"}</strong></span>
                {hasStock&&<span style={{ fontWeight:700, color:overStock?"#dc2626":"#1e293b" }}>Stock: {prod.quantity} {prod.unit}</span>}
              </div>
              {remaining !== null && f.qty && (
                <div style={{ marginTop:5, display:"flex", gap:6 }}>
                  <span style={{ background:overStock?"#fecaca":"#dcfce7", color:overStock?"#dc2626":"#16a34a", borderRadius:5, padding:"2px 7px", fontWeight:700, fontSize:11 }}>
                    {overStock?"⚠️ Supera el stock":`Quedan: ${remaining} ${prod.unit}`}
                  </span>
                  {!overStock&&<span style={{ background:"#eff6ff", color:"#2563eb", borderRadius:5, padding:"2px 7px", fontWeight:700, fontSize:11 }}>Destino: {qtyVal} {prod.unit}</span>}
                </div>
              )}
            </div>
          )}
          <Picker label="Destino" value={f.toRestaurantId} onChange={v=>setF({...f,toRestaurantId:v})} options={destOptions} placeholder={prod?"Seleccionar destino...":"Selecciona un producto primero"}/>
          <label style={LBL}>Cantidad<input style={INP} type="number" min="0" placeholder={hasStock?`Máx: ${prod.quantity} ${prod.unit||""}`:"Ej: 5"} value={f.qty} onChange={e=>setF({...f,qty:e.target.value})}/></label>
          <label style={LBL}>Nota (opcional)<input style={INP} value={f.note} onChange={e=>setF({...f,note:e.target.value})} placeholder="Observaciones..."/></label>
          {currentUser&&<div style={{ background:"#f8fafc", borderRadius:8, padding:8, fontSize:12, color:"#64748b" }}>✍️ Firmado por: <strong>{currentUser.name}</strong></div>}
          <button onClick={()=>{ if(!f.productId||!f.toRestaurantId)return; onSave({...f,fromRestaurantId:prod?.restaurantId,userId:currentUser?.id||"",date:today(),time:nowTime(),id:uid()}); onClose(); }} style={{ ...B("primary"), width:"100%" }} disabled={!f.productId||!f.toRestaurantId}>
            Registrar transferencia →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SIDEBAR ───────────────────────────────────────────────────────────────────
function Sidebar({ open, onClose, tab, setTab, restsCount, allCount, currentUser, onChangeUser, onNewProduct, onExport, onScan }) {
  return (
    <>
      <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:200, background:"rgba(15,23,42,0.5)", backdropFilter:"blur(2px)", opacity:open?1:0, pointerEvents:open?"auto":"none", transition:"opacity .25s" }}/>
      <div style={{ position:"fixed", top:0, left:0, bottom:0, width:264, zIndex:201, background:"#1e293b", transform:open?"translateX(0)":"translateX(-100%)", transition:"transform .28s cubic-bezier(.4,0,.2,1)", display:"flex", flexDirection:"column", boxShadow:"4px 0 24px rgba(0,0,0,.3)" }}>
        <div style={{ padding:"18px 20px 14px", borderBottom:"1px solid rgba(255,255,255,.08)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:34, height:34, background:"#f97316", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17 }}>⊛</div>
            <span style={{ fontWeight:800, fontSize:17, color:"#fff", letterSpacing:"-0.02em" }}>Traza<span style={{ color:"#f97316" }}>Pro</span></span>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#64748b", fontSize:20, lineHeight:1, padding:4 }}>✕</button>
        </div>

        {/* Current user */}
        {currentUser&&(
          <button onClick={()=>{onChangeUser();onClose();}} style={{ margin:"12px 12px 0", background:"rgba(249,115,22,.15)", border:"1px solid rgba(249,115,22,.3)", borderRadius:10, padding:"10px 12px", cursor:"pointer", textAlign:"left", display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:34, height:34, borderRadius:"50%", background:"#f97316", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, fontWeight:800, color:"#fff", flexShrink:0 }}>{currentUser.name.charAt(0).toUpperCase()}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:700, fontSize:13, color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{currentUser.name}</div>
              <div style={{ fontSize:11, color:"#94a3b8" }}>{currentUser.role||"Sin rol"} · Cambiar</div>
            </div>
          </button>
        )}

        <nav style={{ flex:1, overflowY:"auto", padding:"10px 12px" }}>
          {NAVS.map(n => {
            const active = tab === n.id;
            const badge  = n.id==="restaurants"?restsCount:n.id==="products"?allCount:null;
            return (
              <button key={n.id} onClick={()=>{setTab(n.id);onClose();}} style={{ width:"100%", display:"flex", alignItems:"center", gap:12, padding:"11px 14px", borderRadius:10, border:"none", cursor:"pointer", marginBottom:3, textAlign:"left", background:active?"rgba(249,115,22,.15)":"transparent", color:active?"#f97316":"#94a3b8", fontWeight:active?700:500, fontSize:14 }}>
                <span style={{ fontSize:18, width:22, textAlign:"center" }}>{n.icon}</span>
                <span style={{ flex:1 }}>{n.l}</span>
                {badge!=null&&badge>0&&<span style={{ background:active?"#f97316":"rgba(255,255,255,.12)", color:active?"#fff":"#94a3b8", borderRadius:10, padding:"1px 7px", fontSize:11, fontWeight:700 }}>{badge}</span>}
                {active&&<span style={{ width:3, height:20, background:"#f97316", borderRadius:2, flexShrink:0 }}/>}
              </button>
            );
          })}
        </nav>

        <div style={{ padding:"12px 14px", borderTop:"1px solid rgba(255,255,255,.08)", display:"flex", flexDirection:"column", gap:8 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#475569", marginBottom:2 }}>Acciones rápidas</div>
          <button onClick={()=>{onNewProduct();onClose();}} style={{ ...B("orange"), width:"100%", textAlign:"left", display:"flex", alignItems:"center", gap:8, fontSize:13 }}>＋ Nuevo producto</button>
          <button onClick={()=>{onScan();onClose();}} style={{ width:"100%", textAlign:"left", display:"flex", alignItems:"center", gap:8, fontSize:13, background:"rgba(255,255,255,.07)", color:"#cbd5e1", border:"none", borderRadius:8, padding:"9px 14px", cursor:"pointer", fontWeight:600 }}>📷 Escanear QR</button>
          <button onClick={onExport} style={{ width:"100%", textAlign:"left", display:"flex", alignItems:"center", gap:8, fontSize:13, background:"rgba(255,255,255,.07)", color:"#cbd5e1", border:"none", borderRadius:8, padding:"9px 14px", cursor:"pointer", fontWeight:600 }}>📊 Exportar Excel</button>
        </div>
      </div>
    </>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [loading,      setLoading]      = useState(true);
  const [currentUser,  setCurrentUser]  = useState(null);
  const [showUserSel,  setShowUserSel]  = useState(false);
  const [tab,          setTab]          = useState("dashboard");
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const [modal,        setModal]        = useState(null);
  const [sel,          setSel]          = useState(null);
  const [search,       setSearch]       = useState("");
  const [fRest,        setFRest]        = useState("all");
  const [fCat,         setFCat]         = useState("all");
  const [fSt,          setFSt]          = useState("all");

  // Firebase data
  const [restaurants,  setRestaurants]  = useState([]);
  const [products,     setProducts]     = useState([]);
  const [transfers,    setTransfers]    = useState([]);
  const [history,      setHistory]      = useState([]);
  const [categories,   setCategories]   = useState(DEFAULT_CATS);
  const [catalog,      setCatalog]      = useState([]);
  const [users,        setUsers]        = useState([]);

  // Subscribe to all Firestore collections
  useEffect(() => {
    const unsubs = [
      onSnapshot(query(collection(db,"restaurants"),orderBy("name")),    s=>setRestaurants(s.docs.map(d=>({id:d.id,...d.data()}))), ()=>{}),
      onSnapshot(query(collection(db,"products")),                        s=>setProducts(s.docs.map(d=>({id:d.id,...d.data()}))), ()=>{}),
      onSnapshot(query(collection(db,"transfers"),orderBy("date","desc")),s=>setTransfers(s.docs.map(d=>({id:d.id,...d.data()}))), ()=>{}),
      onSnapshot(query(collection(db,"history"),  orderBy("date","desc")),s=>setHistory(s.docs.map(d=>({id:d.id,...d.data()}))), ()=>{}),
      onSnapshot(collection(db,"categories"),                             s=>{ const docs=s.docs.map(d=>({id:d.id,...d.data()})); setCategories(docs.length?docs:DEFAULT_CATS); }, ()=>{}),
      onSnapshot(collection(db,"catalog"),                                s=>setCatalog(s.docs.map(d=>({id:d.id,...d.data()}))), ()=>{}),
      onSnapshot(query(collection(db,"users"),orderBy("name")),           s=>setUsers(s.docs.map(d=>({id:d.id,...d.data()}))), ()=>{}),
    ];
    setTimeout(()=>setLoading(false), 1200);
    return () => unsubs.forEach(u=>u());
  }, []);

  // Restore user from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("trazapro_user");
    if (saved) { try { setCurrentUser(JSON.parse(saved)); } catch {} }
    else setShowUserSel(true);
  }, []);

  function selectUser(u) {
    setCurrentUser(u);
    localStorage.setItem("trazapro_user", JSON.stringify(u));
    setShowUserSel(false);
  }

  function addHistEntry(type, productId, restaurantId, detail, productName) {
    fbAdd("history", { type, productId, restaurantId, detail, productName, userId:currentUser?.id||"", date:today(), time:nowTime() });
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────
  async function saveRestaurant(r) { await fbSet("restaurants", r.id, r); }
  async function deleteRestaurant(id) {
    await fbDel("restaurants", id);
    products.filter(p=>p.restaurantId===id).forEach(p=>fbDel("products",p.id));
  }

  async function saveCategory(c) { await fbSet("categories", c.id, c); }
  async function deleteCategory(id) {
    await fbDel("categories", id);
    const fallback = categories.find(c=>c.id!==id)?.id||"otros";
    products.filter(p=>p.category===id).forEach(p=>fbSet("products",p.id,{category:fallback}));
  }

  async function saveCatalogItem(item) { await fbSet("catalog", item.id, item); }
  async function deleteCatalogItem(id) { await fbDel("catalog", id); }

  async function saveUser(u) { await fbSet("users", u.id, u); }
  async function deleteUser(id) { await fbDel("users", id); }

  async function saveProduct(p) {
    const isNew = !products.find(x=>x.id===p.id);
    await fbSet("products", p.id, p);
    const rest = restaurants.find(r=>r.id===p.restaurantId);
    addHistEntry(isNew?"created":"edited", p.id, p.restaurantId, isNew?`Creado en ${rest?.name}`:`Editado: ${p.name}`, p.name);
  }
  async function deleteProduct(id) {
    await fbDel("products", id);
  }

  async function saveTransfer(t) {
    const p      = products.find(x=>x.id===t.productId);
    const from   = restaurants.find(r=>r.id===t.fromRestaurantId);
    const to     = restaurants.find(r=>r.id===t.toRestaurantId);
    const qty    = parseFloat(t.qty)||0;
    const originStock = parseFloat(p?.quantity);
    const hasStock    = qty>0 && p && !isNaN(originStock) && p.quantity!=="" && p.quantity!==undefined && p.quantity!==null;
    const remaining   = hasStock ? Math.max(0, originStock-qty) : null;

    // Save transfer record
    await fbAdd("transfers", t);

    if (!p) return;

    if (!hasStock) {
      // No stock tracking — just move product
      await fbSet("products", p.id, { restaurantId:t.toRestaurantId });
    } else if (remaining === 0) {
      // Full transfer
      await fbSet("products", p.id, { quantity:qty, restaurantId:t.toRestaurantId });
    } else {
      // Partial transfer — reduce origin, create new entry at destination
      await fbSet("products", p.id, { quantity:remaining });
      const newId = uid();
      await fbSet("products", newId, { ...p, id:newId, restaurantId:t.toRestaurantId, quantity:qty, createdAt:today(), createdBy:currentUser?.id||"" });
    }

    const detail = `De ${from?.name||"—"} → ${to?.name||"—"}${qty>0?` (${qty} ${p?.unit||""})`:""}${t.note?` · ${t.note}`:""}`;
    addHistEntry("transferred", t.productId, t.toRestaurantId, detail, p?.name);
  }

  // ── Derived state ────────────────────────────────────────────────────────────
  const cats    = categories.length ? categories : DEFAULT_CATS;
  const cmap    = Object.fromEntries(cats.map(c=>[c.id,c]));
  const umap    = Object.fromEntries(users.map(u=>[u.id,u]));
  const expired = products.filter(p=>isExp(p.expiry));
  const near    = products.filter(p=>isNear(p.expiry));
  const curNav  = NAVS.find(n=>n.id===tab);

  const filtered = products.filter(p=>{
    const ms=!search||p.name.toLowerCase().includes(search.toLowerCase())||p.lot?.toLowerCase().includes(search.toLowerCase());
    const mr=fRest==="all"||p.restaurantId===fRest;
    const mc=fCat==="all"||p.category===fCat;
    const mst=fSt==="all"||(fSt==="expired"&&isExp(p.expiry))||(fSt==="near"&&isNear(p.expiry))||(fSt==="ok"&&!isExp(p.expiry)&&!isNear(p.expiry));
    return ms&&mr&&mc&&mst;
  });

  // ── Loading / User select ────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#1e293b", flexDirection:"column", gap:12 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width:48, height:48, background:"#f97316", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>⊛</div>
      <Spinner/>
      <span style={{ color:"#64748b", fontSize:13 }}>Conectando con Firebase...</span>
    </div>
  );

  if (showUserSel || !currentUser) return (
    <>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}*{box-sizing:border-box;-webkit-font-smoothing:antialiased}body{margin:0;font-family:'DM Sans',system-ui,sans-serif}`}</style>
      <UserSelectScreen users={users} onSelect={selectUser} onCreateFirst={()=>{ setShowUserSel(false); setModal("user"); setSel(null); }}/>
      {modal==="user"&&<UserModal user={null} restaurants={restaurants} onClose={()=>{setModal(null);if(!currentUser)setShowUserSel(true);}} onSave={async u=>{await saveUser(u);selectUser(u);}} onDelete={()=>{}}/>}
    </>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#f1f5f9", fontFamily:"'DM Sans',system-ui,sans-serif", color:"#1e293b" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;-webkit-font-smoothing:antialiased}button:disabled{opacity:.4;cursor:not-allowed!important}input:focus,select:focus,textarea:focus{outline:none;border-color:#1e293b!important;box-shadow:0 0 0 3px rgba(30,41,59,.08)}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <Sidebar open={sidebarOpen} onClose={()=>setSidebarOpen(false)} tab={tab} setTab={setTab}
        restsCount={restaurants.length} allCount={products.length}
        currentUser={currentUser} onChangeUser={()=>setShowUserSel(true)}
        onNewProduct={()=>{setSel(null);setModal("product");}}
        onExport={()=>exportXLS({restaurants,products,transfers,history,categories:cats,users})}
        onScan={()=>setModal("scanner")}
      />

      {/* Topbar */}
      <div style={{ background:"#1e293b", color:"#fff", padding:"0 16px", height:56, display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:100, gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={()=>setSidebarOpen(true)} style={{ background:"none", border:"none", cursor:"pointer", padding:6, display:"flex", flexDirection:"column", gap:5 }}>
            {[0,1,2].map(i=><span key={i} style={{ display:"block", width:22, height:2, background:"#fff", borderRadius:2 }}/>)}
          </button>
          <div style={{ width:30, height:30, background:"#f97316", borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 }}>⊛</div>
          <span style={{ fontWeight:800, fontSize:15, letterSpacing:"-0.02em" }}>Traza<span style={{ color:"#f97316" }}>Pro</span></span>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <button onClick={()=>setShowUserSel(true)} style={{ background:"rgba(255,255,255,.1)", border:"none", cursor:"pointer", color:"#fff", borderRadius:7, padding:"5px 10px", fontSize:12, fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:22, height:22, borderRadius:"50%", background:"#f97316", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800 }}>{currentUser.name.charAt(0).toUpperCase()}</div>
            <span style={{ maxWidth:80, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{currentUser.name}</span>
          </button>
          <button onClick={()=>setModal("scanner")} style={{ background:"rgba(255,255,255,.1)", border:"none", cursor:"pointer", color:"#fff", borderRadius:7, padding:"6px 10px", fontSize:12, fontWeight:600 }}>📷</button>
          <button onClick={()=>{setSel(null);setModal("product");}} style={{ ...B("orange"), fontSize:12, padding:"6px 12px" }}>+ Producto</button>
        </div>
      </div>

      {/* Page title */}
      <div style={{ background:"#fff", borderBottom:"1px solid #e2e8f0", padding:"9px 20px", display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:17 }}>{curNav?.icon}</span>
        <span style={{ fontWeight:700, fontSize:14 }}>{curNav?.l}</span>
        {tab==="products"&&products.length>0&&<span style={bdg("neutral")}>{products.length} productos</span>}
        {tab==="restaurants"&&<span style={bdg("blue")}>{restaurants.length} locales</span>}
      </div>

      <div style={{ maxWidth:980, margin:"0 auto", padding:"18px 14px" }}>

        {/* ── DASHBOARD ── */}
        {tab==="dashboard"&&(
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:10, marginBottom:16 }}>
              {[{l:"Locales",v:restaurants.length,i:"🏠",c:"#0ea5e9"},{l:"Productos",v:products.length,i:"📦",c:"#1e293b"},{l:"Caducados",v:expired.length,i:"⚠️",c:"#dc2626"},{l:"Caduca pronto",v:near.length,i:"⏱",c:"#d97706"},{l:"Transferencias",v:transfers.length,i:"⇄",c:"#7c3aed"},{l:"Usuarios",v:users.length,i:"👤",c:"#0891b2"}].map(card=>(
                <div key={card.l} style={{ background:"#fff", borderRadius:12, padding:"13px 14px", border:"1px solid #e2e8f0", boxShadow:"0 1px 3px rgba(0,0,0,.04)" }}>
                  <div style={{ fontSize:20, marginBottom:3 }}>{card.i}</div>
                  <div style={{ fontSize:24, fontWeight:800, color:card.c, lineHeight:1 }}>{card.v}</div>
                  <div style={{ fontSize:11, color:"#94a3b8", marginTop:3 }}>{card.l}</div>
                </div>
              ))}
            </div>

            {(expired.length>0||near.length>0)&&(
              <div style={{ background:"#fff", borderRadius:12, border:"1px solid #fecaca", padding:14, marginBottom:14 }}>
                <div style={{ fontWeight:700, fontSize:13, marginBottom:8 }}>🔔 Alertas de caducidad</div>
                {[...expired.map(p=>({...p,_t:"e"})),...near.map(p=>({...p,_t:"n"}))].map(p=>(
                  <div key={p.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid #fef2f2", gap:6, flexWrap:"wrap" }}>
                    <div><span style={{ fontWeight:600, fontSize:13 }}>{p.name}</span><span style={{ color:"#94a3b8", fontSize:11, marginLeft:6 }}>{restaurants.find(r=>r.id===p.restaurantId)?.name}</span></div>
                    <StatusBadge expiry={p.expiry}/>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
              <div style={{ background:"#fff", borderRadius:12, border:"1px solid #e2e8f0", padding:14 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                  <div style={{ fontWeight:700, fontSize:13 }}>Últimas transferencias</div>
                  <button onClick={()=>setModal("transfer")} style={{ ...B("orange"), fontSize:11, padding:"4px 10px" }}>+ Nueva</button>
                </div>
                {transfers.slice(0,6).map(t=>{
                  const p=products.find(x=>x.id===t.productId), to=restaurants.find(r=>r.id===t.toRestaurantId), from=restaurants.find(r=>r.id===t.fromRestaurantId), u=umap[t.userId];
                  return(
                    <div key={t.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 0", borderBottom:"1px solid #f1f5f9", fontSize:12 }}>
                      <span>⇄</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:600 }}>{p?.name||"—"}</div>
                        <div style={{ color:"#94a3b8", fontSize:11 }}>{from?.name||"—"} → {to?.name||"—"}{u?` · ${u.name}`:""}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ background:"#fff", borderRadius:12, border:"1px solid #e2e8f0", padding:14 }}>
                <div style={{ fontWeight:700, fontSize:13, marginBottom:10 }}>Mis locales</div>
                {restaurants.map(r=>{
                  const cnt=products.filter(p=>p.restaurantId===r.id).length, exp=products.filter(p=>p.restaurantId===r.id&&isExp(p.expiry)).length;
                  return(
                    <div key={r.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"5px 0", borderBottom:"1px solid #f1f5f9", cursor:"pointer" }} onClick={()=>{setSel(r);setModal("restaurant");}}>
                      <div><div style={{ fontWeight:600, fontSize:13 }}>{r.name}</div>{r.city&&<div style={{ fontSize:11, color:"#94a3b8" }}>{r.city}</div>}</div>
                      <div style={{ display:"flex", gap:8, alignItems:"center", fontSize:12 }}><span style={{ color:"#64748b" }}>{cnt} prod.</span>{exp>0&&<span style={bdg("red")}>{exp}</span>}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── LOCALES ── */}
        {tab==="restaurants"&&(
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div style={{ fontWeight:700, fontSize:15 }}>{restaurants.length} local{restaurants.length!==1?"es":""}</div>
              <button onClick={()=>{setSel(null);setModal("restaurant");}} style={B("orange")}>+ Nuevo local</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 }}>
              {restaurants.map(r=>{
                const pCount=products.filter(p=>p.restaurantId===r.id).length, expCount=products.filter(p=>p.restaurantId===r.id&&isExp(p.expiry)).length;
                return(
                  <div key={r.id} style={{ background:"#fff", borderRadius:14, border:"1px solid #e2e8f0", overflow:"hidden" }}>
                    <div style={{ background:"#1e293b", padding:"14px 16px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ width:36, height:36, background:"#f97316", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🏠</div>
                        <div><div style={{ fontWeight:800, fontSize:14, color:"#fff" }}>{r.name}</div>{r.city&&<div style={{ fontSize:11, color:"#94a3b8" }}>{r.city}</div>}</div>
                      </div>
                      <button onClick={()=>{setSel(r);setModal("restaurant");}} style={{ background:"rgba(255,255,255,.12)", border:"none", cursor:"pointer", borderRadius:7, padding:"5px 10px", color:"#fff", fontSize:12, fontWeight:600 }}>✏️ Editar</button>
                    </div>
                    <div style={{ padding:"12px 16px" }}>
                      <div style={{ display:"flex", gap:12, paddingBottom:10, borderBottom:"1px solid #f1f5f9" }}>
                        <div style={{ textAlign:"center" }}><div style={{ fontWeight:800, fontSize:20 }}>{pCount}</div><div style={{ fontSize:10, color:"#94a3b8" }}>productos</div></div>
                        {expCount>0&&<div style={{ textAlign:"center" }}><div style={{ fontWeight:800, fontSize:20, color:"#dc2626" }}>{expCount}</div><div style={{ fontSize:10, color:"#94a3b8" }}>caducados</div></div>}
                      </div>
                      {[r.cif&&["🏢",r.cif],r.manager&&["👤",r.manager],r.phone&&["📞",r.phone],r.email&&["✉️",r.email]].filter(Boolean).map(([icon,val])=>(
                        <div key={icon} style={{ display:"flex", gap:8, fontSize:12, marginTop:6 }}><span>{icon}</span><span style={{ color:"#475569" }}>{val}</span></div>
                      ))}
                      <div style={{ display:"flex", gap:6, marginTop:10 }}>
                        <button onClick={()=>{setFRest(r.id);setTab("products");}} style={{ ...B("ghost"), flex:1, fontSize:12, padding:"6px 8px" }}>Ver productos</button>
                        <button onClick={()=>setModal("transfer")} style={{ ...B("blue"), flex:1, fontSize:12, padding:"6px 8px" }}>Transferir</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── PRODUCTOS ── */}
        {tab==="products"&&(
          <div>
            <div style={{ display:"flex", gap:7, marginBottom:12, flexWrap:"wrap" }}>
              <input style={{ ...INP, flex:"1 1 160px" }} placeholder="🔍 Buscar nombre o lote..." value={search} onChange={e=>setSearch(e.target.value)}/>
              <select style={{ ...INP, width:"auto" }} value={fRest} onChange={e=>setFRest(e.target.value)}><option value="all">Todos los locales</option>{restaurants.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
              <select style={{ ...INP, width:"auto" }} value={fCat} onChange={e=>setFCat(e.target.value)}><option value="all">Todas las categorías</option>{cats.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}</select>
              <select style={{ ...INP, width:"auto" }} value={fSt} onChange={e=>setFSt(e.target.value)}><option value="all">Todos los estados</option><option value="ok">✅ OK</option><option value="near">⏱ Caduca pronto</option><option value="expired">⚠️ Caducado</option></select>
            </div>
            {filtered.length===0
              ?<div style={{ textAlign:"center", padding:"50px 0", color:"#94a3b8" }}><div style={{ fontSize:36, marginBottom:8 }}>📦</div><div style={{ fontWeight:600 }}>Sin productos</div></div>
              :<div style={{ display:"grid", gap:7 }}>
                {filtered.map(p=>{
                  const rest=restaurants.find(r=>r.id===p.restaurantId), cat=cmap[p.category], creator=umap[p.createdBy];
                  return(
                    <div key={p.id} style={{ background:"#fff", borderRadius:11, border:`1px solid ${isExp(p.expiry)?"#fecaca":"#e2e8f0"}`, padding:"11px 13px", display:"flex", gap:10, alignItems:"center" }}>
                      <div style={{ width:40, height:40, background:isExp(p.expiry)?"#fef2f2":"#f1f5f9", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{cat?.icon||"📦"}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:5, flexWrap:"wrap" }}><span style={{ fontWeight:700, fontSize:13 }}>{p.name}</span><StatusBadge expiry={p.expiry}/>{cat&&<span style={{ fontSize:10, color:"#64748b", background:"#f8fafc", borderRadius:4, padding:"1px 5px", border:"1px solid #e2e8f0" }}>{cat.label}</span>}</div>
                        <div style={{ fontSize:11, color:"#64748b", marginTop:2, display:"flex", flexWrap:"wrap", gap:"0 8px" }}>
                          <span>🏠 {rest?.name}</span>{p.elaboration&&<span>📅 {fmt(p.elaboration)}</span>}{p.expiry&&<span>⏱ {fmt(p.expiry)}</span>}{p.quantity&&<span>📊 {p.quantity} {p.unit}</span>}{p.lot&&<span>🔢 {p.lot}</span>}{creator&&<span style={{ color:"#7c3aed" }}>✍️ {creator.name}</span>}
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                        <button onClick={()=>{setSel(p);setModal("label");}} style={{ ...B("ghost"), padding:"5px 8px", fontSize:11 }}>🏷</button>
                        <button onClick={()=>{setSel(p);setModal("product");}} style={{ ...B("ghost"), padding:"5px 8px", fontSize:11 }}>✏️</button>
                        <button onClick={()=>deleteProduct(p.id)} style={{ ...B("red"), padding:"5px 8px", fontSize:11 }}>🗑</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            }
          </div>
        )}

        {/* ── TRANSFERENCIAS ── */}
        {tab==="transfers"&&(
          <div>
            <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:12 }}><button onClick={()=>setModal("transfer")} style={B("orange")}>+ Nueva transferencia</button></div>
            {transfers.length===0
              ?<div style={{ textAlign:"center", padding:"50px 0", color:"#94a3b8" }}><div style={{ fontSize:36, marginBottom:8 }}>⇄</div><div style={{ fontWeight:600 }}>Sin transferencias</div></div>
              :<div style={{ display:"grid", gap:7 }}>
                {transfers.map(t=>{
                  const p=products.find(x=>x.id===t.productId), from=restaurants.find(r=>r.id===t.fromRestaurantId), to=restaurants.find(r=>r.id===t.toRestaurantId), u=umap[t.userId];
                  return(
                    <div key={t.id} style={{ background:"#fff", borderRadius:11, border:"1px solid #e2e8f0", padding:"11px 13px", display:"flex", gap:10, alignItems:"center" }}>
                      <div style={{ width:36, height:36, background:"#eff6ff", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>⇄</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:700, fontSize:13 }}>{p?.name||"Producto eliminado"}</div>
                        <div style={{ fontSize:11, color:"#64748b", marginTop:2, display:"flex", flexWrap:"wrap", gap:"0 8px" }}>
                          <span style={{ fontWeight:600, color:"#475569" }}>{from?.name||"—"} → {to?.name||"—"}</span>
                          {t.qty&&<span>📊 {t.qty} {p?.unit||""}</span>}
                          <span>📅 {fmt(t.date)}{t.time?` ${t.time}`:""}</span>
                          {u&&<span style={{ color:"#7c3aed" }}>✍️ {u.name}</span>}
                          {t.note&&<span>💬 {t.note}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            }
          </div>
        )}

        {/* ── HISTORIAL ── */}
        {tab==="history"&&(
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={{ fontWeight:700, fontSize:15 }}>Historial de trazabilidad</div>
              <button onClick={()=>exportXLS({restaurants,products,transfers,history,categories:cats,users})} style={{ ...B("green"), fontSize:12, padding:"5px 12px" }}>📊 Excel</button>
            </div>
            {history.length===0
              ?<div style={{ textAlign:"center", padding:"50px 0", color:"#94a3b8" }}><div style={{ fontSize:36, marginBottom:8 }}>📋</div><div style={{ fontWeight:600 }}>Sin eventos</div></div>
              :<div style={{ display:"grid", gap:7 }}>
                {history.map(h=>{
                  const p=products.find(x=>x.id===h.productId), rest=restaurants.find(r=>r.id===h.restaurantId), u=umap[h.userId];
                  const TI={created:{i:"✨",c:"#16a34a",bg:"#f0fdf4",l:"Creación"},edited:{i:"✏️",c:"#2563eb",bg:"#eff6ff",l:"Edición"},transferred:{i:"⇄",c:"#7c3aed",bg:"#faf5ff",l:"Transferencia"},scanned:{i:"📷",c:"#d97706",bg:"#fffbeb",l:"Escaneo"}};
                  const t=TI[h.type]||{i:"•",c:"#64748b",bg:"#f8fafc",l:h.type};
                  return(
                    <div key={h.id} style={{ background:"#fff", borderRadius:10, border:"1px solid #e2e8f0", padding:"9px 12px", display:"flex", gap:9, alignItems:"center" }}>
                      <div style={{ width:32, height:32, background:t.bg, borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, flexShrink:0 }}>{t.i}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:600, fontSize:13, color:t.c }}>{h.productName||p?.name||"—"}</div>
                        <div style={{ fontSize:11, color:"#64748b", marginTop:1 }}>{h.detail}</div>
                        {u&&<div style={{ fontSize:11, color:"#7c3aed", marginTop:1 }}>✍️ {u.name}{u.role?` · ${u.role}`:""}</div>}
                      </div>
                      <div style={{ fontSize:11, color:"#94a3b8", textAlign:"right", flexShrink:0 }}><div>{fmt(h.date)}</div>{h.time&&<div>{h.time}</div>}{rest&&<div>📍 {rest.name}</div>}</div>
                    </div>
                  );
                })}
              </div>
            }
          </div>
        )}

        {/* ── AJUSTES ── */}
        {tab==="settings"&&(
          <div style={{ display:"grid", gap:14, maxWidth:600 }}>

            {/* Usuarios */}
            <div style={{ background:"#fff", borderRadius:14, border:"1px solid #e2e8f0", overflow:"hidden" }}>
              <div style={{ background:"#1e293b", padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div><div style={{ fontWeight:800, fontSize:14, color:"#fff" }}>👤 Usuarios</div><div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{users.length} usuarios · Firman elaboraciones y transferencias</div></div>
                <button onClick={()=>{setSel(null);setModal("user");}} style={{ ...B("orange"), fontSize:12, padding:"5px 12px" }}>+ Nuevo</button>
              </div>
              <div style={{ padding:14, display:"grid", gap:7 }}>
                {users.map(u=>(
                  <div key={u.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 10px", borderRadius:9, border:"1px solid #f1f5f9", background:"#fafafa" }}>
                    <div style={{ width:36, height:36, borderRadius:"50%", background:"#1e293b", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, fontWeight:800, color:"#fff", flexShrink:0 }}>{u.name.charAt(0).toUpperCase()}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:13 }}>{u.name}</div>
                      <div style={{ fontSize:11, color:"#94a3b8" }}>{u.role||"Sin rol"}{u.restaurantId?` · ${restaurants.find(r=>r.id===u.restaurantId)?.name||""}`:""}</div>
                    </div>
                    <div style={{ display:"flex", gap:5 }}>
                      <button onClick={()=>{setSel(u);setModal("user");}} style={{ ...B("ghost"), padding:"5px 9px", fontSize:12 }}>✏️</button>
                      <button onClick={()=>{if(window.confirm(`¿Eliminar usuario "${u.name}"?`))deleteUser(u.id);}} style={{ ...B("red"), padding:"5px 9px", fontSize:12 }}>🗑</button>
                    </div>
                  </div>
                ))}
                {users.length===0&&<div style={{ textAlign:"center", padding:"16px 0", color:"#94a3b8", fontSize:13 }}>Sin usuarios — crea el primero</div>}
              </div>
            </div>

            {/* Categorías */}
            <div style={{ background:"#fff", borderRadius:14, border:"1px solid #e2e8f0", overflow:"hidden" }}>
              <div style={{ background:"#1e293b", padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div><div style={{ fontWeight:800, fontSize:14, color:"#fff" }}>🏷️ Categorías</div><div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{cats.length} categorías</div></div>
                <button onClick={()=>{setSel(null);setModal("category");}} style={{ ...B("orange"), fontSize:12, padding:"5px 12px" }}>+ Nueva</button>
              </div>
              <div style={{ padding:14, display:"grid", gap:6 }}>
                {cats.map(c=>{const cnt=products.filter(p=>p.category===c.id).length;return(
                  <div key={c.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 10px", borderRadius:8, border:"1px solid #f1f5f9", background:"#fafafa" }}>
                    <span style={{ fontSize:20 }}>{c.icon}</span>
                    <div style={{ flex:1 }}><div style={{ fontWeight:600, fontSize:13 }}>{c.label}</div><div style={{ fontSize:11, color:"#94a3b8" }}>{cnt} productos</div></div>
                    <button onClick={()=>{setSel(c);setModal("category");}} style={{ ...B("ghost"), padding:"4px 8px", fontSize:12 }}>✏️</button>
                    <button onClick={()=>{if(cats.length<=1)return;if(window.confirm(`¿Eliminar "${c.label}"?`))deleteCategory(c.id);}} style={{ ...B("red"), padding:"4px 8px", fontSize:12 }} disabled={cats.length<=1}>🗑</button>
                  </div>
                );})}
              </div>
            </div>

            {/* Export */}
            <div style={{ background:"#fff", borderRadius:12, border:"1px solid #e2e8f0", padding:16 }}>
              <div style={{ fontWeight:700, fontSize:14, marginBottom:6 }}>📊 Exportar datos</div>
              <p style={{ fontSize:13, color:"#64748b", marginBottom:10 }}>Excel completo: Locales, Productos, Transferencias (con firmas) e Historial.</p>
              <button onClick={()=>exportXLS({restaurants,products,transfers,history,categories:cats,users})} style={{ ...B("green"), width:"100%" }}>📊 Descargar Excel</button>
            </div>
          </div>
        )}

      </div>

      {/* Modals */}
      {modal==="user"&&<UserModal user={sel?.role!==undefined?sel:null} restaurants={restaurants} onClose={()=>{setModal(null);setSel(null);}} onSave={saveUser} onDelete={deleteUser}/>}
      {modal==="category"&&<div style={OVR} onClick={()=>setModal(null)}><div style={{ ...MDL, maxWidth:420 }} onClick={e=>e.stopPropagation()}><div style={MHDR}><span style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", color:"#64748b" }}>{sel?"Editar categoría":"Nueva categoría"}</span><button onClick={()=>setModal(null)} style={CBTN}>✕</button></div><CategoryForm cat={sel} cats={cats} onSave={saveCategory} onClose={()=>setModal(null)}/></div></div>}
      {modal==="restaurant"&&<RestaurantModal restaurant={sel?.cif!==undefined?sel:null} onClose={()=>{setModal(null);setSel(null);}} onSave={saveRestaurant} onDelete={deleteRestaurant} productCount={sel?products.filter(p=>p.restaurantId===sel.id).length:0}/>}
      {modal==="product"&&<ProductModal product={sel?.elaboration?sel:null} restaurants={restaurants} categories={cats} catalog={catalog} currentUser={currentUser} onClose={()=>{setModal(null);setSel(null);}} onSave={saveProduct}/>}
      {modal==="label"&&sel&&<LabelModal product={sel} restaurants={restaurants} categories={cats} users={users} onClose={()=>{setModal(null);setSel(null);}}/>}
      {modal==="transfer"&&<TransferModal products={products} restaurants={restaurants} currentUser={currentUser} onClose={()=>setModal(null)} onSave={saveTransfer}/>}
      {modal==="scanner"&&<ScannerModal onClose={()=>setModal(null)} products={products} restaurants={restaurants} users={users} currentUser={currentUser} onSaveTransfer={saveTransfer}/>}
    </div>
  );
}

// ── Category inline form ──────────────────────────────────────────────────────
const EMOJI_LIST = ["🍲","🥣","🥩","🐟","🥦","🍝","🍰","🍞","🫙","🧆","🥤","📦","🥗","🫕","🍜","🥘","🍱","🥚","🧀","🥓","🌮","🍔","🍕","🥙","🧁","🍩","🍪","🎂","🍦","🥛","☕","🫖","🍵","🧃","🌿","🧄","🧅","🥕","🌽","🍅","🫑","🥑","🌾","🧂"];

function CategoryForm({ cat, cats, onSave, onClose }) {
  const [icon, setIcon]     = useState(cat?.icon||"📦");
  const [label, setLabel]   = useState(cat?.label||"");
  const [showEmoji, setShowEmoji] = useState(false);
  return (
    <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:12 }}>
      <div>
        <div style={{ fontSize:12, fontWeight:600, color:"#475569", marginBottom:6 }}>Icono</div>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
          <div style={{ width:48, height:48, borderRadius:10, background:"#f1f5f9", border:"2px solid #e2e8f0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26 }}>{icon}</div>
          <div style={{ flex:1 }}>
            <input style={{ ...INP, fontSize:18, textAlign:"center" }} value={icon} onChange={e=>setIcon(e.target.value)} placeholder="📦" maxLength={4}/>
          </div>
        </div>
        <button onClick={()=>setShowEmoji(v=>!v)} style={{ ...B("ghost"), fontSize:12, width:"100%" }}>{showEmoji?"Ocultar":"Ver sugerencias"}</button>
        {showEmoji&&<div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:8, background:"#f8fafc", borderRadius:8, padding:8 }}>{EMOJI_LIST.map(e=><button key={e} onClick={()=>{setIcon(e);setShowEmoji(false);}} style={{ width:34, height:34, borderRadius:7, border:icon===e?"2px solid #f97316":"1px solid #e2e8f0", background:icon===e?"#fff7ed":"#fff", cursor:"pointer", fontSize:18 }}>{e}</button>)}</div>}
      </div>
      <label style={LBL}>Nombre *<input style={INP} value={label} onChange={e=>setLabel(e.target.value)} placeholder="Ej: Fondos y caldos" autoFocus/></label>
      <button onClick={()=>{if(!label.trim())return;onSave({id:cat?.id||uid(),icon,label:label.trim()});onClose();}} style={{ ...B("primary"), width:"100%" }} disabled={!label.trim()}>{cat?"Guardar":"Crear categoría"}</button>
    </div>
  );
}
