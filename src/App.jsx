import { useState, useEffect, useRef } from "react";
import { db } from "./firebase.js";
import {
  collection, doc, onSnapshot, setDoc, deleteDoc,
  addDoc, serverTimestamp, query, orderBy
} from "firebase/firestore";
import * as XLSX from "xlsx";
import jsQR from "jsqr";
import QRCode from "qrcode";

// ── Helpers ───────────────────────────────────────────────────────────────────
const today   = () => new Date().toISOString().slice(0, 10);
const stockLevel = (p) => {
  const qty = parseFloat(p.quantity);
  const min = parseFloat(p.minStock);
  const max = parseFloat(p.maxStock);
  if (isNaN(qty) || p.quantity==="" || p.quantity===null) return "unknown";
  if (!isNaN(min) && p.minStock!=="" && qty < min) return "low";
  if (!isNaN(min) && p.minStock!=="" && qty < min*2) return "warning";
  return "ok";
};
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


// ── Roles & Permissions ──────────────────────────────────────────────────────
const ROLES = {
  admin:    { label:"Admin",    icon:"👑", color:"#7C3AED" },
  manager:  { label:"Manager",  icon:"🔑", color:"#D97706" },
  empleado: { label:"Empleado", icon:"👤", color:"#0891B2" },
  cocinero: { label:"Cocinero", icon:"👨‍🍳", color:"#16A34A" },
};

// What each role CAN do
const CAN = {
  admin:    ["dashboard","restaurants","products","products.create","products.edit","products.delete","transfers","inventory","history","settings","scan"],
  manager:  ["dashboard","restaurants","products","products.create","products.edit","transfers","inventory","history","scan"],
  empleado: ["dashboard","products","products.create","transfers","inventory","scan"],
  cocinero: ["dashboard","products","products.create","inventory","scan"],
};

function can(user, action) {
  if (!user) return false;
  const role = user.role || "cocinero";
  const perms = CAN[role] || CAN["cocinero"];
  return perms.includes(action);
}

// ── Default units ────────────────────────────────────────────────────────────
const DEFAULT_UNITS = ["kg","g","l","ml","ud","raciones","bandejas","porciones","cajas","bolsas","latas","botellas","sobres"];

// ── Nav ───────────────────────────────────────────────────────────────────────
const NAVS = [
  { id:"dashboard",   icon:"⊞", l:"Dashboard" },
  { id:"restaurants", icon:"🏠", l:"Locales" },
  { id:"products",    icon:"⬡", l:"Productos" },
  { id:"transfers",   icon:"⇄", l:"Transferencias" },
  { id:"inventory",   icon:"📦", l:"Inventario" },
  { id:"history",     icon:"📋", l:"Historial" },
  { id:"settings",    icon:"⚙️",  l:"Ajustes" },
];

// ── Design tokens — Warm & Clean (iPhone-first) ──────────────────────────────
// Palette: warm cream base, dark slate text, terracotta accent
const C = {
  bg:       "#FAF7F2",   // warm cream background
  surface:  "#FFFFFF",   // card surface
  surface2: "#F5F0E8",   // secondary surface (warm sand)
  border:   "#E8E0D0",   // warm border
  border2:  "#D4C9B5",   // stronger border
  text:     "#2C2416",   // dark warm brown text
  text2:    "#7A6E5F",   // secondary text
  text3:    "#B5A898",   // tertiary text
  accent:   "#D4622A",   // terracotta/warm orange
  accentBg: "#FDF0E8",   // accent background
  accentL:  "#F2956A",   // accent light
  dark:     "#2C2416",   // top bar dark
  darkL:    "#3D3425",   // sidebar
  green:    "#2D6A4F",
  greenBg:  "#EAF4EE",
  red:      "#C0392B",
  redBg:    "#FDECEA",
  amber:    "#A05C1A",
  amberBg:  "#FDF3E3",
  blue:     "#1D4E89",
  blueBg:   "#EAF1FA",
};

const OVR  = { position:"fixed", inset:0, background:"rgba(20,15,8,0.7)", backdropFilter:"blur(6px)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 };
const MDL  = { background:C.surface, borderRadius:20, padding:24, boxShadow:"0 32px 80px rgba(0,0,0,0.2)", width:"100%", maxWidth:480 };
const MHDR = { display:"flex", justifyContent:"space-between", alignItems:"center" };
const CBTN = { background:"none", border:"none", cursor:"pointer", fontSize:20, color:C.text3, padding:6, lineHeight:1, borderRadius:8 };
const LBL  = { display:"flex", flexDirection:"column", gap:6, fontSize:13, fontWeight:600, color:C.text2, letterSpacing:"0.01em" };
const INP  = { padding:"13px 14px", border:`1.5px solid ${C.border}`, borderRadius:12, fontSize:15, color:C.text, outline:"none", width:"100%", boxSizing:"border-box", background:C.surface, fontFamily:"inherit", WebkitAppearance:"none" };
const IROW = { display:"flex", justifyContent:"space-between", fontSize:14, padding:"10px 0", borderBottom:`1px solid ${C.border}`, gap:12 };

function B(v) {
  const base = { padding:"14px 20px", borderRadius:12, fontSize:15, fontWeight:700, cursor:"pointer", border:"none", letterSpacing:"0.01em", WebkitTapHighlightColor:"transparent" };
  if (v==="primary") return { ...base, background:C.dark,   color:"#fff" };
  if (v==="orange")  return { ...base, background:C.accent, color:"#fff" };
  if (v==="ghost")   return { ...base, background:C.surface2, color:C.text2, border:`1px solid ${C.border}` };
  if (v==="red")     return { ...base, background:C.redBg,  color:C.red, border:`1px solid ${C.red}44` };
  if (v==="green")   return { ...base, background:C.greenBg,color:C.green, border:`1px solid ${C.green}44` };
  if (v==="blue")    return { ...base, background:C.blueBg, color:C.blue, border:`1px solid ${C.blue}44` };
}
function bdg(c) {
  const m = {
    red:     [C.redBg,   C.red],
    amber:   [C.amberBg, C.amber],
    green:   [C.greenBg, C.green],
    neutral: [C.surface2,C.text2],
    blue:    [C.blueBg,  C.blue],
    purple:  ["#F3EEF8","#5B3D8F"],
  };
  return { background:m[c][0], color:m[c][1], border:`1px solid ${m[c][1]}33`, borderRadius:8, padding:"3px 10px", fontSize:12, fontWeight:700, letterSpacing:"0.03em", textTransform:"uppercase", whiteSpace:"nowrap" };
}
function StatusBadge({ expiry }) {
  if (!expiry)        return <span style={bdg("neutral")}>Sin fecha</span>;
  if (isExp(expiry))  return <span style={bdg("red")}>Caducado</span>;
  if (isNear(expiry)) return <span style={bdg("amber")}>Caduca pronto</span>;
  return <span style={bdg("green")}>OK</span>;
}
function STitle({ children }) {
  return <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:C.text3, marginBottom:10, marginTop:6 }}>{children}</div>;
}
function Spinner() {
  return <div style={{ width:32, height:32, border:`3px solid ${C.border}`, borderTopColor:C.accent, borderRadius:"50%", animation:"spin .8s linear infinite" }}/>;
}
// Card container shorthand
function Card({ children, style={} }) {
  return <div style={{ background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, overflow:"hidden", ...style }}>{children}</div>;
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
          style={{ ...INP, textAlign:"left", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", color:selected?C.text:C.text3 }}>
          <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{selected ? selected.label : placeholder}</span>
          <span style={{ marginLeft:8, flexShrink:0, color:C.text3, fontSize:11 }}>{open?"▲":"▼"}</span>
        </button>
        {open && (
          <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, background:C.surface, border:`1.5px solid ${C.border2}`, borderRadius:14, zIndex:50, maxHeight:240, overflowY:"auto", boxShadow:"0 12px 32px rgba(0,0,0,.15)" }}>
            {options.map(o => (
              <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
                style={{ width:"100%", textAlign:"left", padding:"14px 16px", border:"none", borderBottom:`1px solid ${C.border}`, background:o.value===value?C.accentBg:C.surface, color:o.value===value?C.accent:C.text, fontWeight:o.value===value?700:400, fontSize:15, cursor:"pointer", display:"block" }}>
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
  try {
    await setDoc(doc(db, col, id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  } catch(e) { console.error("fbSet error:", col, id, e); throw e; }
}
async function fbAdd(col, data) {
  try {
    return await addDoc(collection(db, col), { ...data, createdAt: serverTimestamp() });
  } catch(e) { console.error("fbAdd error:", col, e); throw e; }
}
async function fbDel(col, id) {
  try {
    await deleteDoc(doc(db, col, id));
  } catch(e) { console.error("fbDel error:", col, id, e); throw e; }
}

// ── Excel export ──────────────────────────────────────────────────────────────
function exportXLS({ restaurants, products, transfers, history, categories, users, inventories=[] }) {
  const wb  = XLSX.utils.book_new();
  const cats = categories.length ? categories : DEFAULT_CATS;
  const cmap = Object.fromEntries(cats.map(c => [c.id, c]));
  const umap = Object.fromEntries(users.map(u => [u.id, u]));

  const ws0 = XLSX.utils.json_to_sheet(restaurants.map(r => ({ Nombre:r.name, "CIF/NIF":r.cif||"", Dirección:r.address||"", Ciudad:r.city||"", CP:r.zip||"", Teléfono:r.phone||"", Email:r.email||"", Responsable:r.manager||"" })));
  XLSX.utils.book_append_sheet(wb, ws0, "Locales");

  const ws1 = XLSX.utils.json_to_sheet(products.map(p => ({ Nombre:p.name, Categoría:cmap[p.category]?.label||"—", Local:restaurants.find(r=>r.id===p.restaurantId)?.name||"—", Elaboración:fmt(p.elaboration), Caducidad:fmt(p.expiry), Estado:isExp(p.expiry)?"Caducado":isNear(p.expiry)?"Caduca pronto":"OK", Cantidad:p.quantity||"", Unidad:p.unit||"", Lote:p.lot||"", "Stock mínimo":p.minStock||"", "Stock máximo":p.maxStock||"" })));
  XLSX.utils.book_append_sheet(wb, ws1, "Productos");

  const ws2 = XLSX.utils.json_to_sheet(transfers.map(t => ({ Fecha:fmt(t.date), Hora:t.time||"—", Producto:products.find(p=>p.id===t.productId)?.name||"—", Origen:restaurants.find(r=>r.id===t.fromRestaurantId)?.name||"—", Destino:restaurants.find(r=>r.id===t.toRestaurantId)?.name||"—", Cantidad:t.qty||"", Firmado:umap[t.userId]?.name||"—", Nota:t.note||"" })));
  XLSX.utils.book_append_sheet(wb, ws2, "Transferencias");

  const TL = { created:"Creación", transferred:"Transferencia", edited:"Edición", scanned:"Escaneo" };
  const ws3 = XLSX.utils.json_to_sheet([...history].reverse().map(h => ({ Fecha:fmt(h.date), Hora:h.time||"—", Tipo:TL[h.type]||h.type, Producto:h.productName||"—", Local:restaurants.find(r=>r.id===h.restaurantId)?.name||"—", Usuario:umap[h.userId]?.name||"—", Detalle:h.detail||"" })));
  XLSX.utils.book_append_sheet(wb, ws3, "Historial");

  if (inventories.length > 0) {
    const ws4rows = [];
    inventories.forEach(inv => {
      const rest = restaurants.find(r=>r.id===inv.restaurantId);
      const cat  = (categories.length?categories:DEFAULT_CATS).find(c=>c.id===inv.categoryId);
      const u    = users.find(u=>u.id===inv.userId);
      (inv.items||[]).forEach(item => {
        ws4rows.push({ Fecha:fmt(inv.date), Hora:inv.time||"—", Local:rest?.name||"—", Categoría:cat?.label||"—", Producto:item.name||"—", Unidad:item.unit||"—", "Stock previo":item.expected??""  , "Contado":item.actual??"", "Diferencia":item.diff??"", Usuario:u?.name||"—" });
      });
    });
    if (ws4rows.length > 0) {
      const ws4 = XLSX.utils.json_to_sheet(ws4rows);
      XLSX.utils.book_append_sheet(wb, ws4, "Inventarios");
    }
  }
  XLSX.writeFile(wb, `TrazaPro_${today()}.xlsx`);
}

// ── QR generation ─────────────────────────────────────────────────────────────
async function generateQR(data) {
  return await QRCode.toDataURL(JSON.stringify(data), { width:120, margin:1, color:{ dark:"#1e293b", light:"#ffffff" } });
}
function UserSelectScreen({ users, onSelect }) {
  const [selectedUser, setSelectedUser] = useState(null);
  const [pin, setPin]                   = useState("");
  const [error, setError]               = useState("");
  const [shake, setShake]               = useState(false);

  function handleUserClick(u) {
    setSelectedUser(u); setPin(""); setError("");
  }

  function handleDigit(d) {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) setTimeout(() => checkPin(next), 150);
  }

  function checkPin(p) {
    if (!selectedUser.pin || p === selectedUser.pin) {
      onSelect(selectedUser);
    } else {
      setShake(true); setError("PIN incorrecto"); setPin("");
      setTimeout(() => setShake(false), 600);
    }
  }

  function handleDelete() { setPin(p => p.slice(0,-1)); setError(""); }

  const roleInfo = selectedUser ? ROLES[selectedUser.role] || ROLES.cocinero : null;

  const Numpad = ({ onDigit, onDel, value, err }) => (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:20, width:"100%" }}>
      <div style={{ animation:shake?"shake .5s":"none" }}>
        <div style={{ display:"flex", gap:14, justifyContent:"center", marginBottom:8 }}>
          {[0,1,2,3].map(i=>(
            <div key={i} style={{ width:18, height:18, borderRadius:"50%", background:value.length>i?"#fff":"rgba(255,255,255,.2)", transition:"background .1s", border:"2px solid rgba(255,255,255,.3)" }}/>
          ))}
        </div>
        {err && <div style={{ textAlign:"center", color:"#FF8A80", fontSize:13, fontWeight:600 }}>{err}</div>}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, width:"100%", maxWidth:280 }}>
        {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d,i)=>(
          <button key={i} onClick={()=>d==="⌫"?onDel():d!==""&&onDigit(String(d))}
            disabled={d===""}
            style={{ height:72, borderRadius:16, border:"1.5px solid rgba(255,255,255,.15)", background:d==="⌫"?"rgba(255,255,255,.05)":"rgba(255,255,255,.1)", color:"#fff", fontSize:d==="⌫"?24:28, fontWeight:600, cursor:d===""?"default":"pointer", opacity:d===""?0:1, WebkitTapHighlightColor:"transparent" }}>
            {d}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:C.dark, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:28 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>

      {/* Logo */}
      <div style={{ marginBottom:32, textAlign:"center" }}>
        <div style={{ width:72, height:72, background:C.accent, borderRadius:20, display:"flex", alignItems:"center", justifyContent:"center", fontSize:34, margin:"0 auto 14px" }}>⊛</div>
        <div style={{ fontWeight:800, fontSize:28, color:"#fff", letterSpacing:"-0.03em" }}>Traza<span style={{ color:C.accentL }}>Pro</span></div>
        <div style={{ fontSize:14, color:C.text3, marginTop:6 }}>Sistema de trazabilidad</div>
      </div>

      <div style={{ width:"100%", maxWidth:360 }}>

        {/* ── User list ── */}
        {!selectedUser && (
          <>
            <div style={{ fontSize:12, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:C.text3, marginBottom:14, textAlign:"center" }}>¿Quién eres?</div>
            <div style={{ display:"grid", gap:10 }}>
              {users.map(u => {
                const ri = ROLES[u.role] || ROLES.cocinero;
                return (
                  <button key={u.id} onClick={() => handleUserClick(u)}
                    style={{ background:"rgba(255,255,255,.07)", border:"1.5px solid rgba(255,255,255,.12)", borderRadius:16, padding:"16px 18px", cursor:"pointer", textAlign:"left", display:"flex", alignItems:"center", gap:14, WebkitTapHighlightColor:"transparent" }}>
                    <div style={{ width:46, height:46, borderRadius:"50%", background:ri.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0, fontWeight:800, color:"#fff" }}>
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:700, fontSize:16, color:"#fff" }}>{u.name}</div>
                      <div style={{ fontSize:12, color:C.text3, marginTop:3 }}>{ri.icon} {ri.label}</div>
                    </div>
                    <div style={{ color:C.text3, fontSize:18 }}>›</div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* ── User PIN entry ── */}
        {selectedUser && (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:20 }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, width:"100%" }}>
              <button onClick={()=>{setSelectedUser(null);setPin("");setError("");}}
                style={{ background:"rgba(255,255,255,.08)", border:"none", cursor:"pointer", color:"#fff", borderRadius:10, padding:"8px 12px", fontSize:13 }}>← Volver</button>
              <div style={{ flex:1, textAlign:"center" }}>
                <div style={{ fontWeight:700, fontSize:16, color:"#fff" }}>{selectedUser.name}</div>
                <div style={{ fontSize:12, color:C.text3 }}>{roleInfo?.icon} {roleInfo?.label}</div>
              </div>
              <div style={{ width:70 }}/>
            </div>
            {!selectedUser.pin && (
              <div style={{ textAlign:"center", color:C.text3, fontSize:13, padding:"10px 0" }}>Sin PIN configurado — pulsa cualquier número para entrar</div>
            )}
            <Numpad onDigit={handleDigit} onDel={handleDelete} value={pin} err={error}/>
          </div>
        )}

      </div>
    </div>
  );
}

function UserModal({ user, restaurants, onClose, onSave, onDelete }) {
  const isNew = !user;
  const [f, setF] = useState(user || { name:"", role:"admin", restaurantId:"", pin:"" });
  const [confirmDel, setConfirmDel] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [pinEntry, setPinEntry] = useState(user?.pin||"");

  function handlePinDigit(d) {
    if(pinEntry.length<4){ const n=pinEntry+d; setPinEntry(n); setF(p=>({...p,pin:n})); }
  }
  function handlePinDel() {
    const n=pinEntry.slice(0,-1); setPinEntry(n); setF(p=>({...p,pin:n}));
  }

  return (
    <div style={OVR} onClick={onClose}>
      <div style={{ ...MDL, maxWidth:440, maxHeight:"92vh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
        <div style={MHDR}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:C.text3 }}>{isNew?"Nuevo usuario":"Editar usuario"}</div>
            {!isNew&&<div style={{ fontWeight:800, fontSize:15, marginTop:2 }}>{f.name}</div>}
          </div>
          <button onClick={onClose} style={CBTN}>✕</button>
        </div>
        <div style={{ marginTop:16, display:"flex", flexDirection:"column", gap:14 }}>
          <label style={LBL}>Nombre completo *<input style={INP} value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="Ej: Ana García"/></label>
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:C.text2, marginBottom:8 }}>Rol y permisos</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {Object.entries(ROLES).map(([key,ri])=>(
                <button key={key} type="button" onClick={()=>setF({...f,role:key})}
                  style={{ padding:"12px 10px", borderRadius:12, border:`2px solid ${f.role===key?ri.color:C.border}`, background:f.role===key?ri.color+"15":C.surface2, cursor:"pointer", textAlign:"left" }}>
                  <div style={{ fontSize:20, marginBottom:4 }}>{ri.icon}</div>
                  <div style={{ fontWeight:700, fontSize:13, color:f.role===key?ri.color:C.text }}>{ri.label}</div>
                  <div style={{ fontSize:11, color:C.text3, marginTop:2 }}>
                    {key==="admin"?"Acceso total":key==="manager"?"Sin ajustes/borrar":key==="empleado"?"Crear, stock, traspasos":"Crear y stock"}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <label style={LBL}>
            Local asignado por defecto
            <select style={INP} value={f.restaurantId} onChange={e=>setF({...f,restaurantId:e.target.value})}>
              <option value="">Sin local fijo</option>
              {restaurants.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
              <div style={{ fontSize:13, fontWeight:600, color:C.text2 }}>PIN de acceso (4 dígitos)</div>
              <button type="button" onClick={()=>setShowPin(v=>!v)} style={{ ...B("ghost"), fontSize:12, padding:"4px 10px" }}>{showPin?"Ocultar":"Configurar PIN"}</button>
            </div>
            <div style={{ display:"flex", gap:12, justifyContent:"center", padding:"14px 0", background:C.surface2, borderRadius:12, marginBottom:showPin?10:0 }}>
              {[0,1,2,3].map(i=>(
                <div key={i} style={{ width:16, height:16, borderRadius:"50%", background:pinEntry.length>i?C.accent:C.border, transition:"background .1s" }}/>
              ))}
            </div>
            {showPin&&(
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d,i)=>(
                  <button key={i} type="button"
                    onClick={()=>d==="⌫"?handlePinDel():d!==""&&handlePinDigit(String(d))}
                    disabled={d===""}
                    style={{ height:56, borderRadius:12, border:`1.5px solid ${C.border}`, background:C.surface, color:C.text, fontSize:d==="⌫"?20:22, fontWeight:600, cursor:d===""?"default":"pointer", opacity:d===""?0:1 }}>
                    {d}
                  </button>
                ))}
              </div>
            )}
            {!showPin&&pinEntry&&(
              <div style={{ textAlign:"center", marginTop:6 }}>
                <button type="button" onClick={()=>{setPinEntry("");setF(p=>({...p,pin:""}));}} style={{ ...B("ghost"), fontSize:12, padding:"4px 12px" }}>Borrar PIN</button>
              </div>
            )}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={()=>{ if(!f.name.trim())return; onSave({...f,id:f.id||uid(),name:f.name.trim(),pin:pinEntry}); onClose(); }} style={{ ...B("primary"), flex:1 }} disabled={!f.name.trim()}>
              {isNew?"Crear usuario":"Guardar cambios"}
            </button>
            {!isNew&&!confirmDel&&<button onClick={()=>setConfirmDel(true)} style={{ ...B("red"), flexShrink:0 }}>🗑</button>}
            {!isNew&&confirmDel&&(
              <div style={{ display:"flex", gap:6, flex:1 }}>
                <button onClick={async()=>{await onDelete(f.id);onClose();}} style={{ ...B("red"), flex:1 }}>Sí, eliminar</button>
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
        <div style={MHDR}><span style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:C.text2 }}>Etiqueta de producto</span><button onClick={onClose} style={CBTN}>✕</button></div>
        <div style={{ display:"flex", gap:14, alignItems:"flex-start", background:C.surface2, borderRadius:10, padding:14, border:"2px dashed #cbd5e1", margin:"14px 0", fontFamily:"'Courier New',monospace" }}>
          {qrUrl ? <img src={qrUrl} width={100} height={100} style={{ flexShrink:0 }}/> : <div style={{ width:100, height:100, background:"#f1f5f9", borderRadius:8, flexShrink:0 }}/>}
          <div style={{ flex:1, fontSize:11, color:"#1e293b" }}>
            <div style={{ fontSize:13, fontWeight:900, textTransform:"uppercase", letterSpacing:".05em", borderBottom:"2px solid #1e293b", paddingBottom:3, marginBottom:4 }}>{product.name}</div>
            {cat && <div style={{ fontSize:9, color:C.text2, marginBottom:4 }}>{cat.icon} {cat.label}</div>}
            {[["Elaboración",fmt(product.elaboration)],["Caducidad",fmt(product.expiry)],product.quantity&&["Cantidad",`${product.quantity} ${product.unit}`],product.lot&&["Lote",product.lot]].filter(Boolean).map(([k,v]) => (
              <div key={k} style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}><span style={{ color:C.text2, fontWeight:700 }}>{k}:</span><span style={{ fontWeight:k==="Caducidad"?900:400 }}>{v}</span></div>
            ))}
            <div style={{ marginTop:5, fontSize:9, background:"#1e293b", color:"#fff", borderRadius:3, padding:"2px 5px", display:"inline-block" }}>{rest?.name||"—"}</div>
            {creator && <div style={{ marginTop:3, fontSize:9, color:C.text3 }}>Por: {creator.name}</div>}
          </div>
        </div>
        <button onClick={print} style={{ ...B("primary"), width:"100%", fontSize:14 }}>🖨️ Imprimir etiqueta</button>
      </div>
    </div>
  );
}

// ── SCANNER MODAL ─────────────────────────────────────────────────────────────
// Robust QR decoder for iPhone photos:
// - Tries 8 different scales (4032px iPhone photos need heavy downscaling)
// - Applies 6 image processing filters per scale (contrast, grayscale, sharpen)
// - Crops center region where QR is likely to appear
// - Handles orientation from EXIF via CSS image-orientation
function ScannerModal({ onClose, products, restaurants, users, currentUser, onSaveTransfer }) {
  const fileInputRef = useRef(null);
  const fileInputRef2 = useRef(null);

  const [mode,        setMode]        = useState("scan");
  const [err,         setErr]         = useState(null);
  const [scanned,     setScanned]     = useState(null);
  const [cart,        setCart]        = useState([]);
  const [destId,      setDestId]      = useState("");
  const [note,        setNote]        = useState("");
  const [transferred, setTransferred] = useState(false);
  const [processing,  setProcessing]  = useState(false);
  const [attempts,    setAttempts]    = useState(0);

  // ── Core QR decode: try one canvas config ────────────────────────────────────
  function tryDecode(ctx, w, h) {
    try {
      const id = ctx.getImageData(0, 0, w, h);
      const r1 = jsQR(id.data, w, h, { inversionAttempts: "dontInvert" });
      if (r1) return r1;
      const r2 = jsQR(id.data, w, h, { inversionAttempts: "invertFirst" });
      if (r2) return r2;
      const r3 = jsQR(id.data, w, h, { inversionAttempts: "attemptBoth" });
      if (r3) return r3;
    } catch {}
    return null;
  }

  // ── Apply a filter and attempt decode ────────────────────────────────────────
  function tryFilter(img, w, h, filter, sx, sy, sw, sh) {
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.filter = filter;
    // Draw either full image or a cropped region
    if (sx !== undefined) {
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    } else {
      ctx.drawImage(img, 0, 0, w, h);
    }
    return tryDecode(ctx, w, h);
  }

  // ── Convert image to grayscale manually for better QR reading ────────────────
  function toGrayscale(ctx, w, h) {
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
      d[i] = d[i+1] = d[i+2] = gray;
    }
    ctx.putImageData(id, 0, 0);
  }

  // ── Main decode engine ───────────────────────────────────────────────────────
  function decodeImage(img, onResult, onError) {
    const origW = img.naturalWidth  || img.width;
    const origH = img.naturalHeight || img.height;

    // Target sizes to try — iPhone photos are 4032x3024, QR reads best ~800px
    const targetSizes = [800, 400, 1200, 200, 600, 1600, 100, 2000];

    const filters = [
      "none",
      "contrast(1.5)",
      "contrast(2.5) brightness(1.1)",
      "contrast(3) brightness(0.9)",
      "grayscale(1) contrast(2)",
      "grayscale(1) contrast(3) brightness(1.2)",
    ];

    // Also try center crop (QR is often in center of frame)
    const crops = [
      null, // full image
      { x:0.1, y:0.1, w:0.8, h:0.8 },  // 80% center
      { x:0.2, y:0.2, w:0.6, h:0.6 },  // 60% center
      { x:0.25,y:0.25,w:0.5, h:0.5 },  // 50% center
    ];

    let totalAttempts = 0;

    for (const targetSize of targetSizes) {
      const scale = Math.min(targetSize / origW, targetSize / origH, 1.0);
      const w = Math.max(1, Math.round(origW * scale));
      const h = Math.max(1, Math.round(origH * scale));

      for (const crop of crops) {
        const sx = crop ? Math.round(origW * crop.x) : undefined;
        const sy = crop ? Math.round(origH * crop.y) : undefined;
        const sw = crop ? Math.round(origW * crop.w) : undefined;
        const sh = crop ? Math.round(origH * crop.h) : undefined;
        const cw = crop ? Math.round(w * crop.w) : w;
        const ch = crop ? Math.round(h * crop.h) : h;

        for (const filter of filters) {
          totalAttempts++;
          const result = tryFilter(img, crop ? cw : w, crop ? ch : h, filter, sx, sy, sw, sh);
          if (result) {
            setAttempts(totalAttempts);
            return result;
          }
        }

        // Extra: grayscale manual conversion
        const canvas2 = document.createElement("canvas");
        canvas2.width = crop ? cw : w;
        canvas2.height = crop ? ch : h;
        const ctx2 = canvas2.getContext("2d");
        ctx2.filter = "none";
        if (crop) {
          ctx2.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
        } else {
          ctx2.drawImage(img, 0, 0, w, h);
        }
        toGrayscale(ctx2, canvas2.width, canvas2.height);
        const r = tryDecode(ctx2, canvas2.width, canvas2.height);
        if (r) { setAttempts(totalAttempts); return r; }
      }
    }

    setAttempts(totalAttempts);
    return null;
  }

  // ── Load image respecting EXIF orientation (critical for iPhone) ─────────────
  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      // This CSS property makes the browser auto-rotate per EXIF
      img.style.imageOrientation = "from-image";
      img.onload = () => {
        // Draw to canvas to bake in EXIF rotation
        const canvas = document.createElement("canvas");
        canvas.width  = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);

        const correctedImg = new Image();
        correctedImg.onload = () => resolve(correctedImg);
        correctedImg.onerror = reject;
        correctedImg.src = canvas.toDataURL("image/jpeg", 0.95);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // ── Public decode entry point ─────────────────────────────────────────────────
  async function decodeFile(file, onResult, onError) {
    setProcessing(true); setErr(null); setAttempts(0);
    try {
      const img = await loadImageFromFile(file);
      const result = decodeImage(img, onResult, onError);
      setProcessing(false);
      if (result) {
        try { onResult(JSON.parse(result.data)); return; } catch {
          onError("El QR se leyó pero el contenido no es válido. ¿Es una etiqueta de TrazaPro?");
          return;
        }
      }
      onError(
        "No se pudo leer el QR después de múltiples intentos.\n\n" +
        "Consejos:\n• Acerca el móvil al QR (10-15cm)\n• Asegúrate de que hay buena luz\n• Evita reflejos y sombras\n• El QR debe ocupar la mayor parte de la foto"
      );
    } catch (e) {
      setProcessing(false);
      onError("Error al procesar la imagen. Intenta de nuevo.");
    }
  }

  function handleFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    decodeFile(
      file,
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
    onSaveTransfer({ productId:prod.id, fromRestaurantId:prod.restaurantId, toRestaurantId:destId, qty:"", note, userId:currentUser?.id||"", date:today(), time:nowTime(), id:uid() });
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

  const scanBtnStyle = {
    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
    gap:12, padding:"28px 20px", borderRadius:14, border:"2px dashed #f97316",
    background:"#fff7ed", cursor:"pointer", width:"100%", textAlign:"center",
    WebkitTapHighlightColor:"transparent",
  };

  return (
    <div style={OVR} onClick={onClose}>
      <div style={{ ...MDL, width:440, maxHeight:"92vh", overflowY:"auto", padding:0 }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:"14px 18px", borderBottom:"1px solid #f1f5f9", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, background:"#fff", zIndex:10, borderRadius:"16px 16px 0 0" }}>
          <div>
            <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:C.text2 }}>
              {mode==="scan"||mode==="confirm" ? "Escanear QR" : mode==="multi" ? "Carga multiple" : "Completado"}
            </div>
            {mode==="multi"&&cart.length>0&&<div style={{ fontSize:11, color:"#f97316", fontWeight:700, marginTop:1 }}>{cart.length} producto{cart.length!==1?"s":""} en cola</div>}
          </div>
          <div style={{ display:"flex", gap:6 }}>
            {(mode==="scan"||mode==="confirm")&&<button onClick={()=>{setMode("multi");setScanned(null);}} style={{ ...B("ghost"), fontSize:11, padding:"4px 10px" }}>Carga multiple</button>}
            {mode==="multi"&&<button onClick={()=>{setMode("scan");setCart([]);}} style={{ ...B("ghost"), fontSize:11, padding:"4px 10px" }}>Simple</button>}
            <button onClick={onClose} style={CBTN}>x</button>
          </div>
        </div>

        <div style={{ padding:18, display:"flex", flexDirection:"column", gap:14 }}>

          {/* Error */}
          {err && (
            <div style={{ padding:14, background:"#fef2f2", borderRadius:10, color:"#dc2626", fontSize:13, border:"1px solid #fecaca", whiteSpace:"pre-line" }}>
              {err}
              <button onClick={()=>setErr(null)} style={{ display:"block", marginTop:8, ...B("ghost"), fontSize:12, padding:"5px 12px" }}>Intentar de nuevo</button>
            </div>
          )}

          {/* Processing */}
          {processing && (
            <div style={{ textAlign:"center", padding:"20px 0", display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
              <Spinner/>
              <div style={{ fontWeight:600, fontSize:14, color:"#1e293b" }}>Analizando imagen...</div>
              <div style={{ fontSize:12, color:C.text3 }}>Probando diferentes configuraciones</div>
            </div>
          )}

          {/* ── MODE: SCAN ── */}
          {mode==="scan"&&!processing&&!err&&(
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {/* Tips */}
              <div style={{ background:"#eff6ff", borderRadius:10, padding:12, border:"1px solid #bfdbfe" }}>
                <div style={{ fontWeight:700, fontSize:12, color:"#2563eb", marginBottom:6 }}>Para mejores resultados:</div>
                <div style={{ fontSize:12, color:"#1e40af", display:"flex", flexDirection:"column", gap:4 }}>
                  <span>• Acerca el movil al QR (10-15cm de distancia)</span>
                  <span>• El QR debe ocupar gran parte de la foto</span>
                  <span>• Buena iluminacion, sin reflejos</span>
                  <span>• La etiqueta plana y sin arrugas</span>
                </div>
              </div>

              {/* Camera button */}
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={handleFile}/>
              <div onClick={()=>fileInputRef.current?.click()} style={scanBtnStyle}>
                <div style={{ fontSize:56 }}>📷</div>
                <div style={{ fontWeight:800, fontSize:18, color:"#f97316" }}>Abrir camara</div>
                <div style={{ fontSize:12, color:C.text3 }}>Toca para fotografiar la etiqueta</div>
              </div>

              {/* Gallery fallback */}
              <input ref={fileInputRef2} type="file" accept="image/*" style={{ display:"none" }} onChange={handleFile}/>
              <button onClick={()=>fileInputRef2.current?.click()} style={{ ...B("ghost"), width:"100%", fontSize:13 }}>
                🖼 Seleccionar de la galeria
              </button>

              <div style={{ textAlign:"center", fontSize:11, color:C.text3 }}>
                El sistema realiza hasta 200 intentos de lectura por imagen
              </div>
            </div>
          )}

          {/* ── MODE: CONFIRM ── */}
          {mode==="confirm"&&scannedProd&&(
            <div>
              <div style={{ background:"#f0fdf4", border:"1px solid #86efac", borderRadius:10, padding:14, marginBottom:12 }}>
                <div style={{ fontWeight:800, fontSize:15, marginBottom:8, color:"#15803d" }}>Producto identificado</div>
                {[
                  ["Nombre", scannedProd.name],
                  ["Local origen", fromRest?.name||"—"],
                  ["Elaboracion", fmt(scannedProd.elaboration)],
                  ["Caducidad", fmt(scannedProd.expiry)],
                  scannedProd.quantity && ["Stock", `${scannedProd.quantity} ${scannedProd.unit||""}`],
                  scannedProd.lot && ["Lote", scannedProd.lot],
                ].filter(Boolean).map(([k,v]) => (
                  <div key={k} style={IROW}>
                    <span style={{ color:"#15803d", fontWeight:600 }}>{k}</span>
                    <span style={{ color:k==="Caducidad"&&isExp(scannedProd.expiry)?"#dc2626":"inherit" }}>{v}</span>
                  </div>
                ))}
              </div>
              {transferred
                ? <div style={{ background:"#f0fdf4", border:"1px solid #86efac", borderRadius:10, padding:14, textAlign:"center", fontWeight:700, color:"#15803d", fontSize:15 }}>Transferencia registrada</div>
                : <>
                    <Picker label="Local de destino" value={destId} onChange={setDestId} options={singleDestOpts} placeholder="Seleccionar destino..."/>
                    <label style={{ ...LBL, marginTop:10 }}>Nota (opcional)<input style={INP} value={note} onChange={e=>setNote(e.target.value)} placeholder="Observaciones..."/></label>
                    <div style={{ display:"flex", gap:8, marginTop:12 }}>
                      <button onClick={confirmSingle} style={{ ...B("primary"), flex:1 }} disabled={!destId}>Confirmar transferencia</button>
                      <button onClick={()=>{setMode("scan");setScanned(null);setErr(null);}} style={{ ...B("ghost"), flexShrink:0 }}>Volver</button>
                    </div>
                  </>
              }
            </div>
          )}

          {/* ── MODE: MULTI ── */}
          {mode==="multi"&&!processing&&(
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={handleFile}/>
              <div onClick={()=>fileInputRef.current?.click()} style={{ ...scanBtnStyle, padding:"14px 20px", flexDirection:"row", gap:14, justifyContent:"flex-start" }}>
                <div style={{ fontSize:36 }}>📷</div>
                <div style={{ textAlign:"left" }}>
                  <div style={{ fontWeight:700, fontSize:15, color:"#f97316" }}>Escanear siguiente producto</div>
                  <div style={{ fontSize:11, color:C.text2 }}>Toca para abrir la camara</div>
                </div>
              </div>

              {err && (
                <div style={{ padding:12, background:"#fef2f2", borderRadius:8, color:"#dc2626", fontSize:12, border:"1px solid #fecaca", whiteSpace:"pre-line" }}>
                  {err}
                  <button onClick={()=>setErr(null)} style={{ display:"block", marginTop:6, ...B("ghost"), fontSize:11, padding:"4px 10px" }}>Intentar de nuevo</button>
                </div>
              )}

              {cart.length === 0
                ? <div style={{ textAlign:"center", padding:"12px 0", color:C.text3, fontSize:13 }}>Cola vacia — escanea el primer producto</div>
                : <>
                    <div style={{ fontWeight:700, fontSize:13, marginBottom:4 }}>Cola ({cart.length} productos)</div>
                    {cart.map(({product:p, qty}) => (
                      <div key={p.id} style={{ background:C.surface2, borderRadius:9, padding:"9px 12px", border:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:700, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</div>
                          <div style={{ fontSize:11, color:C.text2 }}>{restaurants.find(r=>r.id===p.restaurantId)?.name||"—"}{p.quantity?` · ${p.quantity} ${p.unit||""}`:""}</div>
                        </div>
                        <input style={{ ...INP, width:68, padding:"5px 7px", fontSize:12, textAlign:"center" }} type="number" min="0" placeholder="Cant." value={qty} onChange={e=>setCart(c=>c.map(i=>i.product.id===p.id?{...i,qty:e.target.value}:i))}/>
                        <button onClick={()=>setCart(c=>c.filter(i=>i.product.id!==p.id))} style={{ ...B("red"), padding:"5px 8px", fontSize:12, flexShrink:0 }}>x</button>
                      </div>
                    ))}
                    <Picker label="Destino (para todos)" value={destId} onChange={setDestId} options={allDestOpts} placeholder="Seleccionar local de destino..."/>
                    <label style={{ ...LBL, marginTop:4 }}>Nota (opcional)<input style={INP} value={note} onChange={e=>setNote(e.target.value)} placeholder="Observaciones..."/></label>
                    <button onClick={confirmBulk} style={{ ...B("orange"), width:"100%", marginTop:4, fontSize:14 }} disabled={!destId||cart.length===0}>
                      Transferir {cart.length} producto{cart.length!==1?"s":""}
                    </button>
                  </>
              }
            </div>
          )}

          {/* ── MODE: DONE ── */}
          {mode==="done"&&(
            <div style={{ textAlign:"center", padding:"20px 0" }}>
              <div style={{ fontSize:52, marginBottom:10 }}>✅</div>
              <div style={{ fontWeight:800, fontSize:18, color:"#15803d", marginBottom:6 }}>Completado</div>
              <div style={{ fontSize:13, color:C.text2, marginBottom:20 }}>
                {cart.length} producto{cart.length!==1?"s":""} transferido{cart.length!==1?"s":""} a{" "}
                <strong>{restaurants.find(r=>r.id===destId)?.name}</strong>
              </div>
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




// ── INVENTORY MODAL ───────────────────────────────────────────────────────────
function InventoryModal({ restaurants, categories, products, currentUser, onClose, onSave }) {
  const [step,       setStep]       = useState("setup"); // setup | count | confirm
  const [restId,     setRestId]     = useState(currentUser?.restaurantId || restaurants[0]?.id || "");
  const [catId,      setCatId]      = useState("");
  const [items,      setItems]      = useState([]); // [{productId,name,unit,expected,actual}]
  const [saving,     setSaving]     = useState(false);

  const restOpts = restaurants.map(r=>({value:r.id, label:r.name}));
  const catOpts  = categories.map(c=>({value:c.id, label:`${c.icon} ${c.label}`}));

  function startCount() {
    if(!restId || !catId) return;
    const prods = products.filter(p => p.restaurantId===restId && p.category===catId);
    setItems(prods.map(p=>({
      productId: p.id,
      name:      p.name,
      unit:      p.unit || "",
      lot:       p.lot || "",
      expiry:    p.expiry || "",
      expected:  p.quantity ?? "",
      minStock:  p.minStock ?? "",
      maxStock:  p.maxStock ?? "",
      actual:    "",
    })));
    setStep("count");
  }

  function setActual(productId, val) {
    setItems(prev => prev.map(i => i.productId===productId ? {...i, actual:val} : i));
  }

  function computedDiff(item) {
    const exp = parseFloat(item.expected);
    const act = parseFloat(item.actual);
    if(isNaN(act)) return null;
    if(isNaN(exp)) return act;
    return act - exp;
  }

  async function confirm() {
    setSaving(true);
    const finalItems = items.map(i => ({
      ...i,
      diff: computedDiff(i),
    }));
    await onSave({
      id:           uid(),
      restaurantId: restId,
      categoryId:   catId,
      date:         today(),
      time:         nowTime(),
      userId:       currentUser?.id || "",
      items:        finalItems,
    });
    setSaving(false);
    onClose();
  }

  const countedItems  = items.filter(i => i.actual !== "");
  const changedItems  = items.filter(i => {
    const d = computedDiff(i);
    return d !== null && d !== 0;
  });
  const cat = categories.find(c=>c.id===catId);
  const rest = restaurants.find(r=>r.id===restId);

  return (
    <div style={OVR} onClick={onClose}>
      <div style={{...MDL, width:480, maxHeight:"92vh", overflowY:"auto", padding:0}} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{padding:"14px 18px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, background:C.surface, zIndex:10, borderRadius:"16px 16px 0 0"}}>
          <div>
            <div style={{fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:C.text3}}>
              {step==="setup"?"Nuevo recuento":step==="count"?"Contando stock":"Confirmar recuento"}
            </div>
            {step!=="setup" && <div style={{fontWeight:800, fontSize:15, color:C.text, marginTop:2}}>{cat?.icon} {cat?.label} · {rest?.name}</div>}
          </div>
          <button onClick={onClose} style={CBTN}>✕</button>
        </div>

        <div style={{padding:18, display:"flex", flexDirection:"column", gap:14}}>

          {/* ── STEP 1: Setup ── */}
          {step==="setup" && (
            <>
              <Picker label="Local" value={restId} onChange={setRestId} options={restOpts} placeholder="Seleccionar local..."/>
              <Picker label="Categoría a contar" value={catId} onChange={setCatId} options={catOpts} placeholder="Seleccionar categoría..."/>
              {catId && restId && (()=>{
                const count = products.filter(p=>p.restaurantId===restId&&p.category===catId).length;
                return (
                  <div style={{background:C.surface2, borderRadius:12, padding:"12px 14px", fontSize:13, color:C.text2}}>
                    {count===0
                      ? "No hay productos de esta categoría en este local."
                      : `${count} producto${count!==1?"s":""} para contar en este local.`
                    }
                  </div>
                );
              })()}
              <button
                onClick={startCount}
                style={{...B("orange"), width:"100%", fontSize:15, padding:"15px"}}
                disabled={!restId || !catId || products.filter(p=>p.restaurantId===restId&&p.category===catId).length===0}>
                Iniciar recuento →
              </button>
            </>
          )}

          {/* ── STEP 2: Count ── */}
          {step==="count" && (
            <>
              {/* Progress */}
              <div style={{background:C.surface2, borderRadius:12, padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                <span style={{fontSize:13, color:C.text2}}>{countedItems.length} de {items.length} contados</span>
                <div style={{height:6, width:120, background:C.border, borderRadius:3, overflow:"hidden"}}>
                  <div style={{height:"100%", width:`${items.length?countedItems.length/items.length*100:0}%`, background:C.accent, borderRadius:3, transition:"width .3s"}}/>
                </div>
              </div>

              {items.length===0 ? (
                <div style={{textAlign:"center", padding:"30px 0", color:C.text3}}>
                  <div style={{fontSize:36, marginBottom:8}}>{cat?.icon}</div>
                  <div style={{fontWeight:600}}>Sin productos en este local</div>
                </div>
              ) : (
                <div style={{display:"flex", flexDirection:"column", gap:8}}>
                  {items.map(item => {
                    const diff = computedDiff(item);
                    const hasDiff = diff !== null && diff !== 0;
                    const isOk   = diff !== null && diff === 0;
                    return (
                      <div key={item.productId} style={{background:C.surface, borderRadius:14, border:`1.5px solid ${hasDiff?C.red+"55":isOk?C.green+"55":C.border}`, padding:"12px 14px"}}>
                        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8}}>
                          <div style={{flex:1, minWidth:0}}>
                            <div style={{fontWeight:700, fontSize:14, color:C.text}}>{item.name}</div>
                            <div style={{fontSize:12, color:C.text3, marginTop:2}}>
                              {item.lot && `Lote: ${item.lot} · `}
                              {item.expiry && `Cad: ${fmt(item.expiry)}`}
                            </div>
                          </div>
                          {item.actual!=="" && diff!==null && (
                            <div style={{
                              fontSize:12, fontWeight:700, padding:"3px 10px", borderRadius:8,
                              background:hasDiff?C.redBg:C.greenBg,
                              color:hasDiff?C.red:C.green,
                              flexShrink:0, marginLeft:8
                            }}>
                              {diff>0?"+":""}{diff} {item.unit}
                            </div>
                          )}
                        </div>
                        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, alignItems:"flex-end"}}>
                          <div>
                            <div style={{fontSize:11, color:C.text3, marginBottom:4}}>Stock registrado</div>
                            <div style={{fontSize:16, fontWeight:700, color:C.text2, padding:"10px 12px", background:C.surface2, borderRadius:10}}>
                              {item.expected!==""?`${item.expected} ${item.unit}`:"—"}
                            </div>
                            {(item.minStock||item.maxStock)&&(
                              <div style={{fontSize:10, color:C.text3, marginTop:4, display:"flex", gap:8}}>
                                {item.minStock&&<span>🔴 Mín: {item.minStock}</span>}
                                {item.maxStock&&<span>🟢 Máx: {item.maxStock}</span>}
                              </div>
                            )}
                          </div>
                          <div>
                            <div style={{fontSize:11, color:C.accent, fontWeight:600, marginBottom:4}}>Cantidad real *</div>
                            <input
                              style={{...INP, fontSize:16, fontWeight:700, textAlign:"center", borderColor:item.actual!==""?C.accent:C.border}}
                              type="number" min="0" step="0.1"
                              placeholder="0"
                              value={item.actual}
                              onChange={e=>setActual(item.productId, e.target.value)}
                            />
                          </div>
                        </div>
                        {item.unit && <div style={{fontSize:11, color:C.text3, textAlign:"right", marginTop:4}}>Unidad: {item.unit}</div>}
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{display:"flex", gap:8, position:"sticky", bottom:0, background:C.bg, paddingTop:8}}>
                <button onClick={()=>setStep("setup")} style={{...B("ghost"), flexShrink:0}}>← Volver</button>
                <button
                  onClick={()=>setStep("confirm")}
                  style={{...B("primary"), flex:1, fontSize:14}}
                  disabled={countedItems.length===0}>
                  Revisar y confirmar ({countedItems.length}/{items.length})
                </button>
              </div>
            </>
          )}

          {/* ── STEP 3: Confirm ── */}
          {step==="confirm" && (
            <>
              {/* Summary */}
              <div style={{background:C.surface2, borderRadius:14, padding:14}}>
                <div style={{fontWeight:700, fontSize:14, color:C.text, marginBottom:10}}>Resumen del recuento</div>
                <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, textAlign:"center"}}>
                  {[
                    {l:"Contados", v:countedItems.length, c:C.text},
                    {l:"Sin cambios", v:countedItems.length-changedItems.length, c:C.green},
                    {l:"Con diferencia", v:changedItems.length, c:changedItems.length>0?C.red:C.text3},
                  ].map(s=>(
                    <div key={s.l} style={{background:C.surface, borderRadius:10, padding:"10px 6px"}}>
                      <div style={{fontSize:22, fontWeight:800, color:s.c}}>{s.v}</div>
                      <div style={{fontSize:11, color:C.text3, marginTop:2}}>{s.l}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Only show items with differences */}
              {changedItems.length > 0 && (
                <div>
                  <div style={{fontSize:13, fontWeight:700, color:C.text, marginBottom:8}}>Productos con diferencia:</div>
                  {changedItems.map(item => {
                    const diff = computedDiff(item);
                    return (
                      <div key={item.productId} style={{display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 0", borderBottom:`1px solid ${C.border}`}}>
                        <div style={{flex:1}}>
                          <div style={{fontWeight:600, fontSize:14}}>{item.name}</div>
                          <div style={{fontSize:12, color:C.text3}}>{item.expected!==""?item.expected:"—"} → {item.actual} {item.unit}</div>
                        </div>
                        <div style={{fontWeight:800, fontSize:14, color:diff>0?C.green:C.red, marginLeft:12}}>
                          {diff>0?"+":""}{diff} {item.unit}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {countedItems.length < items.length && (
                <div style={{background:C.amberBg, borderRadius:10, padding:"10px 14px", fontSize:13, color:C.amber}}>
                  ⚠️ {items.length - countedItems.length} producto{items.length-countedItems.length!==1?"s":""} sin contar — se mantendrá su stock actual.
                </div>
              )}

              {currentUser && (
                <div style={{background:C.surface2, borderRadius:10, padding:"10px 14px", fontSize:13, color:C.text2}}>
                  ✍️ Firmado por: <strong>{currentUser.name}</strong>
                </div>
              )}

              <div style={{display:"flex", gap:8}}>
                <button onClick={()=>setStep("count")} style={{...B("ghost"), flexShrink:0}}>← Editar</button>
                <button onClick={confirm} disabled={saving} style={{...B("orange"), flex:1, fontSize:14}}>
                  {saving ? "Guardando..." : "Confirmar recuento ✓"}
                </button>
              </div>
            </>
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
          <div><div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:C.text2 }}>{isNew?"Nuevo local":"Ficha del local"}</div>{!isNew&&<div style={{ fontWeight:800, fontSize:16, marginTop:2 }}>{f.name}</div>}</div>
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
          {!isNew&&<div style={{ background:C.surface2, borderRadius:8, padding:10, fontSize:12, color:C.text2 }}>{productCount} productos registrados</div>}
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
  const defaultForm = { name:"", category:categories[0]?.id||"otros", restaurantId:currentUser?.restaurantId||restaurants[0]?.id||"", elaboration:today(), expiry:addDays(today(),7), quantity:"", unit:"kg", lot:"", notes:"", frozen:false, minStock:"", maxStock:"" };
  const [f, setF] = useState(product||defaultForm);
  const [catOpen, setCatOpen] = useState(false);
  const curCat = categories.find(c=>c.id===f.category);
  const [addingUnitForm, setAddingUnitForm] = useState(false);
  const [customUnitForm, setCustomUnitForm] = useState("");
  const [formUnits, setFormUnits] = useState(()=>{
    const saved = localStorage.getItem("trazapro_units");
    const extra = saved ? JSON.parse(saved) : [];
    return [...DEFAULT_UNITS, ...extra.filter(u=>!DEFAULT_UNITS.includes(u))];
  });

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
            <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:C.text2 }}>
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
            {/* Crear desde cero — ALWAYS at top */}
            <button onClick={()=>setStep("form")}
              style={{ ...B("ghost"), width:"100%", fontSize:14, padding:"13px 16px", display:"flex", alignItems:"center", gap:10, border:`1.5px dashed ${C.border2}`, borderRadius:14 }}>
              <span style={{ fontSize:22 }}>✏️</span>
              <div style={{ textAlign:"left" }}>
                <div style={{ fontWeight:700, color:C.text }}>Crear desde cero</div>
                <div style={{ fontSize:12, color:C.text3, marginTop:1 }}>Sin usar plantilla del catálogo</div>
              </div>
              <span style={{ marginLeft:"auto", color:C.text3, fontSize:18 }}>›</span>
            </button>

            {catalog.length===0?(
              <div style={{ textAlign:"center", padding:"24px 0", color:C.text3 }}>
                <div style={{ fontSize:32, marginBottom:8 }}>📋</div>
                <div style={{ fontWeight:600, color:C.text2 }}>Catálogo vacío</div>
                <div style={{ fontSize:12, marginTop:4, color:C.text3 }}>Añade plantillas en Ajustes → Catálogo</div>
              </div>
            ):(
              <>
                {/* Search */}
                <input style={{ ...INP, borderRadius:14 }} value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Buscar en el catálogo..."/>
                {/* Grouped templates */}
                {Object.entries(grouped).map(([catId,items])=>{
                  const cat=categories.find(c=>c.id===catId);
                  return(
                    <div key={catId}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.text3, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>{cat?.icon} {cat?.label||catId}</div>
                      {items.map(tpl=>(
                        <button key={tpl.id} onClick={()=>applyTemplate(tpl)}
                          style={{ background:C.surface2, border:`1px solid ${C.border}`, borderRadius:14, padding:"13px 16px", cursor:"pointer", textAlign:"left", display:"flex", alignItems:"center", gap:12, width:"100%", marginBottom:8, WebkitTapHighlightColor:"transparent" }}>
                          <div style={{ width:42, height:42, borderRadius:11, background:C.surface, border:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{cat?.icon||"📦"}</div>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:700, fontSize:15, color:C.text }}>{tpl.name}</div>
                            <div style={{ fontSize:12, color:C.text3, marginTop:2 }}>{tpl.unit} · caduca en {tpl.defaultDays}d{tpl.notes?` · ${tpl.notes.slice(0,20)}`:""}</div>
                          </div>
                          <span style={{ color:C.text3, fontSize:20 }}>›</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
                {Object.keys(grouped).length===0&&search&&(
                  <div style={{ textAlign:"center", padding:"16px 0", color:C.text3, fontSize:13 }}>Sin resultados para "{search}"</div>
                )}
              </>
            )}
          </div>
        )}

        {step==="form"&&(
          <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:11 }}>
            <div>
              <div style={{ fontSize:12, fontWeight:600, color:"#475569", marginBottom:5 }}>Categoría</div>
              {!catOpen
                ?<button onClick={()=>setCatOpen(true)} style={{ ...B("ghost"), width:"100%", textAlign:"left", display:"flex", alignItems:"center", gap:8 }}>{curCat?.icon||"📦"} {curCat?.label||"Seleccionar..."}<span style={{ marginLeft:"auto", color:C.text3 }}>▾</span></button>
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
              <div>
                <label style={LBL}>Unidad
                  <select style={INP} value={f.unit} onChange={e=>{ if(e.target.value==="__new__") setAddingUnitForm(true); else setF({...f,unit:e.target.value}); }}>
                    {formUnits.map(u=><option key={u} value={u}>{u}</option>)}
                    <option value="__new__">+ Nueva unidad...</option>
                  </select>
                </label>
                {addingUnitForm&&(
                  <div style={{ display:"flex", gap:6, marginTop:6 }}>
                    <input style={{ ...INP, flex:1, padding:"8px 10px", fontSize:13 }} value={customUnitForm} onChange={e=>setCustomUnitForm(e.target.value)} placeholder="Ej: pallets" autoFocus onKeyDown={e=>{ if(e.key==="Enter"){ const u=customUnitForm.trim(); if(u&&!formUnits.includes(u)){const nu=[...formUnits,u];setFormUnits(nu);const s=JSON.parse(localStorage.getItem("trazapro_units")||"[]");localStorage.setItem("trazapro_units",JSON.stringify([...s,u]));setF({...f,unit:u});}setCustomUnitForm("");setAddingUnitForm(false);}}}/>
                    <button onClick={()=>{ const u=customUnitForm.trim(); if(u&&!formUnits.includes(u)){const nu=[...formUnits,u];setFormUnits(nu);const s=JSON.parse(localStorage.getItem("trazapro_units")||"[]");localStorage.setItem("trazapro_units",JSON.stringify([...s,u]));setF({...f,unit:u});}setCustomUnitForm("");setAddingUnitForm(false);}} style={{ ...B("orange"), padding:"8px 12px", fontSize:13 }}>+</button>
                    <button onClick={()=>{setAddingUnitForm(false);setCustomUnitForm("");}} style={{ ...B("ghost"), padding:"8px 10px", fontSize:13 }}>✕</button>
                  </div>
                )}
              </div>
            </div>
            {/* Stock min/max */}
            <div style={{ background:C.surface2, borderRadius:12, padding:"12px 14px", border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:13, fontWeight:600, color:C.text2, marginBottom:10 }}>📊 Umbrales de stock (opcional)</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <label style={LBL}>
                  Stock mínimo
                  <div style={{ position:"relative" }}>
                    <input style={{ ...INP, paddingLeft:28 }} type="number" min="0" value={f.minStock} onChange={e=>setF({...f,minStock:e.target.value})} placeholder="0"/>
                    <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", fontSize:14 }}>🔴</span>
                  </div>
                </label>
                <label style={LBL}>
                  Stock máximo
                  <div style={{ position:"relative" }}>
                    <input style={{ ...INP, paddingLeft:28 }} type="number" min="0" value={f.maxStock} onChange={e=>setF({...f,maxStock:e.target.value})} placeholder="0"/>
                    <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", fontSize:14 }}>🟢</span>
                  </div>
                </label>
              </div>
              <div style={{ fontSize:11, color:C.text3, marginTop:8 }}>Si la cantidad cae por debajo del mínimo aparecerá una alerta en el Dashboard</div>
            </div>
            <label style={LBL}>Notas / Alérgenos<textarea style={{ ...INP, resize:"vertical", height:60 }} value={f.notes} onChange={e=>setF({...f,notes:e.target.value})} placeholder="Alérgenos, ingredientes..."/></label>
            {/* Frozen toggle */}
            <button type="button" onClick={()=>setF({...f,frozen:!f.frozen})}
              style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 16px", borderRadius:14, border:`2px solid ${f.frozen?"#38BDF8":C.border}`, background:f.frozen?"#E0F7FF":C.surface2, cursor:"pointer", textAlign:"left", width:"100%" }}>
              <span style={{ fontSize:26 }}>{f.frozen?"🧊":"⬜"}</span>
              <div>
                <div style={{ fontWeight:700, fontSize:14, color:f.frozen?"#0369A1":C.text }}>
                  {f.frozen ? "Producto congelado" : "Marcar como congelado"}
                </div>
                <div style={{ fontSize:12, color:C.text3, marginTop:1 }}>
                  {f.frozen ? "Se mostrará con indicador ❄️" : "Activa si este producto está en el congelador"}
                </div>
              </div>
              <div style={{ marginLeft:"auto", width:24, height:24, borderRadius:"50%", background:f.frozen?"#38BDF8":C.border, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                {f.frozen && <span style={{ color:"#fff", fontSize:14, fontWeight:800 }}>✓</span>}
              </div>
            </button>
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
        <div style={MHDR}><span style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:".08em", color:C.text2 }}>Nueva transferencia</span><button onClick={onClose} style={CBTN}>✕</button></div>
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
          {currentUser&&<div style={{ background:C.surface2, borderRadius:8, padding:8, fontSize:12, color:C.text2 }}>✍️ Firmado por: <strong>{currentUser.name}</strong></div>}
          <button onClick={()=>{ if(!f.productId||!f.toRestaurantId)return; onSave({...f,fromRestaurantId:prod?.restaurantId,userId:currentUser?.id||"",date:today(),time:nowTime(),id:uid()}); onClose(); }} style={{ ...B("primary"), width:"100%" }} disabled={!f.productId||!f.toRestaurantId}>
            Registrar transferencia →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SIDEBAR ─────────────────────────────────────────────────────────────────
function Sidebar({ open, onClose, tab, setTab, restsCount, allCount, currentUser, onChangeUser, onNewProduct, onExport, onScan }) {
  return (
    <>
      <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:200, background:"rgba(20,15,8,0.55)", backdropFilter:"blur(3px)", opacity:open?1:0, pointerEvents:open?"auto":"none", transition:"opacity .2s" }}/>
      <div style={{ position:"fixed", top:0, left:0, bottom:0, width:280, zIndex:201, background:C.darkL, transform:open?"translateX(0)":"translateX(-100%)", transition:"transform .25s cubic-bezier(.4,0,.2,1)", display:"flex", flexDirection:"column", boxShadow:"6px 0 32px rgba(0,0,0,.35)" }}>

        {/* Header */}
        <div style={{ padding:"20px 20px 16px", borderBottom:"1px solid rgba(255,255,255,.08)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:38, height:38, background:C.accent, borderRadius:11, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>⊛</div>
            <div>
              <div style={{ fontWeight:800, fontSize:18, color:"#fff", letterSpacing:"-0.02em" }}>Traza<span style={{ color:C.accentL }}>Pro</span></div>
              <div style={{ fontSize:11, color:C.text3 }}>Trazabilidad</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,.08)", border:"none", cursor:"pointer", color:C.text3, fontSize:18, lineHeight:1, padding:"6px 8px", borderRadius:8 }}>✕</button>
        </div>

        {/* Current user pill */}
        {currentUser && (
          <button onClick={() => { onChangeUser(); onClose(); }}
            style={{ margin:"14px 14px 0", background:"rgba(212,98,42,.15)", border:"1px solid rgba(212,98,42,.25)", borderRadius:14, padding:"11px 14px", cursor:"pointer", textAlign:"left", display:"flex", alignItems:"center", gap:12, WebkitTapHighlightColor:"transparent" }}>
            <div style={{ width:38, height:38, borderRadius:"50%", background:C.accent, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, fontWeight:800, color:"#fff", flexShrink:0 }}>
              {currentUser.name.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:700, fontSize:14, color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{currentUser.name}</div>
              <div style={{ fontSize:11, color:C.text3, marginTop:1 }}>{currentUser.role||"Sin rol"} · Cambiar usuario</div>
            </div>
          </button>
        )}

        {/* Nav items */}
        <nav style={{ flex:1, overflowY:"auto", padding:"12px 10px" }}>
          {NAVS.filter(n=>can(currentUser,n.id)).map(n => {
            const active = tab === n.id;
            const badge  = n.id==="restaurants" ? restsCount : n.id==="products" ? allCount : null;
            return (
              <button key={n.id} onClick={() => { setTab(n.id); onClose(); }}
                style={{ width:"100%", display:"flex", alignItems:"center", gap:14, padding:"13px 14px", borderRadius:12, border:"none", cursor:"pointer", marginBottom:4, textAlign:"left", background:active?"rgba(212,98,42,.18)":"transparent", color:active?C.accentL:"rgba(255,255,255,.55)", fontWeight:active?700:400, fontSize:15, WebkitTapHighlightColor:"transparent", transition:"background .15s" }}>
                <span style={{ fontSize:20, width:24, textAlign:"center", opacity:active?1:0.7 }}>{n.icon}</span>
                <span style={{ flex:1 }}>{n.l}</span>
                {badge != null && badge > 0 && (
                  <span style={{ background:active?C.accent:"rgba(255,255,255,.15)", color:active?"#fff":"rgba(255,255,255,.7)", borderRadius:20, padding:"2px 8px", fontSize:12, fontWeight:700 }}>{badge}</span>
                )}
                {active && <div style={{ width:3, height:22, background:C.accent, borderRadius:2, flexShrink:0 }}/>}
              </button>
            );
          })}
        </nav>

        {/* Quick actions */}
        <div style={{ padding:"14px", borderTop:"1px solid rgba(255,255,255,.08)", display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:C.text3, marginBottom:2 }}>Acciones rapidas</div>
          {can(currentUser,"products.create")&&<button onClick={() => { onNewProduct(); onClose(); }}
            style={{ ...B("orange"), width:"100%", textAlign:"left", display:"flex", alignItems:"center", gap:10, fontSize:14, padding:"13px 16px" }}>
            <span style={{ fontSize:18 }}>＋</span> Nuevo producto
          </button>}
          {can(currentUser,"scan")&&<button onClick={() => { onScan(); onClose(); }}
            style={{ width:"100%", textAlign:"left", display:"flex", alignItems:"center", gap:10, fontSize:14, background:"rgba(255,255,255,.07)", color:"rgba(255,255,255,.8)", border:"1px solid rgba(255,255,255,.12)", borderRadius:12, padding:"13px 16px", cursor:"pointer", fontWeight:600, WebkitTapHighlightColor:"transparent" }}>
            <span style={{ fontSize:18 }}>📷</span> Escanear QR
          </button>}
          {can(currentUser,"settings")&&<button onClick={onExport}
            style={{ width:"100%", textAlign:"left", display:"flex", alignItems:"center", gap:10, fontSize:14, background:"rgba(255,255,255,.07)", color:"rgba(255,255,255,.8)", border:"1px solid rgba(255,255,255,.12)", borderRadius:12, padding:"13px 16px", cursor:"pointer", fontWeight:600, WebkitTapHighlightColor:"transparent" }}>
            <span style={{ fontSize:18 }}>📊</span> Exportar Excel
          </button>}
        </div>
      </div>
    </>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [loading,      setLoading]      = useState(true);
  const catsSeeded = useRef(false); // prevents re-seeding categories on reconnect
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
  const [toast,        setToast]        = useState(null); // {message,type}
  const [confirm,      setConfirm]      = useState(null); // {message,onConfirm,label}

  // Helper to show toast
  const showToast = (message, type="success") => setToast({message,type});
  // Helper to show confirm dialog
  const showConfirm = (message, onConfirm, label="Sí, eliminar") =>
    setConfirm({message, onConfirm, label});

  // Firebase data
  const [restaurants,  setRestaurants]  = useState([]);
  const [products,     setProducts]     = useState([]);
  const [transfers,    setTransfers]    = useState([]);
  const [history,      setHistory]      = useState([]);
  const [categories,   setCategories]   = useState(DEFAULT_CATS);
  const [catalog,      setCatalog]      = useState([]);
  const [users,        setUsers]        = useState([]);
  const [inventories,  setInventories]  = useState([]);

  // Subscribe to all Firestore collections
  useEffect(() => {
    const unsubs = [
      onSnapshot(query(collection(db,"restaurants"),orderBy("name")),    s=>setRestaurants(s.docs.map(d=>({id:d.id,...d.data()}))), ()=>{}),
      onSnapshot(query(collection(db,"products")),                        s=>setProducts(s.docs.map(d=>({id:d.id,...d.data()}))), ()=>{}),
      onSnapshot(query(collection(db,"transfers"),orderBy("date","desc")),s=>setTransfers(s.docs.map(d=>({id:d.id,...d.data()}))), ()=>{}),
      onSnapshot(query(collection(db,"history"),  orderBy("date","desc")),s=>setHistory(s.docs.map(d=>({id:d.id,...d.data()}))), ()=>{}),
      onSnapshot(collection(db,"categories"), s=>{
        const docs=s.docs.map(d=>({id:d.id,...d.data()}));
        if(docs.length===0 && !catsSeeded.current){
          // Seed default categories ONCE on first use only
          catsSeeded.current = true;
          DEFAULT_CATS.forEach(c=>fbSet("categories",c.id,c));
          setCategories(DEFAULT_CATS);
        } else if(docs.length>0){
          setCategories(docs);
        }
      }, ()=>{}),
      onSnapshot(collection(db,"catalog"),                                s=>setCatalog(s.docs.map(d=>({id:d.id,...d.data()}))), ()=>{}),
      onSnapshot(query(collection(db,"users"),orderBy("name")),           s=>setUsers(s.docs.map(d=>({id:d.id,...d.data()}))), ()=>{}),
      onSnapshot(query(collection(db,"inventories"),orderBy("date","desc")),s=>setInventories(s.docs.map(d=>({id:d.id,...d.data()}))), ()=>{}),
    ];
    setTimeout(()=>setLoading(false), 1200);
    return () => unsubs.forEach(u=>u());
  }, []);

  // Always show user select on load (session expires on reload)
  useEffect(() => {
    setShowUserSel(true);
  }, []);

  function selectUser(u) {
    setCurrentUser(u);
    // Session intentionally NOT saved to localStorage — expires on app close/reload
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

  async function saveCategory(c) { try { await fbSet("categories", c.id, c); } catch { showToast("Error al guardar categoría","error"); } }
  async function deleteCategory(id) {
    await fbDel("categories", id);
    const fallback = categories.find(c=>c.id!==id)?.id||"otros";
    products.filter(p=>p.category===id).forEach(p=>fbSet("products",p.id,{category:fallback}));
  }

  async function saveCatalogItem(item) { try { await fbSet("catalog", item.id, item); } catch { showToast("Error al guardar plantilla","error"); } }
  async function deleteCatalogItem(id) { try { await fbDel("catalog", id); showToast("Plantilla eliminada"); } catch { showToast("Error al eliminar","error"); } }

  async function saveUser(u) { try { await fbSet("users", u.id, u); } catch { showToast("Error al guardar usuario","error"); throw new Error(); } }
  async function deleteUser(id) { try { await fbDel("users", id); showToast("Usuario eliminado"); } catch { showToast("Error al eliminar","error"); } }

  async function saveProduct(p) {
    try {
      const isNew = !products.find(x=>x.id===p.id);
      await fbSet("products", p.id, p);
      const rest = rmap[p.restaurantId];
      addHistEntry(isNew?"created":"edited", p.id, p.restaurantId, isNew?`Creado en ${rest?.name}`:`Editado: ${p.name}`, p.name);
      showToast(isNew?"Producto creado":"Producto actualizado");
    } catch { showToast("Error al guardar el producto","error"); }
  }
  async function deleteProduct(id) {
    try { await fbDel("products", id); showToast("Producto eliminado"); }
    catch { showToast("Error al eliminar","error"); }
  }

  async function saveInventory(inv) {
    try { await fbAdd("inventories", inv); } catch { showToast("Error al guardar el recuento","error"); return; }
    for (const item of inv.items) {
      if (item.actual !== "" && item.actual !== null && item.actual !== undefined) {
        await fbSet("products", item.productId, { quantity: parseFloat(item.actual) });
      }
    }
    const rest = restaurants.find(r=>r.id===inv.restaurantId);
    const cat  = cats.find(c=>c.id===inv.categoryId);
    addHistEntry("inventory", null, inv.restaurantId,
      `Recuento de ${cat?.label||"categoria"} en ${rest?.name||"—"} · ${inv.items.length} productos`,
      "Inventario"
    );
    showToast("Recuento guardado");
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
    try { await fbAdd("transfers", t); } catch { showToast("Error al guardar la transferencia","error"); return; }

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
    showToast("Transferencia registrada");
  }

  // ── Derived state ────────────────────────────────────────────────────────────
  const cats    = categories.length ? categories : DEFAULT_CATS;
  const cmap    = Object.fromEntries(cats.map(c=>[c.id,c]));
  const umap    = Object.fromEntries(users.map(u=>[u.id,u]));
  const pmap    = Object.fromEntries(products.map(p=>[p.id,p]));
  const rmap    = Object.fromEntries(restaurants.map(r=>[r.id,r]));
  const expired = products.filter(p=>isExp(p.expiry));
  const near    = products.filter(p=>isNear(p.expiry));
  const curNav  = NAVS.find(n=>n.id===tab);

  const filtered = products.filter(p=>{
    const ms=!search||p.name.toLowerCase().includes(search.toLowerCase())||p.lot?.toLowerCase().includes(search.toLowerCase());
    const mr=fRest==="all"||p.restaurantId===fRest;
    const mc=fCat==="all"||p.category===fCat;
    const mst=fSt==="all"||(fSt==="expired"&&isExp(p.expiry))||(fSt==="near"&&isNear(p.expiry))||(fSt==="ok"&&!isExp(p.expiry)&&!isNear(p.expiry))||(fSt==="frozen"&&p.frozen)||(fSt==="low"&&stockLevel(p)==="low");
    return ms&&mr&&mc&&mst;
  });

  // ── Loading / User select ────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:C.dark, flexDirection:"column", gap:12 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width:48, height:48, background:"#f97316", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>⊛</div>
      <Spinner/>
      <span style={{ color:C.text2, fontSize:13 }}>Conectando con Firebase...</span>
    </div>
  );

  if (showUserSel || !currentUser) return (
    <>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}*{box-sizing:border-box;-webkit-font-smoothing:antialiased}body{margin:0;font-family:'DM Sans',system-ui,sans-serif}`}</style>
      <UserSelectScreen users={users} onSelect={selectUser} />
      {modal==="user"&&<UserModal user={null} restaurants={restaurants} onClose={()=>{setModal(null);if(!currentUser)setShowUserSel(true);}} onSave={async u=>{await saveUser(u);selectUser(u);}} onDelete={()=>{}}/>}
    </>
  );

  return (
    <div style={{ minHeight:"100vh", background:C.bg, fontFamily:"'DM Sans',system-ui,sans-serif", color:C.text }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800&display=swap');*{box-sizing:border-box;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}body{margin:0}button:disabled{opacity:.35;cursor:not-allowed!important}input:focus,select:focus,textarea:focus{outline:none;border-color:${C.accent}!important;box-shadow:0 0 0 4px ${C.accentBg}}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:${C.border2};border-radius:4px}@keyframes spin{to{transform:rotate(360deg)}}input[type=number]::-webkit-inner-spin-button{opacity:1}`}</style>

      <Sidebar open={sidebarOpen} onClose={()=>setSidebarOpen(false)} tab={tab} setTab={setTab}
        restsCount={restaurants.length} allCount={products.length}
        currentUser={currentUser} onChangeUser={()=>setShowUserSel(true)}
        onNewProduct={()=>{setSel(null);setModal("product");}}
        onExport={()=>exportXLS({restaurants,products,transfers,history,categories:cats,users,inventories})}
        onScan={()=>setModal("scanner")}
      />

      {/* Topbar */}
      <div style={{ background:C.dark, padding:"0 16px", height:60, display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:100, gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          {/* Hamburger */}
          <button onClick={()=>setSidebarOpen(true)}
            style={{ background:"rgba(255,255,255,.08)", border:"none", cursor:"pointer", padding:"10px 11px", display:"flex", flexDirection:"column", gap:5, borderRadius:10 }}>
            {[0,1,2].map(i=><span key={i} style={{ display:"block", width:20, height:2, background:"#fff", borderRadius:2 }}/>)}
          </button>
          <span style={{ fontWeight:800, fontSize:17, color:"#fff", letterSpacing:"-0.02em" }}>Traza<span style={{ color:C.accentL }}>Pro</span></span>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {/* Scan button */}
          <button onClick={()=>setModal("scanner")}
            style={{ background:"rgba(255,255,255,.1)", border:"1px solid rgba(255,255,255,.15)", cursor:"pointer", color:"#fff", borderRadius:10, padding:"8px 14px", fontSize:13, fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
            📷 <span>Scan</span>
          </button>
          {/* User avatar */}
          <button onClick={()=>setShowUserSel(true)}
            style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(255,255,255,.1)", border:"1px solid rgba(255,255,255,.15)", borderRadius:10, padding:"5px 10px 5px 6px", cursor:"pointer" }}>
            <div style={{ width:28, height:28, borderRadius:"50%", background:ROLES[currentUser.role]?.color||C.accent, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:800, color:"#fff" }}>
              {currentUser.name.charAt(0).toUpperCase()}
            </div>
            <span style={{ fontSize:12, fontWeight:600, color:"#fff", maxWidth:70, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{currentUser.name}</span>
          </button>
        </div>
      </div>

      {/* Page title bar */}
      <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"12px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:20 }}>{curNav?.icon}</span>
          <span style={{ fontWeight:700, fontSize:17, color:C.text }}>{curNav?.l}</span>
          {tab==="products"&&products.length>0&&<span style={bdg("neutral")}>{products.length}</span>}
          {tab==="restaurants"&&<span style={bdg("blue")}>{restaurants.length}</span>}
        </div>
        {/* Context action button */}
        {tab==="products"&&can(currentUser,"products.create")&&<button onClick={()=>{setSel(null);setModal("product");}} style={{ ...B("orange"), padding:"10px 18px", fontSize:14 }}>Nuevo producto</button>}
        {tab==="restaurants"&&<button onClick={()=>{setSel(null);setModal("restaurant");}} style={{ ...B("orange"), padding:"10px 18px", fontSize:14 }}>+ Local</button>}
        {tab==="transfers"&&<button onClick={()=>setModal("transfer")} style={{ ...B("orange"), padding:"10px 18px", fontSize:14 }}>Transferir</button>}
      </div>

      <div style={{ maxWidth:640, margin:"0 auto", padding:"16px 14px 32px" }}>

        {/* ── DASHBOARD ── */}
        {tab==="dashboard"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

            {/* Big alert strip if problems exist */}
            {(expired.length>0||near.length>0)&&(
              <div style={{ background:expired.length>0?C.redBg:C.amberBg, borderRadius:16, padding:"16px 18px", border:`1px solid ${expired.length>0?C.red:C.amber}33` }}>
                <div style={{ fontWeight:800, fontSize:15, color:expired.length>0?C.red:C.amber, marginBottom:10 }}>
                  {expired.length>0 ? `⚠️ ${expired.length} producto${expired.length!==1?"s":""} caducado${expired.length!==1?"s":""}` : `⏱ ${near.length} producto${near.length!==1?"s":""} caduca pronto`}
                </div>
                {[...expired.map(p=>({...p,_t:"e"})),...near.map(p=>({...p,_t:"n"}))].slice(0,4).map(p=>(
                  <div key={p.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${p._t==="e"?C.red:C.amber}22` }}>
                    <div>
                      <div style={{ fontWeight:600, fontSize:14, color:C.text }}>{p.name}</div>
                      <div style={{ fontSize:12, color:C.text2, marginTop:2 }}>{restaurants.find(r=>r.id===p.restaurantId)?.name} · {fmt(p.expiry)}</div>
                    </div>
                    <StatusBadge expiry={p.expiry}/>
                  </div>
                ))}
              </div>
            )}

            {/* Stock low alerts */}
            {(()=>{
              const lowStock = products.filter(p=>stockLevel(p)==="low");
              if(lowStock.length===0) return null;
              return (
                <div style={{ background:C.redBg, borderRadius:16, padding:"16px 18px", border:`1px solid ${C.red}33` }}>
                  <div style={{ fontWeight:800, fontSize:15, color:C.red, marginBottom:10 }}>
                    🔴 {lowStock.length} producto{lowStock.length!==1?"s":""} por debajo del stock mínimo
                  </div>
                  {lowStock.slice(0,5).map(p=>{
                    const rest=restaurants.find(r=>r.id===p.restaurantId);
                    return(
                      <div key={p.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.red}22` }}>
                        <div>
                          <div style={{ fontWeight:600, fontSize:14, color:C.text }}>{p.name}</div>
                          <div style={{ fontSize:12, color:C.text2, marginTop:2 }}>{rest?.name} · Actual: {p.quantity} {p.unit} / Mín: {p.minStock} {p.unit}</div>
                        </div>
                        <div style={{ fontWeight:800, fontSize:13, color:C.red }}>{p.quantity}/{p.minStock}</div>
                      </div>
                    );
                  })}
                  {lowStock.length>5&&<div style={{ fontSize:12, color:C.red, marginTop:8, textAlign:"center" }}>+{lowStock.length-5} más...</div>}
                </div>
              );
            })()}

            {/* Key stats — 2x2 grid, big and clear */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {[
                {l:"Productos activos", v:products.length,    i:"📦", c:C.text,   bg:C.surface,  action:()=>setTab("products")},
                {l:"Transferencias",    v:transfers.length,   i:"⇄",  c:C.blue,   bg:C.blueBg,   action:()=>setTab("transfers")},
                {l:"Caducados",         v:expired.length,     i:"⚠️", c:C.red,    bg:C.redBg,    action:()=>setTab("products")},
                {l:"Locales",           v:restaurants.length, i:"🏠", c:C.green,  bg:C.greenBg,  action:()=>setTab("restaurants")},
              ].map(card=>(
                <button key={card.l} onClick={card.action}
                  style={{ background:card.bg, borderRadius:16, padding:"18px 16px", border:`1px solid ${C.border}`, textAlign:"left", cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,.04)", WebkitTapHighlightColor:"transparent" }}>
                  <div style={{ fontSize:26, marginBottom:8 }}>{card.i}</div>
                  <div style={{ fontSize:32, fontWeight:800, color:card.c, lineHeight:1 }}>{card.v}</div>
                  <div style={{ fontSize:12, color:C.text2, marginTop:5, fontWeight:500 }}>{card.l}</div>
                </button>
              ))}
            </div>

            {/* Quick actions */}
            <div style={{ background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, padding:"16px 18px" }}>
              <div style={{ fontWeight:700, fontSize:14, color:C.text, marginBottom:12 }}>Acciones rapidas</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <button onClick={()=>{setSel(null);setModal("product");}} style={{ ...B("orange"), padding:"14px 12px", fontSize:14, display:"flex", flexDirection:"column", alignItems:"center", gap:6, borderRadius:14 }}>
                  <span style={{ fontSize:24 }}>📦</span>
                  <span>Nuevo producto</span>
                </button>
                <button onClick={()=>setModal("transfer")} style={{ ...B("ghost"), padding:"14px 12px", fontSize:14, display:"flex", flexDirection:"column", alignItems:"center", gap:6, borderRadius:14, border:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:24 }}>⇄</span>
                  <span>Transferir</span>
                </button>
                <button onClick={()=>setModal("scanner")} style={{ ...B("ghost"), padding:"14px 12px", fontSize:14, display:"flex", flexDirection:"column", alignItems:"center", gap:6, borderRadius:14, border:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:24 }}>📷</span>
                  <span>Escanear QR</span>
                </button>
                <button onClick={()=>setTab("history")} style={{ ...B("ghost"), padding:"14px 12px", fontSize:14, display:"flex", flexDirection:"column", alignItems:"center", gap:6, borderRadius:14, border:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:24 }}>📋</span>
                  <span>Historial</span>
                </button>
              </div>
            </div>

            {/* Recent transfers */}
            {transfers.length>0&&(
              <div style={{ background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, overflow:"hidden" }}>
                <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}` }}>
                  <div style={{ fontWeight:700, fontSize:14, color:C.text }}>Últimas transferencias</div>
                </div>
                <div style={{ padding:"0 18px" }}>
                  {transfers.slice(0,5).map(t=>{
                    const p=pmap[t.productId], from=rmap[t.fromRestaurantId], to=rmap[t.toRestaurantId], u=umap[t.userId];
                    return(
                      <div key={t.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 0", borderBottom:`1px solid ${C.border}` }}>
                        <div style={{ width:40, height:40, background:C.surface2, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>⇄</div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:600, fontSize:14, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p?.name||"—"}</div>
                          <div style={{ fontSize:12, color:C.text2, marginTop:2 }}>{from?.name||"—"} → {to?.name||"—"}{u?` · ${u.name}`:""}</div>
                        </div>
                        <div style={{ fontSize:11, color:C.text3, textAlign:"right", flexShrink:0 }}>{fmt(t.date)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        )}

        {/* ── LOCALES ── */}
        {tab==="restaurants"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {restaurants.length===0
              ?<div style={{ textAlign:"center", padding:"60px 0", color:C.text3 }}>
                <div style={{ fontSize:48, marginBottom:10 }}>🏠</div>
                <div style={{ fontWeight:600, fontSize:16, color:C.text2 }}>Sin locales registrados</div>
              </div>
              :<div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                {restaurants.map(r=>{
                  const pCount=products.filter(p=>p.restaurantId===r.id).length;
                  const expCount=products.filter(p=>p.restaurantId===r.id&&isExp(p.expiry)).length;
                  const nearCount=products.filter(p=>p.restaurantId===r.id&&isNear(p.expiry)).length;
                  const invCount=inventories.filter(i=>i.restaurantId===r.id).length;
                  const lastInv=inventories.find(i=>i.restaurantId===r.id);
                  return(
                    <div key={r.id} style={{ background:C.surface, borderRadius:18, border:`1px solid ${C.border}`, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.06)" }}>
                      {/* Header */}
                      <div style={{ background:`linear-gradient(135deg, ${C.dark}, ${C.darkL})`, padding:"18px 18px 14px" }}>
                        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                            <div style={{ width:44, height:44, background:C.accent, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>🏠</div>
                            <div>
                              <div style={{ fontWeight:800, fontSize:17, color:"#fff" }}>{r.name}</div>
                              {r.city&&<div style={{ fontSize:12, color:"rgba(255,255,255,.55)", marginTop:2 }}>{r.city}{r.zip?" · "+r.zip:""}</div>}
                            </div>
                          </div>
                          <button onClick={()=>{setSel(r);setModal("restaurant");}}
                            style={{ background:"rgba(255,255,255,.12)", border:"none", cursor:"pointer", borderRadius:10, padding:"8px 14px", color:"#fff", fontSize:13, fontWeight:600 }}>Editar</button>
                        </div>
                        {/* Stats row */}
                        <div style={{ display:"flex", gap:16, marginTop:14 }}>
                          <div style={{ textAlign:"center" }}><div style={{ fontSize:24, fontWeight:800, color:"#fff" }}>{pCount}</div><div style={{ fontSize:11, color:"rgba(255,255,255,.5)" }}>productos</div></div>
                          {expCount>0&&<div style={{ textAlign:"center" }}><div style={{ fontSize:24, fontWeight:800, color:"#FF8A80" }}>{expCount}</div><div style={{ fontSize:11, color:"rgba(255,255,255,.5)" }}>caducados</div></div>}
                          {nearCount>0&&<div style={{ textAlign:"center" }}><div style={{ fontSize:24, fontWeight:800, color:"#FFD180" }}>{nearCount}</div><div style={{ fontSize:11, color:"rgba(255,255,255,.5)" }}>proximos</div></div>}
                          <div style={{ textAlign:"center" }}><div style={{ fontSize:24, fontWeight:800, color:"#80CBC4" }}>{invCount}</div><div style={{ fontSize:11, color:"rgba(255,255,255,.5)" }}>recuentos</div></div>
                        </div>
                      </div>
                      {/* Details */}
                      <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:8 }}>
                        {[r.cif&&["🏢",r.cif],r.manager&&["👤",r.manager],r.phone&&["📞",r.phone],r.email&&["✉️",r.email]].filter(Boolean).map(([icon,val])=>(
                          <div key={icon} style={{ display:"flex", gap:10, fontSize:14, color:C.text2 }}><span>{icon}</span><span>{val}</span></div>
                        ))}
                        {r.notes&&<div style={{ fontSize:13, color:C.text2, background:C.surface2, borderRadius:10, padding:"8px 12px", marginTop:4 }}>{r.notes}</div>}
                        {/* Actions */}
                        <div style={{ display:"flex", gap:8, marginTop:6 }}>
                          <button onClick={()=>{setFRest(r.id);setTab("products");}} style={{ ...B("ghost"), flex:1, fontSize:13, padding:"11px 12px" }}>Ver productos</button>
                          <button onClick={()=>setModal("transfer")} style={{ ...B("blue"), flex:1, fontSize:13, padding:"11px 12px" }}>Transferir</button>
                        </div>
                        {lastInv && (
                          <div style={{ marginTop:8, fontSize:12, color:C.text3, display:"flex", alignItems:"center", justifyContent:"space-between", background:C.surface2, borderRadius:10, padding:"8px 12px" }}>
                            <span>📦 Último recuento: <strong style={{ color:C.text }}>{fmt(lastInv.date)}</strong></span>
                            <button onClick={()=>setTab("inventory")} style={{ background:"none", border:"none", cursor:"pointer", color:C.accent, fontSize:12, fontWeight:700, padding:0 }}>Ver →</button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            }
          </div>
        )}

        {/* ── PRODUCTOS ── */}
        {tab==="products"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {/* Search bar */}
            <div style={{ position:"relative" }}>
              <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", fontSize:16, color:C.text3 }}>🔍</span>
              <input style={{ ...INP, paddingLeft:44, borderRadius:14, fontSize:14 }} placeholder="Buscar producto o lote..." value={search} onChange={e=>setSearch(e.target.value)}/>
            </div>
            {/* Filter chips */}
            <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:2 }}>
              {[{v:"all",l:"Todos"},...restaurants.map(r=>({v:r.id,l:r.name}))].map(r=>(
                <button key={r.v} onClick={()=>setFRest(r.v)}
                  style={{ flexShrink:0, padding:"8px 14px", borderRadius:20, border:`1.5px solid ${fRest===r.v?C.accent:C.border}`, background:fRest===r.v?C.accentBg:C.surface, color:fRest===r.v?C.accent:C.text2, fontSize:13, fontWeight:fRest===r.v?700:400, cursor:"pointer", whiteSpace:"nowrap" }}>
                  {r.l}
                </button>
              ))}
            </div>
            {/* Category filter chips */}
            <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:2 }}>
              {[{v:"all",l:"Todas las categorías"},...cats.map(c=>({v:c.id,l:`${c.icon} ${c.label}`}))].map(c=>(
                <button key={c.v} onClick={()=>setFCat(c.v)}
                  style={{ flexShrink:0, padding:"8px 14px", borderRadius:20, border:`1.5px solid ${fCat===c.v?C.accent:C.border}`, background:fCat===c.v?C.accentBg:C.surface, color:fCat===c.v?C.accent:C.text2, fontSize:13, fontWeight:fCat===c.v?700:400, cursor:"pointer", whiteSpace:"nowrap" }}>
                  {c.l}
                </button>
              ))}
            </div>
            {/* Status + frozen filter chips */}
            <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:2 }}>
              {[{v:"all",l:"Todos los estados"},{v:"ok",l:"✅ OK"},{v:"near",l:"⏱ Caduca pronto"},{v:"expired",l:"⚠️ Caducados"},{v:"frozen",l:"❄️ Congelados"},{v:"low",l:"🔴 Stock bajo"}].map(s=>(
                <button key={s.v} onClick={()=>setFSt(s.v)}
                  style={{ flexShrink:0, padding:"8px 14px", borderRadius:20, border:`1.5px solid ${fSt===s.v?C.accent:C.border}`, background:fSt===s.v?C.accentBg:C.surface, color:fSt===s.v?C.accent:C.text2, fontSize:13, fontWeight:fSt===s.v?700:400, cursor:"pointer", whiteSpace:"nowrap" }}>
                  {s.l}
                </button>
              ))}
            </div>

            {/* Product list */}
            {filtered.length===0
              ?<div style={{ textAlign:"center", padding:"60px 0", color:C.text3 }}>
                <div style={{ fontSize:48, marginBottom:10 }}>📦</div>
                <div style={{ fontWeight:600, fontSize:16, color:C.text2 }}>Sin productos</div>
                <div style={{ fontSize:13, marginTop:4 }}>Pulsa + Producto para empezar</div>
              </div>
              :<div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {filtered.map(p=>{
                  const rest=restaurants.find(r=>r.id===p.restaurantId), cat=cmap[p.category], creator=umap[p.createdBy];
                  const expired_p = isExp(p.expiry), near_p = isNear(p.expiry);
                  return(
                    <div key={p.id} style={{ background:C.surface, borderRadius:16, border:`1.5px solid ${expired_p?C.red+"55":near_p?C.amber+"55":C.border}`, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,.04)" }}>
                      {/* Product main row */}
                      <div style={{ padding:"14px 16px" }}>
                        <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
                          <div style={{ width:48, height:48, background:expired_p?C.redBg:near_p?C.amberBg:p.frozen?"#E0F7FF":C.surface2, borderRadius:13, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0, position:"relative" }}>
                            {cat?.icon||"📦"}
                            {p.frozen&&<span style={{ position:"absolute", bottom:-2, right:-2, fontSize:14 }}>❄️</span>}
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:4 }}>
                              <span style={{ fontWeight:700, fontSize:16, color:C.text }}>{p.name}</span>
                              <StatusBadge expiry={p.expiry}/>
                              {p.frozen&&<span style={{ background:"#E0F7FF", color:"#0369A1", border:"1px solid #38BDF833", borderRadius:8, padding:"2px 8px", fontSize:11, fontWeight:700 }}>❄️ Congelado</span>}
                            </div>
                            <div style={{ fontSize:13, color:C.text2 }}>🏠 {rest?.name}</div>
                            <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 12px", marginTop:6, fontSize:12, color:C.text3 }}>
                              {p.elaboration&&<span>📅 Elab: {fmt(p.elaboration)}</span>}
                              {p.expiry&&<span style={{ color:expired_p?C.red:near_p?C.amber:C.text3 }}>⏱ Cad: {fmt(p.expiry)}</span>}
                              {p.quantity!==""&&p.quantity!==null&&p.quantity!==undefined&&(()=>{
                                const level=stockLevel(p);
                                const col=level==="low"?C.red:level==="warning"?C.amber:C.green;
                                const icon=level==="low"?"🔴":level==="warning"?"🟡":"🟢";
                                return <span style={{ color:col, fontWeight:level==="low"?700:400 }}>{icon} {p.quantity} {p.unit}{p.minStock?` / mín ${p.minStock}`:""}</span>;
                              })()}
                              {p.lot&&<span>🔢 {p.lot}</span>}
                            </div>
                            {creator&&<div style={{ fontSize:11, color:C.text3, marginTop:4 }}>✍️ {creator.name}</div>}
                          </div>
                        </div>
                      </div>
                      {/* Action bar */}
                      <div style={{ display:"flex", borderTop:`1px solid ${C.border}`, background:C.surface2 }}>
                        {[
                          {icon:"🏷", label:"Etiqueta", action:()=>{setSel(p);setModal("label");}, perm:"products"},
                          {icon:"✏️", label:"Editar",   action:()=>{setSel(p);setModal("product");}, perm:"products.edit"},
                          {icon:"🗑", label:"Borrar",   action:()=>showConfirm(`¿Eliminar "${p.name}"?`,()=>deleteProduct(p.id)), red:true, perm:"products.delete"},
                        ].filter(a=>can(currentUser,a.perm)).map(a=>(
                          <button key={a.label} onClick={a.action}
                            style={{ flex:1, padding:"12px 4px", border:"none", background:"transparent", cursor:"pointer", fontSize:12, color:a.red?C.red:C.text2, fontWeight:600, display:"flex", flexDirection:"column", alignItems:"center", gap:3, borderRight:`1px solid ${C.border}` }}>
                            <span style={{ fontSize:18 }}>{a.icon}</span>
                            <span>{a.label}</span>
                          </button>
                        ))}
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
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {transfers.length===0
              ?<div style={{ textAlign:"center", padding:"60px 0", color:C.text3 }}>
                <div style={{ fontSize:48, marginBottom:10 }}>⇄</div>
                <div style={{ fontWeight:600, fontSize:16, color:C.text2 }}>Sin transferencias</div>
                <div style={{ fontSize:13, marginTop:4 }}>Usa el botón de arriba para registrar una</div>
              </div>
              :<div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {transfers.map(t=>{
                  const p=pmap[t.productId], from=rmap[t.fromRestaurantId], to=rmap[t.toRestaurantId], u=umap[t.userId];
                  return(
                    <div key={t.id} style={{ background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, padding:"14px 16px", boxShadow:"0 1px 3px rgba(0,0,0,.04)" }}>
                      <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
                        <div style={{ width:44, height:44, background:C.blueBg, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>⇄</div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:700, fontSize:15, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p?.name||"Producto eliminado"}</div>
                          <div style={{ fontSize:13, color:C.blue, fontWeight:600, marginTop:3 }}>{from?.name||"—"} → {to?.name||"—"}</div>
                          <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 10px", marginTop:6, fontSize:12, color:C.text3 }}>
                            {t.qty&&<span>📊 {t.qty} {p?.unit||""}</span>}
                            <span>📅 {fmt(t.date)}{t.time?" "+t.time:""}</span>
                            {u&&<span style={{ color:C.accent }}>✍️ {u.name}</span>}
                            {t.note&&<span>💬 {t.note}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            }
          </div>
        )}

        {/* ── INVENTARIO ── */}
        {tab==="inventory"&&(
          <div style={{display:"flex", flexDirection:"column", gap:14}}>

            {/* Header action */}
            <button onClick={()=>setModal("inventory")} style={{...B("orange"), width:"100%", fontSize:15, padding:"15px", display:"flex", alignItems:"center", justifyContent:"center", gap:10}}>
              <span style={{fontSize:22}}>📦</span> Nuevo recuento de stock
            </button>

            {/* Last inventory per category quick view */}
            {inventories.length===0 ? (
              <div style={{textAlign:"center", padding:"60px 0", color:C.text3}}>
                <div style={{fontSize:48, marginBottom:10}}>📦</div>
                <div style={{fontWeight:600, fontSize:16, color:C.text2}}>Sin recuentos registrados</div>
                <div style={{fontSize:13, marginTop:4}}>Pulsa el botón para hacer tu primer recuento</div>
              </div>
            ) : (
              <div style={{display:"flex", flexDirection:"column", gap:10}}>
                {inventories.map(inv=>{
                  const rest = restaurants.find(r=>r.id===inv.restaurantId);
                  const cat  = cats.find(c=>c.id===inv.categoryId);
                  const u    = umap[inv.userId];
                  const changed = (inv.items||[]).filter(i=>i.diff!==null&&i.diff!==0).length;
                  const total   = (inv.items||[]).length;
                  const counted = (inv.items||[]).filter(i=>i.actual!=="").length;
                  return (
                    <div key={inv.id} style={{background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,.04)"}}>
                      {/* Header */}
                      <div style={{background:`linear-gradient(135deg,${C.dark},${C.darkL})`, padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between"}}>
                        <div style={{display:"flex", alignItems:"center", gap:10}}>
                          <div style={{width:40, height:40, background:"rgba(255,255,255,.12)", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22}}>
                            {cat?.icon||"📦"}
                          </div>
                          <div>
                            <div style={{fontWeight:800, fontSize:15, color:"#fff"}}>{cat?.label||"—"}</div>
                            <div style={{fontSize:12, color:"rgba(255,255,255,.55)", marginTop:1}}>🏠 {rest?.name||"—"}</div>
                          </div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:12, color:"rgba(255,255,255,.7)"}}>{fmt(inv.date)}</div>
                          <div style={{fontSize:11, color:"rgba(255,255,255,.45)"}}>{inv.time||""}</div>
                        </div>
                      </div>
                      {/* Stats */}
                      <div style={{padding:"12px 16px"}}>
                        <div style={{display:"flex", gap:12, marginBottom:10}}>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:20, fontWeight:800, color:C.text}}>{counted}</div>
                            <div style={{fontSize:11, color:C.text3}}>contados</div>
                          </div>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:20, fontWeight:800, color:changed>0?C.red:C.green}}>{changed}</div>
                            <div style={{fontSize:11, color:C.text3}}>diferencias</div>
                          </div>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:20, fontWeight:800, color:C.text}}>{total}</div>
                            <div style={{fontSize:11, color:C.text3}}>total</div>
                          </div>
                        </div>
                        {/* Items with differences */}
                        {(inv.items||[]).filter(i=>i.diff!==null&&i.diff!==0).map(item=>(
                          <div key={item.productId} style={{display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderTop:`1px solid ${C.border}`, fontSize:13}}>
                            <span style={{color:C.text, fontWeight:500}}>{item.name}</span>
                            <span style={{fontWeight:700, color:item.diff>0?C.green:C.red}}>
                              {item.diff>0?"+":""}{item.diff} {item.unit}
                            </span>
                          </div>
                        ))}
                        {u && <div style={{fontSize:12, color:C.text3, marginTop:8}}>✍️ {u.name}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── HISTORIAL ── */}
        {tab==="history"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <button onClick={()=>exportXLS({restaurants,products,transfers,history,categories:cats,users,inventories})} style={{ ...B("green"), width:"100%", fontSize:14 }}>Exportar Excel completo</button>
            {history.length===0
              ?<div style={{ textAlign:"center", padding:"60px 0", color:C.text3 }}>
                <div style={{ fontSize:48, marginBottom:10 }}>📋</div>
                <div style={{ fontWeight:600, fontSize:16, color:C.text2 }}>Sin eventos registrados</div>
              </div>
              :<div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {[...history].sort((a,b)=>{
                  const da = (a.date||"")+(a.time||"");
                  const db2 = (b.date||"")+(b.time||"");
                  return db2.localeCompare(da);
                }).map((h,i)=>{
                  const p=pmap[h.productId], rest=rmap[h.restaurantId], u=umap[h.userId];
                  const TI={
                    created:     {i:"✨",c:C.green,    bg:C.greenBg, l:"Elaboración"},
                    edited:      {i:"✏️",c:C.blue,     bg:C.blueBg,  l:"Edición"},
                    transferred: {i:"⇄", c:"#5B3D8F",  bg:"#F3EEF8", l:"Transferencia"},
                    scanned:     {i:"📷",c:C.amber,    bg:C.amberBg, l:"Escaneo"},
                    inventory:   {i:"📦",c:"#0891b2",  bg:"#E0F2FE", l:"Inventario"},
                  };
                  const t=TI[h.type]||{i:"•",c:C.text2,bg:C.surface2,l:h.type};
                  return(
                    <div key={h.id} style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                      {/* Timeline dot */}
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
                        <div style={{ width:38, height:38, background:t.bg, borderRadius:11, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, border:`1.5px solid ${t.c}33` }}>{t.i}</div>
                        {i<history.length-1&&<div style={{ width:2, flex:1, minHeight:12, background:C.border, margin:"4px 0" }}/>}
                      </div>
                      {/* Content */}
                      <div style={{ flex:1, background:C.surface, borderRadius:14, padding:"12px 14px", border:`1px solid ${C.border}`, marginBottom:4 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                          <div>
                            <span style={{ fontWeight:700, fontSize:13, color:t.c }}>{t.l}</span>
                            <div style={{ fontWeight:600, fontSize:14, color:C.text, marginTop:2 }}>{h.productName||p?.name||"—"}</div>
                          </div>
                          <div style={{ textAlign:"right", flexShrink:0, marginLeft:8 }}>
                            <div style={{ fontSize:11, color:C.text3 }}>{fmt(h.date)}</div>
                            {h.time&&<div style={{ fontSize:11, color:C.text3 }}>{h.time}</div>}
                          </div>
                        </div>
                        {h.detail&&<div style={{ fontSize:12, color:C.text2, marginTop:4 }}>{h.detail}</div>}
                        <div style={{ display:"flex", gap:10, marginTop:6, flexWrap:"wrap" }}>
                          {rest&&<span style={{ fontSize:11, color:C.text3 }}>📍 {rest.name}</span>}
                          {u&&<span style={{ fontSize:11, color:C.accent }}>✍️ {u.name}</span>}
                        </div>
                      </div>
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
            <div style={{ background:C.surface, borderRadius:14, border:`1px solid ${C.border}`, overflow:"hidden" }}>
              <div style={{ background:C.dark, padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div><div style={{ fontWeight:800, fontSize:14, color:"#fff" }}>Usuarios</div><div style={{ fontSize:11, color:C.text3, marginTop:2 }}>{users.length} usuarios · Firman elaboraciones y transferencias</div></div>
                <button onClick={()=>{setSel(null);setModal("user");}} style={{ ...B("orange"), fontSize:12, padding:"5px 12px" }}>+ Nuevo</button>
              </div>
              <div style={{ padding:14, display:"grid", gap:7 }}>
                {users.map(u=>(
                  <div key={u.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 10px", borderRadius:9, border:`1px solid ${C.border}`, background:C.surface2 }}>
                    <div style={{ width:36, height:36, borderRadius:"50%", background:"#1e293b", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, fontWeight:800, color:"#fff", flexShrink:0 }}>{u.name.charAt(0).toUpperCase()}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:13 }}>{u.name}</div>
                      <div style={{ fontSize:11, color:C.text3 }}>{u.role||"Sin rol"}{u.restaurantId?` · ${restaurants.find(r=>r.id===u.restaurantId)?.name||""}`:""}</div>
                    </div>
                    <div style={{ display:"flex", gap:5 }}>
                      <button onClick={()=>{setSel(u);setModal("user");}} style={{ ...B("ghost"), padding:"5px 9px", fontSize:12 }}>✏️</button>
                      <button onClick={()=>{showConfirm(`¿Eliminar usuario "${u.name}"?`, ()=>deleteUser(u.id));}} style={{ ...B("red"), padding:"5px 9px", fontSize:12 }}>🗑</button>
                    </div>
                  </div>
                ))}
                {users.length===0&&<div style={{ textAlign:"center", padding:"16px 0", color:C.text3, fontSize:13 }}>Sin usuarios — crea el primero</div>}
              </div>
            </div>

            {/* Categorías */}
            <div style={{ background:C.surface, borderRadius:14, border:`1px solid ${C.border}`, overflow:"hidden" }}>
              <div style={{ background:C.dark, padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div><div style={{ fontWeight:800, fontSize:14, color:"#fff" }}>Categorías</div><div style={{ fontSize:11, color:C.text3, marginTop:2 }}>{cats.length} categorías</div></div>
                <button onClick={()=>{setSel(null);setModal("category");}} style={{ ...B("orange"), fontSize:12, padding:"5px 12px" }}>+ Nueva</button>
              </div>
              <div style={{ padding:14, display:"grid", gap:6 }}>
                {cats.map(c=>{const cnt=products.filter(p=>p.category===c.id).length;return(
                  <div key={c.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:C.surface2 }}>
                    <span style={{ fontSize:20 }}>{c.icon}</span>
                    <div style={{ flex:1 }}><div style={{ fontWeight:600, fontSize:13 }}>{c.label}</div><div style={{ fontSize:11, color:C.text3 }}>{cnt} productos</div></div>
                    <button onClick={()=>{setSel(c);setModal("category");}} style={{ ...B("ghost"), padding:"4px 8px", fontSize:12 }}>✏️</button>
                    <button onClick={()=>{if(cats.length<=1)return;showConfirm(`¿Eliminar categoría "${c.label}"?`, ()=>deleteCategory(c.id));}} style={{ ...B("red"), padding:"4px 8px", fontSize:12 }} disabled={cats.length<=1}>🗑</button>
                  </div>
                );})}
              </div>
            </div>

            {/* Catalogo de plantillas */}
            <div style={{ background:C.surface, borderRadius:14, border:`1px solid ${C.border}`, overflow:"hidden" }}>
              <div style={{ background:C.dark, padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div><div style={{ fontWeight:800, fontSize:14, color:"#fff" }}>Catálogo de productos</div><div style={{ fontSize:11, color:C.text3, marginTop:2 }}>{catalog.length} plantillas</div></div>
                <button onClick={()=>{setSel(null);setModal("catalog");}} style={{ ...B("orange"), fontSize:12, padding:"5px 12px" }}>+ Nueva</button>
              </div>
              <div style={{ padding:14, display:"grid", gap:7 }}>
                {catalog.length===0 ? (
                  <div style={{ textAlign:"center", padding:"16px 0", color:C.text3, fontSize:13 }}>Sin plantillas — crea la primera para elaborar productos rapidamente</div>
                ) : catalog.map(tpl => {
                  const cat = cats.find(c => c.id === tpl.category);
                  return (
                    <div key={tpl.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"9px 12px", borderRadius:9, border:`1px solid ${C.border}`, background:C.surface2 }}>
                      <div style={{ width:38, height:38, borderRadius:9, background:"#f1f5f9", border:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{cat?.icon||"📦"}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:700, fontSize:13 }}>{tpl.name}</div>
                        <div style={{ fontSize:11, color:C.text3 }}>{cat?.label||"—"} · {tpl.unit} · {tpl.defaultDays}d caducidad{tpl.notes ? " · "+tpl.notes.slice(0,20) : ""}</div>
                      </div>
                      <div style={{ display:"flex", gap:5 }}>
                        <button onClick={()=>{setSel(tpl);setModal("catalog");}} style={{ ...B("ghost"), padding:"5px 9px", fontSize:12 }}>✏️</button>
                        <button onClick={()=>{showConfirm(`¿Eliminar plantilla "${tpl.name}"?`, ()=>deleteCatalogItem(tpl.id));}} style={{ ...B("red"), padding:"5px 9px", fontSize:12 }}>🗑</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Export */}
            <div style={{ background:C.surface, borderRadius:12, border:`1px solid ${C.border}`, padding:16 }}>
              <div style={{ fontWeight:700, fontSize:14, marginBottom:6 }}>📊 Exportar datos</div>
              <p style={{ fontSize:13, color:C.text2, marginBottom:10 }}>Excel completo: Locales, Productos, Transferencias (con firmas) e Historial.</p>
              <button onClick={()=>exportXLS({restaurants,products,transfers,history,categories:cats,users,inventories})} style={{ ...B("green"), width:"100%" }}>Descargar Excel</button>
            </div>
          </div>
        )}

      </div>

      {/* Modals */}
      {modal==="user"&&<UserModal user={sel?.role!==undefined?sel:null} restaurants={restaurants} onClose={()=>{setModal(null);setSel(null);}} onSave={saveUser} onDelete={deleteUser}/>}
      {modal==="catalog"&&<CatalogModal item={sel?.defaultDays!==undefined?sel:null} categories={cats} onClose={()=>{setModal(null);setSel(null);}} onSave={saveCatalogItem}/>}
      {modal==="category"&&<div style={OVR} onClick={()=>setModal(null)}><div style={{ ...MDL, maxWidth:420 }} onClick={e=>e.stopPropagation()}><div style={MHDR}><span style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", color:C.text3 }}>{sel?"Editar categoría":"Nueva categoría"}</span><button onClick={()=>setModal(null)} style={CBTN}>✕</button></div><CategoryForm cat={sel} cats={cats} onSave={saveCategory} onDelete={sel?deleteCategory:null} onClose={()=>setModal(null)}/></div></div>}
      {modal==="restaurant"&&<RestaurantModal restaurant={sel?.cif!==undefined?sel:null} onClose={()=>{setModal(null);setSel(null);}} onSave={saveRestaurant} onDelete={deleteRestaurant} productCount={sel?products.filter(p=>p.restaurantId===sel.id).length:0}/>}
      {modal==="product"&&<ProductModal product={sel?.elaboration?sel:null} restaurants={restaurants} categories={cats} catalog={catalog} currentUser={currentUser} onClose={()=>{setModal(null);setSel(null);}} onSave={saveProduct}/>}
      {modal==="label"&&sel&&<LabelModal product={sel} restaurants={restaurants} categories={cats} users={users} onClose={()=>{setModal(null);setSel(null);}}/>}
      {modal==="transfer"&&<TransferModal products={products} restaurants={restaurants} currentUser={currentUser} onClose={()=>setModal(null)} onSave={saveTransfer}/>}
      {toast&&<Toast message={toast.message} type={toast.type} onDone={()=>setToast(null)}/>}
      {confirm&&<ConfirmDialog message={confirm.message} confirmLabel={confirm.label} onConfirm={()=>{confirm.onConfirm();setConfirm(null);}} onCancel={()=>setConfirm(null)}/>}
      {modal==="inventory"&&<InventoryModal restaurants={restaurants} categories={cats} products={products} currentUser={currentUser} onClose={()=>setModal(null)} onSave={saveInventory}/>}
      {modal==="scanner"&&<ScannerModal onClose={()=>setModal(null)} products={products} restaurants={restaurants} users={users} currentUser={currentUser} onSaveTransfer={saveTransfer}/>}
    </div>
  );
}


// ── CATALOG ITEM MODAL ────────────────────────────────────────────────────────
function CatalogModal({ item, categories, onClose, onSave }) {
  const isNew = !item;
  const [f, setF]           = useState(item || { name:"", category:categories[0]?.id||"otros", unit:"kg", defaultDays:7, notes:"", supplierBarcode:"" });
  const [daysStr, setDaysStr] = useState(String(item?.defaultDays ?? 7));
  const [catOpen, setCatOpen] = useState(false);
  const [customUnit, setCustomUnit] = useState("");
  const [addingUnit, setAddingUnit] = useState(false);
  const [units, setUnits]   = useState(() => {
    const saved = localStorage.getItem("trazapro_units");
    const extra = saved ? JSON.parse(saved) : [];
    return [...DEFAULT_UNITS, ...extra.filter(u => !DEFAULT_UNITS.includes(u))];
  });
  const [scanning, setScanning]   = useState(false);
  const [scanErr, setScanErr]     = useState(null);
  const [processing, setProcessing] = useState(false);
  const scanFileRef = useRef(null);
  const curCat = categories.find(c => c.id === f.category);

  function addCustomUnit() {
    const u = customUnit.trim();
    if (!u || units.includes(u)) return;
    const newUnits = [...units, u];
    setUnits(newUnits);
    const saved = JSON.parse(localStorage.getItem("trazapro_units")||"[]");
    localStorage.setItem("trazapro_units", JSON.stringify([...saved, u]));
    setF({...f, unit:u});
    setCustomUnit("");
    setAddingUnit(false);
  }

  // Decode supplier QR or barcode from photo
  async function handleScanFile(e) {
    const file = e.target.files?.[0]; if(!file) return;
    setScanErr(null); setProcessing(true);
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const scales = [0.5, 0.25, 1.0, 0.15];
        for (const scale of scales) {
          const w = Math.round(img.width*scale), h = Math.round(img.height*scale);
          const cv = document.createElement("canvas"); cv.width=w; cv.height=h;
          const ctx = cv.getContext("2d");
          for (const filter of ["none","contrast(2)","grayscale(1) contrast(2)"]) {
            ctx.filter=filter; ctx.drawImage(img,0,0,w,h);
            const id = ctx.getImageData(0,0,w,h);
            const r = jsQR(id.data,w,h,{inversionAttempts:"attemptBoth"});
            if (r) {
              setProcessing(false);
              // Try to extract product name from QR data
              let name = "";
              try { const parsed = JSON.parse(r.data); name = parsed.name||parsed.product||parsed.description||""; } catch {}
              if (!name) name = r.data.slice(0,60);
              setF(prev => ({...prev, supplierBarcode: r.data, name: prev.name || name}));
              setScanning(false);
              return;
            }
          }
        }
        setProcessing(false);
        setScanErr("No se pudo leer el codigo. Intenta mas cerca con buena luz.");
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  return (
    <div style={OVR} onClick={onClose}>
      <div style={{ ...MDL, maxWidth:480, maxHeight:"92vh", overflowY:"auto" }} onClick={e => e.stopPropagation()}>
        <div style={MHDR}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:C.text3 }}>{isNew ? "Nueva plantilla" : "Editar plantilla"}</div>
            {!isNew && <div style={{ fontWeight:800, fontSize:15, marginTop:1, color:C.text }}>{f.name}</div>}
          </div>
          <button onClick={onClose} style={CBTN}>✕</button>
        </div>

        <div style={{ marginTop:16, display:"flex", flexDirection:"column", gap:14 }}>

          {/* Supplier QR/barcode scanner */}
          <div style={{ background:C.accentBg, borderRadius:14, padding:14, border:`1px solid ${C.accent}33` }}>
            <div style={{ fontWeight:700, fontSize:13, color:C.accent, marginBottom:6 }}>📦 Escanear etiqueta del proveedor</div>
            <div style={{ fontSize:12, color:C.text2, marginBottom:10 }}>Fotografía el QR o código de barras de la etiqueta original para crear la plantilla automáticamente.</div>
            {scanErr && <div style={{ fontSize:12, color:C.red, background:C.redBg, borderRadius:8, padding:"8px 10px", marginBottom:8 }}>{scanErr}</div>}
            {f.supplierBarcode && (
              <div style={{ fontSize:11, color:C.text2, background:C.surface2, borderRadius:8, padding:"6px 10px", marginBottom:8, wordBreak:"break-all" }}>
                ✓ Codigo escaneado: <span style={{ color:C.text, fontWeight:600 }}>{f.supplierBarcode.slice(0,50)}{f.supplierBarcode.length>50?"...":""}</span>
                <button onClick={()=>setF({...f,supplierBarcode:""})} style={{ marginLeft:8, background:"none", border:"none", cursor:"pointer", color:C.red, fontSize:11 }}>✕ Borrar</button>
              </div>
            )}
            <input ref={scanFileRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={handleScanFile}/>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>scanFileRef.current?.click()} disabled={processing}
                style={{ ...B("orange"), flex:1, fontSize:13, padding:"11px 14px", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                {processing ? "Procesando..." : "📷 Abrir cámara"}
              </button>
              <input type="file" accept="image/*" style={{ display:"none" }} id="catScanGallery" onChange={handleScanFile}/>
              <label htmlFor="catScanGallery" style={{ ...B("ghost"), fontSize:13, padding:"11px 14px", cursor:"pointer" }}>🖼</label>
            </div>
          </div>

          {/* Category picker */}
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:C.text2, marginBottom:6 }}>Categoría</div>
            {!catOpen
              ? <button onClick={() => setCatOpen(true)} style={{ ...B("ghost"), width:"100%", textAlign:"left", display:"flex", alignItems:"center", gap:8 }}>{curCat?.icon||"📦"} {curCat?.label||"Seleccionar..."}<span style={{ marginLeft:"auto", color:C.text3 }}>▾</span></button>
              : <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, maxHeight:200, overflowY:"auto" }}>
                  {categories.map(c => <button key={c.id} onClick={() => { setF({...f, category:c.id}); setCatOpen(false); }} style={{ ...B(f.category===c.id?"primary":"ghost"), textAlign:"left", padding:"10px 12px", fontSize:13, display:"flex", alignItems:"center", gap:6 }}>{c.icon} {c.label}</button>)}
                </div>
            }
          </div>

          {/* Name */}
          <label style={LBL}>Nombre del producto *<input style={INP} value={f.name} onChange={e => setF({...f, name:e.target.value})} placeholder="Ej: Caldo de pollo"/></label>

          {/* Unit + days */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div>
              <label style={LBL}>Unidad
                <select style={INP} value={f.unit} onChange={e => { if(e.target.value==="__new__") setAddingUnit(true); else setF({...f, unit:e.target.value}); }}>
                  {units.map(u => <option key={u} value={u}>{u}</option>)}
                  <option value="__new__">+ Nueva unidad...</option>
                </select>
              </label>
              {addingUnit && (
                <div style={{ display:"flex", gap:6, marginTop:6 }}>
                  <input style={{ ...INP, flex:1, padding:"8px 10px", fontSize:13 }} value={customUnit} onChange={e=>setCustomUnit(e.target.value)} placeholder="Ej: pallets" autoFocus onKeyDown={e=>e.key==="Enter"&&addCustomUnit()}/>
                  <button onClick={addCustomUnit} style={{ ...B("orange"), padding:"8px 12px", fontSize:13 }}>+</button>
                  <button onClick={()=>{setAddingUnit(false);setCustomUnit("");}} style={{ ...B("ghost"), padding:"8px 10px", fontSize:13 }}>✕</button>
                </div>
              )}
            </div>
            <label style={LBL}>
              Días caducidad por defecto
              <input style={INP} type="number" min="1" max="365" value={daysStr} onChange={e => { setDaysStr(e.target.value); const n=parseInt(e.target.value); if(!isNaN(n)&&n>0) setF({...f,defaultDays:n}); }} placeholder="7"/>
            </label>
          </div>

          {/* Notes */}
          <label style={LBL}>Notas / Alérgenos<textarea style={{ ...INP, resize:"vertical", height:56 }} value={f.notes} onChange={e => setF({...f, notes:e.target.value})} placeholder="Alérgenos, ingredientes habituales..."/></label>

          <div style={{ background:C.surface2, borderRadius:10, padding:"10px 12px", fontSize:12, color:C.text2 }}>
            💡 La fecha de caducidad se calculará automáticamente al registrar cada elaboración
          </div>

          <button
            onClick={() => {
              if(!f.name.trim()) return;
              onSave({...f, defaultDays:parseInt(daysStr)||f.defaultDays||7, id:f.id||("c"+Date.now().toString(36)), name:f.name.trim()});
              onClose();
            }}
            style={{ ...B("primary"), width:"100%" }} disabled={!f.name.trim()}>
            {isNew ? "Crear plantilla" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Category inline form ──────────────────────────────────────────────────────
const EMOJI_LIST = ["🍲","🥣","🥩","🐟","🥦","🍝","🍰","🍞","🫙","🧆","🥤","📦","🥗","🫕","🍜","🥘","🍱","🥚","🧀","🥓","🌮","🍔","🍕","🥙","🧁","🍩","🍪","🎂","🍦","🥛","☕","🫖","🍵","🧃","🌿","🧄","🧅","🥕","🌽","🍅","🫑","🥑","🌾","🧂"];

function CategoryForm({ cat, cats, onSave, onDelete, onClose }) {
  const [icon, setIcon]     = useState(cat?.icon||"📦");
  const [label, setLabel]   = useState(cat?.label||"");
  const [showEmoji, setShowEmoji] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <div style={{ marginTop:16, display:"flex", flexDirection:"column", gap:14 }}>
      <div>
        <div style={{ fontSize:13, fontWeight:600, color:C.text2, marginBottom:8 }}>Icono</div>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
          <div style={{ width:52, height:52, borderRadius:14, background:C.surface2, border:`2px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:28 }}>{icon}</div>
          <div style={{ flex:1 }}>
            <input style={{ ...INP, fontSize:20, textAlign:"center", borderRadius:12 }} value={icon} onChange={e=>setIcon(e.target.value)} placeholder="📦" maxLength={4}/>
          </div>
        </div>
        <button onClick={()=>setShowEmoji(v=>!v)} style={{ ...B("ghost"), fontSize:13, width:"100%" }}>{showEmoji?"Ocultar sugerencias":"Ver emojis sugeridos"}</button>
        {showEmoji&&(
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:10, background:C.surface2, borderRadius:12, padding:10 }}>
            {EMOJI_LIST.map(e=>(
              <button key={e} onClick={()=>{setIcon(e);setShowEmoji(false);}}
                style={{ width:38, height:38, borderRadius:9, border:icon===e?`2px solid ${C.accent}`:`1px solid ${C.border}`, background:icon===e?C.accentBg:C.surface, cursor:"pointer", fontSize:20 }}>{e}</button>
            ))}
          </div>
        )}
      </div>
      <label style={LBL}>Nombre *<input style={INP} value={label} onChange={e=>setLabel(e.target.value)} placeholder="Ej: Fondos y caldos" autoFocus/></label>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={()=>{if(!label.trim())return;onSave({id:cat?.id||uid(),icon,label:label.trim()});onClose();}} style={{ ...B("primary"), flex:1 }} disabled={!label.trim()}>{cat?"Guardar cambios":"Crear categoría"}</button>
        {onDelete && !confirmDel && (
          <button onClick={()=>setConfirmDel(true)} style={{ ...B("red"), flexShrink:0, padding:"14px 16px" }}>🗑</button>
        )}
        {onDelete && confirmDel && (
          <div style={{ display:"flex", gap:6, flex:1 }}>
            <button onClick={async ()=>{ if(cats.length<=1){showToast("Debe quedar al menos una categoría", "warning"); return;} await onDelete(cat.id); onClose(); }} style={{ ...B("red"), flex:1 }}>Sí, eliminar</button>
            <button onClick={()=>setConfirmDel(false)} style={{ ...B("ghost"), flex:1 }}>No</button>
          </div>
        )}
      </div>
      {onDelete&&<div style={{ fontSize:12, color:C.text3, textAlign:"center" }}>Los productos de esta categoría pasarán a la primera disponible</div>}
    </div>
  );
}
