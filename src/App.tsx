import { useState, useEffect, useCallback, useRef } from "react";

const SUPABASE_URL = "https://mbvmnwulfllfgxivlerw.supabase.co";
const SUPABASE_KEY = "sb_publishable_M5CMfYarPj6rsWCtsZMbDw_pWMZY25W";
const POLL_MS = 5000;
const PIN_TS_KEY = "grocery_pin_ts";
const PIN_ATTEMPTS_KEY = "grocery_pin_attempts";
const PIN_LOCKOUT_KEY = "grocery_pin_lockout";
const USER_KEY = "grocery_user";
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 10 * 60 * 1000;
const PIN_KEY_DB = "app_pin";
const USERS = ["Amrit", "Moumita"];

const STORES = [
  { id:"lidl",   name:"Lidl",   color:"#1D4ED8", light:"#DBEAFE", emoji:"🔵", type:"general" },
  { id:"tesco",  name:"Tesco",  color:"#1E40AF", light:"#EFF6FF", emoji:"🛍️", type:"general" },
  { id:"asda",   name:"Asda",   color:"#15803D", light:"#DCFCE7", emoji:"🟢", type:"general" },
  { id:"sai",    name:"Sai",    color:"#B45309", light:"#FEF3C7", emoji:"🌶️", type:"indian"  },
  { id:"sujash", name:"Sujash", color:"#7C3AED", light:"#EDE9FE", emoji:"🪷", type:"indian"  },
  { id:"misc",   name:"Misc",   color:"#374151", light:"#F3F4F6", emoji:"🏪", type:"misc"    },
];
const UNITS = ["item(s)","litre(s)","kg","g","dozen","box(es)","pack(s)","bag(s)","bottle(s)","can(s)","loaf/loaves","bunch(es)"];
const RANGES = ["Last 4 weeks","Last 3 months","Last 6 months","Last year","All time"];

const genId    = () => Math.random().toString(36).slice(2,9);
const todayStr = () => new Date().toISOString().slice(0,10);
const weekKey  = () => {
  const d=new Date(), j=new Date(d.getFullYear(),0,1);
  return `${d.getFullYear()}-W${String(Math.ceil(((d.getTime()-j.getTime())/864e5+j.getDay()+1)/7)).padStart(2,"0")}`;
};
const storeColor = (id:string) => STORES.find(x=>x.id===id)?.color||"#374151";
const storeBg    = (id:string) => STORES.find(x=>x.id===id)?.light||"#F3F4F6";
const storeEmoji = (id:string) => STORES.find(x=>x.id===id)?.emoji||"🏪";
const fmtGBP     = (n:number) => `£${n.toFixed(2)}`;

const hdrs = {"Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":`Bearer ${SUPABASE_KEY}`};

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function kvGet(key:string) {
  try {
    const r=await fetch(`${SUPABASE_URL}/rest/v1/grocery_store?key=eq.${key}&select=value,updated_at`,{headers:hdrs});
    if(!r.ok) return null;
    const rows=await r.json();
    return rows.length?{data:JSON.parse(rows[0].value),ts:rows[0].updated_at}:null;
  } catch{return null;}
}
async function kvSet(key:string,value:any) {
  try{
    await fetch(`${SUPABASE_URL}/rest/v1/grocery_store`,{method:"POST",headers:{...hdrs,"Prefer":"resolution=merge-duplicates"},body:JSON.stringify({key,value:JSON.stringify(value),updated_at:new Date().toISOString()})});
  }catch{}
}
async function kvGetTs(key:string) {
  try{
    const r=await fetch(`${SUPABASE_URL}/rest/v1/grocery_store?key=eq.${key}&select=updated_at`,{headers:hdrs});
    if(!r.ok) return null;
    const rows=await r.json();
    return rows.length?rows[0].updated_at:null;
  }catch{return null;}
}

// spend_history table
async function insertSpend(records:any[]) {
  if(!records.length) return;
  try{ await fetch(`${SUPABASE_URL}/rest/v1/spend_history`,{method:"POST",headers:{...hdrs,"Prefer":"return=minimal"},body:JSON.stringify(records)}); }catch{}
}
async function getSpend(fromDate:string) {
  try{
    const r=await fetch(`${SUPABASE_URL}/rest/v1/spend_history?date=gte.${fromDate}&select=*&order=date.asc`,{headers:hdrs});
    if(!r.ok) return [];
    return await r.json();
  }catch{return [];}
}

// weekly_lists table
async function saveWeeklyList(week:string,date:string,items:any[]) {
  try{ await fetch(`${SUPABASE_URL}/rest/v1/weekly_lists`,{method:"POST",headers:{...hdrs,"Prefer":"resolution=merge-duplicates"},body:JSON.stringify({week,date,items})}); }catch{}
}
async function getWeeklyLists() {
  try{
    const r=await fetch(`${SUPABASE_URL}/rest/v1/weekly_lists?select=*&order=date.desc`,{headers:hdrs});
    if(!r.ok) return [];
    return await r.json();
  }catch{return [];}
}
async function deleteWeeklyList(week:string) {
  try{ await fetch(`${SUPABASE_URL}/rest/v1/weekly_lists?week=eq.${encodeURIComponent(week)}`,{method:"DELETE",headers:hdrs}); }catch{}
}

// store_budgets table
async function getBudgets() {
  try{
    const r=await fetch(`${SUPABASE_URL}/rest/v1/store_budgets?select=*`,{headers:hdrs});
    if(!r.ok) return {};
    const rows=await r.json();
    const out:any={};
    rows.forEach((r:any)=>{out[r.store_id]=r.budget;});
    return out;
  }catch{return {};}
}
async function saveBudget(storeId:string,budget:number) {
  try{ await fetch(`${SUPABASE_URL}/rest/v1/store_budgets`,{method:"POST",headers:{...hdrs,"Prefer":"resolution=merge-duplicates"},body:JSON.stringify({store_id:storeId,budget,updated_at:new Date().toISOString()})}); }catch{}
}

const ITEMS_KEY="family_items", HISTORY_KEY="family_history", RECURRING_KEY="family_recurring";

// ── PIN + User Screen ─────────────────────────────────────────────────────────
function PinScreen({onUnlock}:{onUnlock:(user:string)=>void}) {
  const [pin,setPin]=useState("");
  const [error,setError]=useState("");
  const [shake,setShake]=useState(false);
  const [loading,setLoading]=useState(false);
  const [step,setStep]=useState<"pin"|"user">("pin");
  const [lockout,setLockout]=useState(()=>{
    const l=localStorage.getItem(PIN_LOCKOUT_KEY);
    return l?Math.max(0,parseInt(l)-Date.now()):0;
  });
  useEffect(()=>{
    if(lockout<=0)return;
    const t=setInterval(()=>setLockout(l=>Math.max(0,l-1000)),1000);
    return()=>clearInterval(t);
  },[lockout]);

  const submitPin=async()=>{
    if(loading||lockout>0)return;
    setLoading(true);
    try{
      const res=await kvGet(PIN_KEY_DB);
      const correct=res?res.data:"1234";
      if(pin===correct){
        localStorage.setItem(PIN_TS_KEY,Date.now().toString());
        localStorage.removeItem(PIN_ATTEMPTS_KEY);
        localStorage.removeItem(PIN_LOCKOUT_KEY);
        setStep("user");
      } else {
        const attempts=(parseInt(localStorage.getItem(PIN_ATTEMPTS_KEY)||"0"))+1;
        localStorage.setItem(PIN_ATTEMPTS_KEY,String(attempts));
        if(attempts>=MAX_ATTEMPTS){
          const lockUntil=Date.now()+LOCKOUT_MS;
          localStorage.setItem(PIN_LOCKOUT_KEY,String(lockUntil));
          localStorage.removeItem(PIN_ATTEMPTS_KEY);
          setLockout(LOCKOUT_MS);
          setError("Too many attempts. Locked for 10 minutes.");
        } else {
          setError(`Incorrect code. ${MAX_ATTEMPTS-attempts} attempt${MAX_ATTEMPTS-attempts===1?"":"s"} remaining.`);
        }
        setShake(true);setPin("");
        setTimeout(()=>setShake(false),600);
      }
    }catch{setError("Connection error. Please try again.");}
    setLoading(false);
  };

  const mins=Math.ceil(lockout/60000);

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%)",padding:"1rem"}}>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}`}</style>
      <div style={{background:"white",borderRadius:24,padding:"2.5rem 2rem",width:"100%",maxWidth:360,boxShadow:"0 20px 60px rgba(0,0,0,0.2)",textAlign:"center",animation:shake?"shake 0.4s ease":"none"}}>
        <div style={{width:72,height:72,borderRadius:"50%",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 1.2rem",fontSize:32}}>🛒</div>
        <div style={{fontSize:22,fontWeight:700,color:"#111827",marginBottom:4}}>Family Groceries</div>

        {step==="pin"?(
          <>
            <div style={{fontSize:14,color:"#6B7280",marginBottom:"1.8rem"}}>Enter your access code</div>
            {lockout>0?(
              <div style={{background:"#FEF2F2",border:"1.5px solid #FCA5A5",borderRadius:12,padding:"1rem",color:"#EF4444",fontSize:14}}>
                🔒 Too many failed attempts<br/>
                <span style={{fontWeight:700}}>Try again in {mins} minute{mins===1?"":"s"}</span>
              </div>
            ):(
              <>
                <input type="password" placeholder="PIN or passphrase"
                  value={pin} onChange={e=>{setPin(e.target.value);setError("");}}
                  onKeyDown={e=>e.key==="Enter"&&submitPin()}
                  style={{width:"100%",padding:"14px",borderRadius:12,border:`2px solid ${error?"#EF4444":"#E5E7EB"}`,fontSize:16,textAlign:"center",outline:"none",boxSizing:"border-box",marginBottom:error?8:16}}
                  autoFocus disabled={loading}/>
                {error&&<div style={{color:"#EF4444",fontSize:13,marginBottom:12,padding:"8px",background:"#FEF2F2",borderRadius:8}}>{error}</div>}
                <button onClick={submitPin} disabled={loading} style={{width:"100%",padding:"14px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",color:"white",fontSize:16,fontWeight:600,cursor:loading?"wait":"pointer",opacity:loading?0.8:1}}>
                  {loading?"Checking…":"Unlock"}
                </button>
              </>
            )}
          </>
        ):(
          <>
            <div style={{fontSize:14,color:"#6B7280",marginBottom:"1.5rem"}}>Who's shopping today?</div>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {USERS.map(u=>(
                <button key={u} onClick={()=>{localStorage.setItem(USER_KEY,u);onUnlock(u);}}
                  style={{padding:"14px",borderRadius:12,border:"2px solid #E5E7EB",background:"white",fontSize:16,fontWeight:600,cursor:"pointer",transition:"all 0.2s"}}>
                  {u==="Amrit"?"👨":"👩"} {u}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Change PIN Modal ──────────────────────────────────────────────────────────
function ChangePinModal({onClose}:{onClose:()=>void}) {
  const [f,setF]=useState({current:"",next:"",confirm:""});
  const [msg,setMsg]=useState<{text:string,ok:boolean}|null>(null);
  const [loading,setLoading]=useState(false);
  const handle=async()=>{
    setLoading(true);
    try{
      const res=await kvGet(PIN_KEY_DB);
      const correct=res?res.data:"1234";
      if(f.current!==correct){setMsg({text:"Current PIN is incorrect",ok:false});setLoading(false);return;}
      if(f.next.length<4){setMsg({text:"New PIN must be at least 4 characters",ok:false});setLoading(false);return;}
      if(f.next!==f.confirm){setMsg({text:"New PINs don't match",ok:false});setLoading(false);return;}
      await kvSet(PIN_KEY_DB,f.next);
      localStorage.setItem(PIN_TS_KEY,Date.now().toString());
      setMsg({text:"PIN changed on all devices! ✓",ok:true});
      setTimeout(onClose,1500);
    }catch{setMsg({text:"Connection error. Try again.",ok:false});}
    setLoading(false);
  };
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:"1rem",backdropFilter:"blur(4px)"}}>
      <div style={{background:"white",borderRadius:20,padding:"1.5rem",width:"100%",maxWidth:340,boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
        <div style={{fontSize:18,fontWeight:700,marginBottom:"1.2rem"}}>🔐 Change PIN</div>
        <div style={{fontSize:12,color:"#6B7280",background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:8,padding:"8px 12px",marginBottom:14}}>✓ PIN updates on all devices instantly</div>
        {(["current","next","confirm"] as const).map((key,i)=>(
          <div key={key} style={{marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:500,color:"#374151",marginBottom:5}}>{["Current PIN","New PIN","Confirm new PIN"][i]}</div>
            <input type="password" placeholder={["Enter current PIN","Min 4 characters","Re-enter new PIN"][i]}
              value={f[key]} onChange={e=>setF(p=>({...p,[key]:e.target.value}))}
              style={{width:"100%",padding:"11px 14px",borderRadius:10,border:"1.5px solid #E5E7EB",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
          </div>
        ))}
        {msg&&<div style={{fontSize:13,color:msg.ok?"#10B981":"#EF4444",marginBottom:12,padding:"8px 12px",borderRadius:8,background:msg.ok?"#ECFDF5":"#FEF2F2"}}>{msg.text}</div>}
        <div style={{display:"flex",gap:8}}>
          <button onClick={onClose} style={{flex:1,padding:"11px",borderRadius:10,border:"1.5px solid #E5E7EB",background:"none",cursor:"pointer",fontWeight:500}}>Cancel</button>
          <button onClick={handle} disabled={loading} style={{flex:2,padding:"11px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",color:"white",cursor:loading?"wait":"pointer",fontWeight:600,opacity:loading?0.8:1}}>
            {loading?"Saving…":"Change PIN"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Copy Previous Week Modal ──────────────────────────────────────────────────
function CopyWeekModal({lists,onCopy,onClose}:{lists:any[],onCopy:(items:any[])=>void,onClose:()=>void}) {
  const [selected,setSelected]=useState(0);
  const [checked,setChecked]=useState<Set<string>>(new Set());
  useEffect(()=>{
    if(lists[selected]) setChecked(new Set(lists[selected].items.map((i:any)=>i.id)));
  },[selected,lists]);
  if(!lists.length) return null;
  const items=lists[selected]?.items||[];
  const toggle=(id:string)=>setChecked(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
  const handleCopy=()=>{
    const selected_items=items.filter((i:any)=>checked.has(i.id)).map((i:any)=>({...i,id:genId(),done:false,date:todayStr()}));
    onCopy(selected_items);
  };
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:"1rem",backdropFilter:"blur(4px)"}}>
      <div style={{background:"white",borderRadius:20,padding:"1.5rem",width:"100%",maxWidth:420,maxHeight:"80vh",display:"flex",flexDirection:"column",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
        <div style={{fontSize:18,fontWeight:700,marginBottom:12}}>📋 Copy previous list</div>
        <select value={selected} onChange={e=>setSelected(Number(e.target.value))} style={{padding:"10px",borderRadius:10,border:"1.5px solid #E5E7EB",marginBottom:12,fontSize:14}}>
          {lists.map((l:any,i:number)=><option key={i} value={i}>{l.week} — {l.date} ({l.items.length} items)</option>)}
        </select>
        <div style={{flex:1,overflowY:"auto",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
            <span style={{fontSize:12,color:"#6B7280"}}>{checked.size} of {items.length} selected</span>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setChecked(new Set(items.map((i:any)=>i.id)))} style={{fontSize:12,color:"#4F46E5",background:"none",border:"none",cursor:"pointer"}}>All</button>
              <button onClick={()=>setChecked(new Set())} style={{fontSize:12,color:"#6B7280",background:"none",border:"none",cursor:"pointer"}}>None</button>
            </div>
          </div>
          {items.map((item:any)=>(
            <div key={item.id} onClick={()=>toggle(item.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:10,marginBottom:6,background:checked.has(item.id)?"#EEF2FF":"#F9FAFB",cursor:"pointer",border:`1.5px solid ${checked.has(item.id)?"#C7D2FE":"transparent"}`}}>
              <div style={{width:20,height:20,borderRadius:"50%",border:`2px solid ${checked.has(item.id)?"#4F46E5":"#D1D5DB"}`,background:checked.has(item.id)?"#4F46E5":"white",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {checked.has(item.id)&&<span style={{color:"white",fontSize:12}}>✓</span>}
              </div>
              <span style={{fontSize:14}}>{storeEmoji(item.storeId)}</span>
              <div style={{flex:1}}>
                <span style={{fontSize:14,fontWeight:500}}>{item.name}</span>
                <span style={{fontSize:12,color:"#9CA3AF",marginLeft:6}}>{item.qty} {item.unit}</span>
                {item.note&&<div style={{fontSize:11,color:"#9CA3AF"}}>{item.note}</div>}
              </div>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={onClose} style={{flex:1,padding:"11px",borderRadius:10,border:"1.5px solid #E5E7EB",background:"none",cursor:"pointer",fontWeight:500}}>Cancel</button>
          <button onClick={handleCopy} style={{flex:2,padding:"11px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",color:"white",cursor:"pointer",fontWeight:600}}>
            Copy {checked.size} item{checked.size!==1?"s":""}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Budget Settings Modal ─────────────────────────────────────────────────────
function BudgetModal({budgets,onSave,onClose}:{budgets:any,onSave:(b:any)=>void,onClose:()=>void}) {
  const [local,setLocal]=useState<any>({...budgets});
  const [saving,setSaving]=useState(false);
  const handle=async()=>{
    setSaving(true);
    await Promise.all(STORES.map(s=>saveBudget(s.id,parseFloat(local[s.id])||0)));
    onSave(local);setSaving(false);onClose();
  };
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:"1rem",backdropFilter:"blur(4px)"}}>
      <div style={{background:"white",borderRadius:20,padding:"1.5rem",width:"100%",maxWidth:360,boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
        <div style={{fontSize:18,fontWeight:700,marginBottom:4}}>💰 Weekly Budgets</div>
        <div style={{fontSize:13,color:"#6B7280",marginBottom:16}}>Set your weekly spend target per store</div>
        {STORES.map(s=>(
          <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <span style={{fontSize:18}}>{s.emoji}</span>
            <span style={{flex:1,fontWeight:500,color:storeColor(s.id)}}>{s.name}</span>
            <div style={{display:"flex",alignItems:"center",background:"#F9FAFB",border:"1.5px solid #E5E7EB",borderRadius:10,overflow:"hidden"}}>
              <span style={{padding:"8px 10px",fontWeight:600,color:"#374151"}}>£</span>
              <input type="number" min="0" step="5" value={local[s.id]||""} onChange={e=>setLocal((p:any)=>({...p,[s.id]:e.target.value}))}
                placeholder="0" style={{border:"none",background:"none",padding:"8px 10px 8px 0",width:80,fontSize:14}}/>
            </div>
          </div>
        ))}
        <div style={{display:"flex",gap:8,marginTop:16}}>
          <button onClick={onClose} style={{flex:1,padding:"11px",borderRadius:10,border:"1.5px solid #E5E7EB",background:"none",cursor:"pointer",fontWeight:500}}>Cancel</button>
          <button onClick={handle} disabled={saving} style={{flex:2,padding:"11px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",color:"white",cursor:"pointer",fontWeight:600,opacity:saving?0.8:1}}>
            {saving?"Saving…":"Save budgets"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Simple Bar Chart ──────────────────────────────────────────────────────────
function BarChart({data,color}:{data:{label:string,value:number,color?:string}[],color:string}) {
  const max=Math.max(...data.map(d=>d.value),1);
  return (
    <div style={{display:"flex",alignItems:"flex-end",gap:8,height:120,padding:"0 4px"}}>
      {data.map((d,i)=>(
        <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
          <span style={{fontSize:10,color:"#6B7280",fontWeight:500}}>{d.value>0?fmtGBP(d.value):""}</span>
          <div style={{width:"100%",background:d.color||color,borderRadius:"6px 6px 0 0",height:`${Math.max((d.value/max)*80,d.value>0?4:0)}px`,transition:"height 0.4s ease"}}></div>
          <span style={{fontSize:9,color:"#6B7280",textAlign:"center",lineHeight:1.2}}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [unlocked,setUnlocked]=useState(()=>{const ts=localStorage.getItem(PIN_TS_KEY);return ts?Date.now()-parseInt(ts)<30*864e5:false;});
  const [currentUser,setCurrentUser]=useState(()=>localStorage.getItem(USER_KEY)||"");
  const [items,setItems]=useState<any[]>([]);
  const [history,setHistory]=useState<any[]>([]);
  const [recurring,setRecurring]=useState<any[]>([]);
  const [weeklyLists,setWeeklyLists]=useState<any[]>([]);
  const [budgets,setBudgets]=useState<any>({});
  const [spendData,setSpendData]=useState<any[]>([]);
  const [view,setView]=useState("list");
  const [status,setStatus]=useState("loading");
  const [lastSync,setLastSync]=useState<Date|null>(null);
  const [newBadge,setNewBadge]=useState(0);
  const [form,setForm]=useState({store:"lidl",customStore:"",name:"",qty:1,unit:"item(s)",note:"",isRecurring:false});
  const [suggs,setSuggs]=useState<any[]>([]);
  const [showSugg,setShowSugg]=useState(false);
  const [postShop,setPostShop]=useState<any>(null);
  const [postForm,setPostForm]=useState<any>({});
  const [extra,setExtra]=useState({store:"lidl",customStore:"",name:"",qty:1,unit:"item(s)",price:""});
  const [showPin,setShowPin]=useState(false);
  const [showBudget,setShowBudget]=useState(false);
  const [showCopy,setShowCopy]=useState(false);
  const [spendRange,setSpendRange]=useState("Last 3 months");
  const [loadingReports,setLoadingReports]=useState(false);

  const lastITs=useRef<string|null>(null),lastHTs=useRef<string|null>(null);
  const saving=useRef(false),itemsRef=useRef<any[]>([]);
  const lastVisit=useRef(Date.now());
  itemsRef.current=items;

  const pull=useCallback(async(force=false)=>{
    try{
      const [iTs,hTs]=await Promise.all([kvGetTs(ITEMS_KEY),kvGetTs(HISTORY_KEY)]);
      const iChanged=force||iTs!==lastITs.current;
      const hChanged=force||hTs!==lastHTs.current;
      const [iR,hR]=await Promise.all([
        iChanged?kvGet(ITEMS_KEY):Promise.resolve(null),
        hChanged?kvGet(HISTORY_KEY):Promise.resolve(null),
      ]);
      if(iR){
        const newItems=iR.data||[];
        // count items added since last visit by other user
        const badge=newItems.filter((i:any)=>i.addedBy&&i.addedBy!==currentUser&&new Date(i.date).getTime()>lastVisit.current).length;
        setNewBadge(badge);
        setItems(newItems);lastITs.current=iTs;
      }
      if(hR){setHistory(hR.data||[]);lastHTs.current=hTs;}
      setLastSync(new Date());setStatus("ok");
    }catch{setStatus("error");}
  },[currentUser]);

  useEffect(()=>{
    if(!unlocked)return;
    pull(true);
    const t=setInterval(()=>{if(!saving.current)pull(false);},POLL_MS);
    return()=>clearInterval(t);
  },[pull,unlocked]);

  useEffect(()=>{
    if(!unlocked)return;
    Promise.all([getBudgets(),getWeeklyLists(),kvGet(RECURRING_KEY)]).then(([b,wl,rec])=>{
      setBudgets(b||{});
      setWeeklyLists(wl||[]);
      setRecurring(rec?rec.data:[]);
    });
  },[unlocked]);

  useEffect(()=>{
    if(!history.length)return;
    const freq:any={};
    history.forEach((wk:any)=>wk.items.forEach((it:any)=>{const k=`${it.storeId}||${it.name}||${it.unit}`;freq[k]=(freq[k]||0)+1;}));
    const cur=new Set(itemsRef.current.map((i:any)=>`${i.storeId}||${i.name}||${i.unit}`));
    const s=Object.entries(freq).filter(([k])=>!cur.has(k)).sort((a:any,b:any)=>b[1]-a[1]).slice(0,12)
      .map(([k])=>{const [storeId,name,unit]=k.split("||");return{storeId,name,unit};});
    setSuggs(s);
    if(s.length&&!itemsRef.current.length)setShowSugg(true);
  },[history]);

  const mutate=async(fn:(p:any[])=>any[])=>{
    saving.current=true;setStatus("saving");
    const next=fn(itemsRef.current);setItems(next);
    await kvSet(ITEMS_KEY,next);lastITs.current=await kvGetTs(ITEMS_KEY);
    setLastSync(new Date());saving.current=false;setStatus("ok");
  };

  const addItem=async()=>{
    if(!form.name.trim())return;
    const st=STORES.find(x=>x.id===form.store);
    const storeName=form.store==="misc"?(form.customStore||"Misc"):st!.name;
    const item={id:genId(),storeId:form.store,store:storeName,name:form.name.trim(),qty:form.qty,unit:form.unit,note:form.note.trim(),done:false,date:todayStr(),addedBy:currentUser,recurring:form.isRecurring};
    if(form.isRecurring){
      const newRec=[...recurring.filter(r=>!(r.storeId===form.store&&r.name===form.name.trim())),{storeId:form.store,store:storeName,name:form.name.trim(),qty:form.qty,unit:form.unit,note:form.note.trim()}];
      setRecurring(newRec);await kvSet(RECURRING_KEY,newRec);
    }
    await mutate(prev=>[...prev,item]);
    setForm(f=>({...f,name:"",qty:1,unit:"item(s)",note:"",isRecurring:false}));
  };

  const toggleDone=(id:string)=>mutate(p=>p.map(i=>i.id===id?{...i,done:!i.done}:i));
  const removeItem=(id:string)=>mutate(p=>p.filter(i=>i.id!==id));
  const clearDone=()=>mutate(p=>p.filter(i=>!i.done));

  const removeRecurring=async(name:string,storeId:string)=>{
    const newRec=recurring.filter(r=>!(r.name===name&&r.storeId===storeId));
    setRecurring(newRec);await kvSet(RECURRING_KEY,newRec);
  };

  const acceptSugg=async(s:any)=>{
    const st=STORES.find(x=>x.id===s.storeId)||STORES[0];
    await mutate(prev=>[...prev,{id:genId(),storeId:s.storeId,store:st.name,name:s.name,qty:1,unit:s.unit,note:"",done:false,date:todayStr(),addedBy:currentUser}]);
    setSuggs(p=>p.filter(x=>!(x.storeId===s.storeId&&x.name===s.name)));
  };

  const copyItems=async(newItems:any[])=>{
    const tagged=newItems.map(i=>({...i,addedBy:currentUser,done:false}));
    await mutate(prev=>[...prev,...tagged]);
    setShowCopy(false);
  };

  const startPostShop=()=>{
    const stores=[...new Set(items.map(i=>i.storeId))];
    const pf:any={};stores.forEach(s=>{pf[s]={spent:""};});
    setPostForm(pf);setPostShop({stores,extras:[]});setView("postshop");
  };

  const addExtra=()=>{
    if(!extra.name.trim())return;
    const st=STORES.find(x=>x.id===extra.store);
    const storeName=extra.store==="misc"?(extra.customStore||"Misc"):st!.name;
    setPostShop((ps:any)=>({...ps,extras:[...(ps.extras||[]),{id:genId(),storeId:extra.store,store:storeName,name:extra.name.trim(),qty:extra.qty,unit:extra.unit,price:extra.price,done:true,extra:true,addedBy:currentUser}]}));
    setExtra({store:"lidl",customStore:"",name:"",qty:1,unit:"item(s)",price:""});
  };

  const saveWeek=async()=>{
    saving.current=true;setStatus("saving");
    const wk=weekKey(),date=todayStr(),extras=postShop.extras||[];
    const allItems=[...items,...extras];
    const rec={week:wk,date,items:allItems,spending:postForm,totalSpent:Object.values(postForm).reduce((a:any,b:any)=>a+(parseFloat(b.spent)||0),0)};
    const newHist=history.find((h:any)=>h.week===wk)?history.map((h:any)=>h.week===wk?rec:h):[rec,...history];

    // Save spend records to spend_history table
    const spendRecords=postShop.stores
      .filter((stId:string)=>parseFloat(postForm[stId]?.spent||"0")>0)
      .map((stId:string)=>{
        const st=STORES.find(x=>x.id===stId);
        return{date,week:wk,store_id:stId,store_name:st?.name||stId,amount:parseFloat(postForm[stId].spent)};
      });
    await insertSpend(spendRecords);

    // Save weekly list
    await saveWeeklyList(wk,date,allItems);
    const newWL=await getWeeklyLists();
    setWeeklyLists(newWL);

    setHistory(newHist);setItems([]);
    await Promise.all([kvSet(ITEMS_KEY,[]),kvSet(HISTORY_KEY,newHist)]);
    const [iTs,hTs]=await Promise.all([kvGetTs(ITEMS_KEY),kvGetTs(HISTORY_KEY)]);
    lastITs.current=iTs;lastHTs.current=hTs;
    saving.current=false;setStatus("ok");setLastSync(new Date());setPostShop(null);setView("list");
  };

  const loadReports=useCallback(async()=>{
    setLoadingReports(true);
    const now=new Date();
    let fromDate="2000-01-01";
    if(spendRange==="Last 4 weeks"){const d=new Date(now);d.setDate(d.getDate()-28);fromDate=d.toISOString().slice(0,10);}
    else if(spendRange==="Last 3 months"){const d=new Date(now);d.setMonth(d.getMonth()-3);fromDate=d.toISOString().slice(0,10);}
    else if(spendRange==="Last 6 months"){const d=new Date(now);d.setMonth(d.getMonth()-6);fromDate=d.toISOString().slice(0,10);}
    else if(spendRange==="Last year"){const d=new Date(now);d.setFullYear(d.getFullYear()-1);fromDate=d.toISOString().slice(0,10);}
    const data=await getSpend(fromDate);
    setSpendData(data);setLoadingReports(false);
  },[spendRange]);

  useEffect(()=>{if(view==="reports")loadReports();},[view,spendRange,loadReports]);

  // Compute report data
  const spendByStore=STORES.map(s=>({
    label:s.name, color:s.color,
    value:spendData.filter((d:any)=>d.store_id===s.id).reduce((a:any,d:any)=>a+parseFloat(d.amount),0)
  })).filter(s=>s.value>0);

  const totalSpend=spendByStore.reduce((a,s)=>a+s.value,0);

  // Weekly trend (last 8 weeks)
  const weeklyTrend=Array.from({length:8},(_,i)=>{
    const d=new Date();d.setDate(d.getDate()-i*7);
    const j=new Date(d.getFullYear(),0,1);
    const wk=`${d.getFullYear()}-W${String(Math.ceil(((d.getTime()-j.getTime())/864e5+j.getDay()+1)/7)).padStart(2,"0")}`;
    const val=spendData.filter((s:any)=>s.week===wk).reduce((a:any,s:any)=>a+parseFloat(s.amount),0);
    return{label:`W${wk.split("-W")[1]}`,value:val};
  }).reverse();

  const grouped=STORES.map(s=>({...s,items:items.filter(i=>i.storeId===s.id)})).filter(g=>g.items.length>0);
  const doneCount=items.filter(i=>i.done).length;
  const totalItems=items.length;

  if(!unlocked||!currentUser) return <PinScreen onUnlock={(u)=>{setUnlocked(true);setCurrentUser(u);}}/>;

  return (
    <div style={{minHeight:"100vh",background:"#F8FAFF",fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
      <style>{`
        *{box-sizing:border-box;}
        input,select,button{font-family:inherit;}
        input:focus,select:focus{outline:none;border-color:#4F46E5!important;box-shadow:0 0 0 3px rgba(79,70,229,0.1);}
        .item-row{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-radius:14px;margin-bottom:8px;background:white;border:1.5px solid #F1F5F9;transition:all 0.15s;box-shadow:0 1px 4px rgba(0,0,0,0.04);}
        .item-row:hover{border-color:#E0E7FF;}
        .icon-btn{background:none;border:none;cursor:pointer;padding:6px;border-radius:8px;display:flex;align-items:center;justify-content:center;}
        .check-circle{width:24px;height:24px;border-radius:50%;border:2px solid #D1D5DB;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.2s;margin-top:2px;}
        .check-circle.done{background:linear-gradient(135deg,#4F46E5,#7C3AED);border-color:transparent;}
        .tab-btn{background:none;border:none;padding:10px 16px;cursor:pointer;font-size:13px;font-weight:500;color:rgba(255,255,255,0.6);border-bottom:2.5px solid transparent;transition:all 0.2s;white-space:nowrap;}
        .tab-btn.active{color:white;border-bottom-color:white;}
        .sugg-chip{display:inline-flex;align-items:center;gap:6px;background:white;border:1.5px solid #E5E7EB;border-radius:999px;padding:6px 14px;font-size:13px;margin:4px;cursor:pointer;transition:all 0.15s;}
        .sugg-chip:hover{border-color:#4F46E5;color:#4F46E5;}
        .hist-card{background:white;border:1.5px solid #F1F5F9;border-radius:16px;padding:1.2rem 1.4rem;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.04);}
        .primary-btn{background:linear-gradient(135deg,#4F46E5,#7C3AED);color:white;border:none;border-radius:12px;padding:12px 20px;font-weight:600;cursor:pointer;font-size:14px;box-shadow:0 4px 12px rgba(79,70,229,0.3);transition:all 0.2s;}
        .primary-btn:hover{transform:translateY(-1px);}
        .input-base{padding:10px 14px;border-radius:10px;border:1.5px solid #E5E7EB;font-size:14px;background:white;transition:all 0.2s;}
        .report-card{background:white;border-radius:16px;padding:1.2rem;margin-bottom:12px;border:1.5px solid #F1F5F9;box-shadow:0 1px 4px rgba(0,0,0,0.04);}
        @media print{.no-print{display:none!important;}}
      `}</style>

      {showPin&&<ChangePinModal onClose={()=>setShowPin(false)}/>}
      {showBudget&&<BudgetModal budgets={budgets} onSave={b=>{setBudgets(b);}} onClose={()=>setShowBudget(false)}/>}
      {showCopy&&<CopyWeekModal lists={weeklyLists} onCopy={copyItems} onClose={()=>setShowCopy(false)}/>}

      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%)",padding:"1.2rem 1rem 0",position:"sticky",top:0,zIndex:10}} className="no-print">
        <div style={{maxWidth:680,margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"0.8rem"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:36,height:36,borderRadius:10,background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🛒</div>
              <div>
                <div style={{fontSize:17,fontWeight:700,color:"white"}}>Family Groceries</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.7)",display:"flex",alignItems:"center",gap:4}}>
                  <span style={{width:6,height:6,borderRadius:"50%",background:status==="saving"?"#FCD34D":status==="error"?"#FCA5A5":"#6EE7B7",display:"inline-block"}}></span>
                  {status==="saving"?"Saving…":status==="error"?"Sync error":lastSync?`Synced ${lastSync.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`:"Connecting…"}
                  <button onClick={()=>pull(true)} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,0.7)",fontSize:13,padding:"0 2px"}}>↻</button>
                </div>
              </div>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <div style={{fontSize:12,color:"rgba(255,255,255,0.8)",background:"rgba(255,255,255,0.15)",borderRadius:8,padding:"4px 10px"}}>
                {currentUser==="Amrit"?"👨":"👩"} {currentUser}
              </div>
              <button onClick={()=>setShowPin(true)} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:10,padding:"8px",cursor:"pointer",fontSize:15,color:"white"}}>🔐</button>
              <button onClick={()=>setShowBudget(true)} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:10,padding:"8px",cursor:"pointer",fontSize:15,color:"white"}}>💰</button>
              {view==="list"&&<>
                {weeklyLists.length>0&&<button onClick={()=>setShowCopy(true)} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:10,padding:"8px 12px",cursor:"pointer",fontSize:12,color:"white",fontWeight:500}}>📋 Copy</button>}
                {items.length>0&&<button onClick={startPostShop} style={{background:"white",border:"none",borderRadius:10,padding:"8px 12px",cursor:"pointer",fontSize:12,color:"#4F46E5",fontWeight:600}}>Done shopping</button>}
              </>}
            </div>
          </div>

          {totalItems>0&&view==="list"&&(
            <div style={{marginBottom:"0.8rem"}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"rgba(255,255,255,0.8)",marginBottom:4}}>
                <span>{doneCount} of {totalItems} done</span>
                <span>{Math.round(doneCount/totalItems*100)}%</span>
              </div>
              <div style={{height:4,background:"rgba(255,255,255,0.2)",borderRadius:999}}>
                <div style={{height:"100%",background:"white",borderRadius:999,width:`${doneCount/totalItems*100}%`,transition:"width 0.4s ease"}}></div>
              </div>
            </div>
          )}

          <div style={{display:"flex",gap:2,overflowX:"auto"}}>
            {["list","reports","history"].map(t=>(
              <button key={t} className={`tab-btn ${(view===t||(["postshop","print"].includes(view)&&t==="list"))?"active":""}`} onClick={()=>setView(t)}>
                {t==="list"?(
                  <span style={{display:"flex",alignItems:"center",gap:4}}>
                    List{items.length?` · ${items.length}`:""}
                    {newBadge>0&&<span style={{background:"#EF4444",color:"white",borderRadius:"999px",padding:"1px 6px",fontSize:10,fontWeight:700}}>{newBadge}</span>}
                  </span>
                ):t==="reports"?"📊 Reports":"History"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{maxWidth:680,margin:"0 auto",padding:"1rem"}}>

        {/* Print view */}
        {view==="print"&&(
          <div>
            <div className="no-print" style={{display:"flex",gap:10,marginBottom:"1rem"}}>
              <button onClick={()=>setView("list")} style={{padding:"10px 16px",borderRadius:10,border:"1.5px solid #E5E7EB",background:"white",cursor:"pointer",fontWeight:500}}>← Back</button>
              <button onClick={()=>window.print()} className="primary-btn">🖨️ Print now</button>
            </div>
            <h2 style={{fontSize:20,marginBottom:4,fontWeight:700}}>Grocery List — {weekKey()}</h2>
            <p style={{fontSize:13,color:"#6B7280",marginBottom:"1.5rem"}}>{new Date().toLocaleDateString("en-GB",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p>
            {grouped.map(grp=>(
              <div key={grp.id} style={{marginBottom:20}}>
                <div style={{fontSize:13,fontWeight:700,textTransform:"uppercase",borderBottom:`2px solid ${grp.color}`,paddingBottom:6,marginBottom:10,color:grp.color}}>{grp.emoji} {grp.name}</div>
                {grp.items.map((item:any)=>(
                  <div key={item.id} style={{display:"flex",alignItems:"flex-start",gap:12,padding:"8px 0",borderBottom:"0.5px solid #f3f4f6"}}>
                    <span style={{width:18,height:18,border:"1.5px solid #aaa",display:"inline-block",borderRadius:4,flexShrink:0,marginTop:2}}></span>
                    <div style={{flex:1}}>
                      <span style={{fontSize:15}}>{item.name}</span>
                      <span style={{fontSize:13,color:"#6B7280",marginLeft:8}}>{item.qty} {item.unit}</span>
                      {item.note&&<div style={{fontSize:12,color:"#9CA3AF",fontStyle:"italic"}}>{item.note}</div>}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* List view */}
        {view==="list"&&(
          <div>
            {/* New items badge */}
            {newBadge>0&&(
              <div style={{background:"#FEF3C7",border:"1.5px solid #FCD34D",borderRadius:12,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:8}} className="no-print">
                <span style={{fontSize:16}}>🔔</span>
                <span style={{fontSize:13,fontWeight:500,color:"#92400E"}}>{newBadge} new item{newBadge>1?"s":""} added since your last visit</span>
                <button onClick={()=>setNewBadge(0)} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"#92400E",fontSize:16}}>✕</button>
              </div>
            )}

            {/* Recurring items */}
            {recurring.length>0&&(
              <div style={{background:"linear-gradient(135deg,#ECFDF5,#D1FAE5)",borderRadius:16,padding:"1rem",marginBottom:"1rem",border:"1.5px solid #A7F3D0"}} className="no-print">
                <div style={{fontSize:13,fontWeight:600,color:"#065F46",marginBottom:8}}>🔁 Recurring items</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {recurring.map((r:any,i:number)=>(
                    <span key={i} style={{display:"inline-flex",alignItems:"center",gap:5,background:"white",borderRadius:999,padding:"4px 12px",fontSize:12,fontWeight:500,border:"1px solid #A7F3D0"}}>
                      {storeEmoji(r.storeId)} {r.name}
                      <button onClick={()=>removeRecurring(r.name,r.storeId)} style={{background:"none",border:"none",cursor:"pointer",color:"#9CA3AF",fontSize:12,padding:0}}>✕</button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Suggestions */}
            {showSugg&&suggs.length>0&&(
              <div style={{background:"linear-gradient(135deg,#EDE9FE,#DBEAFE)",borderRadius:16,padding:"1rem",marginBottom:"1rem",border:"1.5px solid #DDD6FE"}} className="no-print">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{fontSize:14,fontWeight:600,color:"#4F46E5"}}>💡 Suggested for this week</div>
                  <button className="icon-btn" onClick={()=>setShowSugg(false)} style={{color:"#6B7280"}}>✕</button>
                </div>
                <div style={{display:"flex",flexWrap:"wrap"}}>
                  {suggs.map((s:any,i:number)=>{
                    const st=STORES.find(x=>x.id===s.storeId);
                    return (
                      <span key={i} className="sugg-chip" onClick={()=>acceptSugg(s)}>
                        <span>{storeEmoji(s.storeId)}</span>
                        <span style={{fontWeight:500}}>{s.name}</span>
                        <span style={{fontSize:11,color:"#9CA3AF"}}>{st?.name}</span>
                        <span style={{fontSize:11,color:"#4F46E5"}}>+ add</span>
                        <span onClick={(e:any)=>{e.stopPropagation();setSuggs((p:any)=>p.filter((x:any)=>!(x.storeId===s.storeId&&x.name===s.name)));}} style={{color:"#D1D5DB",marginLeft:2}}>✕</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Add item form */}
            <div className="no-print" style={{background:"white",borderRadius:16,padding:"1rem",marginBottom:"1rem",border:"1.5px solid #F1F5F9",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
              <div style={{fontSize:13,fontWeight:600,color:"#374151",marginBottom:10}}>Add item</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
                <select value={form.store} onChange={e=>setForm(f=>({...f,store:e.target.value}))} className="input-base" style={{minWidth:110}}>
                  {STORES.map(s=><option key={s.id} value={s.id}>{s.emoji} {s.name}</option>)}
                </select>
                {form.store==="misc"&&<input placeholder="Store name" value={form.customStore} onChange={e=>setForm(f=>({...f,customStore:e.target.value}))} className="input-base" style={{width:110}}/>}
                <input placeholder="Item name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} onKeyDown={(e:any)=>e.key==="Enter"&&addItem()} className="input-base" style={{flex:1,minWidth:130}}/>
                <input type="number" min="0.1" step="0.5" value={form.qty} onChange={e=>setForm(f=>({...f,qty:Number(e.target.value)}))} className="input-base" style={{width:64}}/>
                <select value={form.unit} onChange={e=>setForm(f=>({...f,unit:e.target.value}))} className="input-base" style={{minWidth:100}}>
                  {UNITS.map(u=><option key={u}>{u}</option>)}
                </select>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                <input placeholder="Note (optional) e.g. get the cheap one" value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))} className="input-base" style={{flex:1,minWidth:160}}/>
                <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:"#374151",cursor:"pointer",whiteSpace:"nowrap"}}>
                  <input type="checkbox" checked={form.isRecurring} onChange={e=>setForm(f=>({...f,isRecurring:e.target.checked}))} style={{width:16,height:16}}/>
                  🔁 Recurring
                </label>
                <button onClick={addItem} className="primary-btn" style={{padding:"10px 20px"}}>+ Add</button>
              </div>
            </div>

            {grouped.length===0&&(
              <div style={{textAlign:"center",padding:"4rem 1rem",color:"#9CA3AF"}}>
                <div style={{fontSize:56,marginBottom:12}}>🛒</div>
                <div style={{fontSize:17,fontWeight:600,color:"#374151",marginBottom:4}}>Your list is empty</div>
                <div style={{fontSize:14}}>Add items above to get started</div>
                <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:16,flexWrap:"wrap"}}>
                  {suggs.length>0&&!showSugg&&<button onClick={()=>setShowSugg(true)} style={{fontSize:13,padding:"10px 20px",borderRadius:10,border:"1.5px solid #4F46E5",background:"none",color:"#4F46E5",cursor:"pointer",fontWeight:500}}>💡 Show suggestions</button>}
                  {weeklyLists.length>0&&<button onClick={()=>setShowCopy(true)} style={{fontSize:13,padding:"10px 20px",borderRadius:10,border:"1.5px solid #10B981",background:"none",color:"#10B981",cursor:"pointer",fontWeight:500}}>📋 Copy previous list</button>}
                </div>
              </div>
            )}

            {view==="list"&&items.length>0&&(
              <div className="no-print" style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
                <button onClick={()=>setView("print")} style={{fontSize:13,padding:"6px 14px",borderRadius:8,border:"0.5px solid #d1d5db",background:"none",cursor:"pointer"}}>🖨️ Print list</button>
              </div>
            )}

            {grouped.map(grp=>(
              <div key={grp.id}>
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 4px",marginBottom:4}}>
                  <span style={{fontSize:18}}>{grp.emoji}</span>
                  <span style={{fontSize:13,fontWeight:700,color:grp.color,textTransform:"uppercase",letterSpacing:"0.05em"}}>{grp.name}</span>
                  {grp.type==="indian"&&<span style={{fontSize:11,background:grp.light,color:grp.color,padding:"2px 8px",borderRadius:999,fontWeight:600}}>Indian</span>}
                  <span style={{marginLeft:"auto",fontSize:12,color:"#9CA3AF"}}>{grp.items.filter((i:any)=>i.done).length}/{grp.items.length}</span>
                </div>
                {grp.items.map((item:any)=>(
                  <div key={item.id} className="item-row" style={{opacity:item.done?0.5:1}}>
                    <div className={`check-circle ${item.done?"done":""}`} onClick={()=>toggleDone(item.id)}>
                      {item.done&&<span style={{color:"white",fontSize:13,fontWeight:700}}>✓</span>}
                    </div>
                    <div style={{flex:1}}>
                      <div>
                        <span style={{textDecoration:item.done?"line-through":"none",fontSize:15,fontWeight:500,color:"#111827"}}>{item.name}</span>
                        <span style={{marginLeft:8,fontSize:12,color:"#9CA3AF"}}>{item.qty} {item.unit}</span>
                        {item.recurring&&<span style={{marginLeft:6,fontSize:10,color:"#10B981",fontWeight:600}}>🔁</span>}
                      </div>
                      {item.note&&<div style={{fontSize:12,color:"#9CA3AF",fontStyle:"italic",marginTop:2}}>💬 {item.note}</div>}
                      {item.addedBy&&<div style={{fontSize:11,color:"#C4B5FD",marginTop:1}}>by {item.addedBy}</div>}
                    </div>
                    <button className="icon-btn no-print" onClick={()=>removeItem(item.id)}>
                      <span style={{color:"#FCA5A5",fontSize:18}}>✕</span>
                    </button>
                  </div>
                ))}
              </div>
            ))}

            {doneCount>0&&(
              <button className="no-print" onClick={clearDone} style={{marginTop:8,fontSize:13,padding:"10px 18px",borderRadius:10,border:"1.5px solid #FCA5A5",background:"#FEF2F2",color:"#EF4444",cursor:"pointer",fontWeight:500,width:"100%"}}>
                🗑️ Remove {doneCount} checked item{doneCount>1?"s":""}
              </button>
            )}
          </div>
        )}

        {/* Post-shop */}
        {view==="postshop"&&postShop&&(
          <div>
            <div style={{background:"linear-gradient(135deg,#ECFDF5,#D1FAE5)",borderRadius:16,padding:"1rem 1.2rem",marginBottom:"1rem",border:"1.5px solid #A7F3D0"}}>
              <div style={{fontSize:16,fontWeight:700,color:"#065F46"}}>🎉 Shopping done!</div>
              <div style={{fontSize:13,color:"#047857",marginTop:2}}>Log your spending below.</div>
            </div>
            {postShop.stores.map((stId:string)=>{
              const st=STORES.find(x=>x.id===stId);
              const budget=parseFloat(budgets[stId]||"0");
              const spent=parseFloat(postForm[stId]?.spent||"0");
              const overBudget=budget>0&&spent>budget;
              const underBudget=budget>0&&spent>0&&spent<=budget;
              return (
                <div key={stId} className="hist-card" style={{marginBottom:10,borderColor:overBudget?"#FCA5A5":underBudget?"#6EE7B7":"#F1F5F9"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                    <span style={{fontSize:20}}>{storeEmoji(stId)}</span>
                    <span style={{fontWeight:600,color:storeColor(stId)}}>{st?.name||stId}</span>
                    {budget>0&&<span style={{fontSize:12,color:"#9CA3AF",marginLeft:"auto"}}>Budget: {fmtGBP(budget)}</span>}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:14,color:"#6B7280",fontWeight:500}}>Amount spent</span>
                    <div style={{display:"flex",alignItems:"center",background:"#F9FAFB",border:`1.5px solid ${overBudget?"#FCA5A5":underBudget?"#6EE7B7":"#E5E7EB"}`,borderRadius:10,overflow:"hidden"}}>
                      <span style={{padding:"10px 12px",fontWeight:600,color:"#374151"}}>£</span>
                      <input type="number" min="0" step="0.01" placeholder="0.00" value={postForm[stId]?.spent||""} onChange={e=>setPostForm((pf:any)=>({...pf,[stId]:{...pf[stId],spent:e.target.value}}))} style={{border:"none",background:"none",padding:"10px 12px 10px 0",width:100,fontSize:15,fontWeight:500}}/>
                    </div>
                    {overBudget&&<span style={{fontSize:12,color:"#EF4444",fontWeight:600}}>⚠️ {fmtGBP(spent-budget)} over!</span>}
                    {underBudget&&<span style={{fontSize:12,color:"#10B981",fontWeight:600}}>✅ {fmtGBP(budget-spent)} under</span>}
                  </div>
                </div>
              );
            })}
            <div style={{fontSize:15,fontWeight:700,margin:"1.2rem 0 0.8rem",color:"#374151"}}>➕ Extra items bought</div>
            <div style={{background:"white",borderRadius:16,padding:"1rem",border:"1.5px solid #F1F5F9",marginBottom:8}}>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <select value={extra.store} onChange={e=>setExtra(x=>({...x,store:e.target.value}))} className="input-base" style={{minWidth:110}}>
                  {STORES.map(s=><option key={s.id} value={s.id}>{s.emoji} {s.name}</option>)}
                </select>
                {extra.store==="misc"&&<input placeholder="Store name" value={extra.customStore} onChange={e=>setExtra(x=>({...x,customStore:e.target.value}))} className="input-base" style={{width:100}}/>}
                <input placeholder="Item name" value={extra.name} onChange={e=>setExtra(x=>({...x,name:e.target.value}))} className="input-base" style={{flex:1,minWidth:100}}/>
                <input type="number" min="1" value={extra.qty} onChange={e=>setExtra(x=>({...x,qty:Number(e.target.value)}))} className="input-base" style={{width:56}}/>
                <select value={extra.unit} onChange={e=>setExtra(x=>({...x,unit:e.target.value}))} className="input-base" style={{minWidth:100}}>
                  {UNITS.map(u=><option key={u}>{u}</option>)}
                </select>
                <input placeholder="£ price" type="number" value={extra.price} onChange={e=>setExtra(x=>({...x,price:e.target.value}))} className="input-base" style={{width:80}}/>
                <button onClick={addExtra} className="primary-btn">Add</button>
              </div>
            </div>
            {(postShop.extras||[]).map((ex:any)=>(
              <div key={ex.id} className="item-row">
                <span style={{fontSize:18}}>{storeEmoji(ex.storeId)}</span>
                <span style={{flex:1,fontSize:15,fontWeight:500}}>{ex.name} <span style={{fontSize:12,color:"#9CA3AF"}}>{ex.qty} {ex.unit}</span></span>
                {ex.price&&<span style={{fontSize:13,fontWeight:600}}>£{parseFloat(ex.price).toFixed(2)}</span>}
              </div>
            ))}
            <div style={{display:"flex",gap:10,marginTop:"1.5rem"}}>
              <button onClick={()=>setView("list")} style={{flex:1,padding:"13px",borderRadius:12,border:"1.5px solid #E5E7EB",background:"white",cursor:"pointer",fontWeight:600}}>Back</button>
              <button onClick={saveWeek} className="primary-btn" style={{flex:2,padding:"13px"}}>Save & clear list</button>
            </div>
          </div>
        )}

        {/* Reports */}
        {view==="reports"&&(
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
              <div style={{fontSize:16,fontWeight:700,color:"#111827"}}>📊 Spend Reports</div>
              <select value={spendRange} onChange={e=>setSpendRange(e.target.value)} className="input-base" style={{fontSize:13}}>
                {RANGES.map(r=><option key={r}>{r}</option>)}
              </select>
            </div>

            {loadingReports?(
              <div style={{textAlign:"center",padding:"3rem",color:"#9CA3AF"}}>Loading reports…</div>
            ):spendData.length===0?(
              <div style={{textAlign:"center",padding:"4rem 1rem",color:"#9CA3AF"}}>
                <div style={{fontSize:48,marginBottom:12}}>📊</div>
                <div style={{fontSize:16,fontWeight:600,color:"#374151",marginBottom:4}}>No spend data yet</div>
                <div style={{fontSize:14}}>Complete a shopping trip to see reports</div>
              </div>
            ):(
              <>
                {/* Total spend card */}
                <div className="report-card" style={{background:"linear-gradient(135deg,#4F46E5,#7C3AED)",color:"white"}}>
                  <div style={{fontSize:13,opacity:0.8,marginBottom:4}}>Total spend — {spendRange}</div>
                  <div style={{fontSize:32,fontWeight:700}}>{fmtGBP(totalSpend)}</div>
                  <div style={{fontSize:13,opacity:0.8,marginTop:4}}>{spendByStore.length} stores · {spendData.length} trips</div>
                </div>

                {/* Spend by store */}
                <div className="report-card">
                  <div style={{fontSize:14,fontWeight:700,color:"#111827",marginBottom:16}}>Spend by store</div>
                  <BarChart data={spendByStore.map(s=>({label:s.label,value:s.value,color:s.color}))} color="#4F46E5"/>
                  <div style={{marginTop:16,display:"flex",flexDirection:"column",gap:8}}>
                    {spendByStore.sort((a,b)=>b.value-a.value).map((s,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:10,height:10,borderRadius:"50%",background:s.color,flexShrink:0}}></div>
                        <span style={{flex:1,fontSize:14,fontWeight:500}}>{s.label}</span>
                        <span style={{fontSize:14,fontWeight:700,color:s.color}}>{fmtGBP(s.value)}</span>
                        <span style={{fontSize:12,color:"#9CA3AF"}}>{Math.round(s.value/totalSpend*100)}%</span>
                        {budgets[STORES.find(x=>x.name===s.label)?.id||""]>0&&(
                          <span style={{fontSize:11,color:"#9CA3AF"}}>Budget: {fmtGBP(parseFloat(budgets[STORES.find(x=>x.name===s.label)?.id||""]||"0"))}/wk</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Weekly trend */}
                <div className="report-card">
                  <div style={{fontSize:14,fontWeight:700,color:"#111827",marginBottom:16}}>Weekly spend trend</div>
                  <BarChart data={weeklyTrend} color="#7C3AED"/>
                </div>
              </>
            )}
          </div>
        )}

        {/* History */}
        {view==="history"&&(
          <div>
            {!weeklyLists.length&&<div style={{textAlign:"center",padding:"4rem 1rem",color:"#9CA3AF"}}><div style={{fontSize:48,marginBottom:12}}>📋</div><div style={{fontSize:16,fontWeight:600,color:"#374151"}}>No history yet</div></div>}
            {weeklyLists.map((h:any,i:number)=>(
              <div key={i} className="hist-card">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                  <div>
                    <div style={{fontWeight:700,color:"#111827"}}>{h.week}</div>
                    <div style={{fontSize:12,color:"#9CA3AF"}}>{h.date}</div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <button onClick={()=>{setShowCopy(true);}} style={{fontSize:12,padding:"4px 10px",borderRadius:8,border:"1px solid #E5E7EB",background:"none",cursor:"pointer",color:"#4F46E5"}}>Copy</button>
                    <button onClick={async()=>{await deleteWeeklyList(h.week);setWeeklyLists(p=>p.filter(x=>x.week!==h.week));}} style={{fontSize:12,padding:"4px 10px",borderRadius:8,border:"1px solid #FCA5A5",background:"none",cursor:"pointer",color:"#EF4444"}}>Delete</button>
                  </div>
                </div>
                <details style={{fontSize:13}}>
                  <summary style={{cursor:"pointer",color:"#6B7280",fontWeight:500,listStyle:"none"}}>▸ View {h.items.length} items</summary>
                  <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:4}}>
                    {h.items.map((it:any,j:number)=>(
                      <div key={j} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:8,background:"#F9FAFB"}}>
                        <span style={{fontSize:14}}>{storeEmoji(it.storeId)}</span>
                        <span style={{fontSize:13,fontWeight:500,flex:1}}>{it.extra?"✨ ":""}{it.name}</span>
                        <span style={{fontSize:12,color:"#9CA3AF"}}>{it.qty} {it.unit}</span>
                        {it.addedBy&&<span style={{fontSize:11,color:"#C4B5FD"}}>{it.addedBy}</span>}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}