import { useState, useEffect, useCallback, useRef } from "react";

const SUPABASE_URL = "https://mbvmnwulfllfgxivlerw.supabase.co";
const SUPABASE_KEY = "sb_publishable_M5CMfYarPj6rsWCtsZMbDw_pWMZY25W";
const POLL_MS = 5000;
const DEFAULT_PIN = "1234";
const PIN_TS_KEY = "grocery_pin_ts";
const PIN_VAL_KEY = "grocery_pin_val";

const STORES = [
  { id:"lidl",   name:"Lidl",   color:"#1D4ED8", light:"#DBEAFE", emoji:"🔵", type:"general" },
  { id:"tesco",  name:"Tesco",  color:"#1E40AF", light:"#EFF6FF", emoji:"🛍️", type:"general" },
  { id:"asda",   name:"Asda",   color:"#15803D", light:"#DCFCE7", emoji:"🟢", type:"general" },
  { id:"sai",    name:"Sai",    color:"#B45309", light:"#FEF3C7", emoji:"🌶️", type:"indian"  },
  { id:"sujash", name:"Sujash", color:"#7C3AED", light:"#EDE9FE", emoji:"🪷", type:"indian"  },
  { id:"misc",   name:"Misc",   color:"#374151", light:"#F3F4F6", emoji:"🏪", type:"misc"    },
];
const UNITS = ["item(s)","litre(s)","kg","g","dozen","box(es)","pack(s)","bag(s)","bottle(s)","can(s)","loaf/loaves","bunch(es)"];
const genId    = () => Math.random().toString(36).slice(2,9);
const todayStr = () => new Date().toISOString().slice(0,10);
const weekKey  = () => {
  const d=new Date(), j=new Date(d.getFullYear(),0,1);
  return `${d.getFullYear()}-W${String(Math.ceil(((d.getTime()-j.getTime())/864e5+j.getDay()+1)/7)).padStart(2,"0")}`;
};
const storeColor = (id:string) => STORES.find(x=>x.id===id)?.color||"#374151";
const storeBg    = (id:string) => STORES.find(x=>x.id===id)?.light||"#F3F4F6";
const storeEmoji = (id:string) => STORES.find(x=>x.id===id)?.emoji||"🏪";

const headers = {"Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":`Bearer ${SUPABASE_KEY}`};
async function dbGet(key:string) {
  try {
    const r=await fetch(`${SUPABASE_URL}/rest/v1/grocery_store?key=eq.${key}&select=value,updated_at`,{headers});
    if(!r.ok) return null;
    const rows=await r.json();
    return rows.length?{data:JSON.parse(rows[0].value),ts:rows[0].updated_at}:null;
  } catch{return null;}
}
async function dbSet(key:string,value:any) {
  try{
    const r=await fetch(`${SUPABASE_URL}/rest/v1/grocery_store`,{method:"POST",headers:{...headers,"Prefer":"resolution=merge-duplicates"},body:JSON.stringify({key,value:JSON.stringify(value),updated_at:new Date().toISOString()})});
    return r.ok;
  }catch{return false;}
}
async function dbGetTs(key:string) {
  try{
    const r=await fetch(`${SUPABASE_URL}/rest/v1/grocery_store?key=eq.${key}&select=updated_at`,{headers});
    if(!r.ok) return null;
    const rows=await r.json();
    return rows.length?rows[0].updated_at:null;
  }catch{return null;}
}
const ITEMS_KEY="family_items", HISTORY_KEY="family_history";

function PinScreen({onUnlock}:{onUnlock:()=>void}) {
  const [pin,setPin]=useState("");
  const [error,setError]=useState(false);
  const [shake,setShake]=useState(false);
  const submit=()=>{
    const correct=localStorage.getItem(PIN_VAL_KEY)||DEFAULT_PIN;
    if(pin===correct){localStorage.setItem(PIN_TS_KEY,Date.now().toString());onUnlock();}
    else{setError(true);setShake(true);setPin("");setTimeout(()=>{setError(false);setShake(false);},600);}
  };
  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%)",padding:"1rem"}}>
      <div style={{background:"white",borderRadius:24,padding:"2.5rem 2rem",width:"100%",maxWidth:360,boxShadow:"0 20px 60px rgba(0,0,0,0.2)",textAlign:"center",animation:shake?"shake 0.4s ease":"none"}}>
        <style>{`@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}`}</style>
        <div style={{width:72,height:72,borderRadius:"50%",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 1.2rem",fontSize:32}}>🛒</div>
        <div style={{fontSize:22,fontWeight:700,color:"#111827",marginBottom:4}}>Family Groceries</div>
        <div style={{fontSize:14,color:"#6B7280",marginBottom:"1.8rem"}}>Enter your access code</div>
        <input type="password" placeholder="PIN or passphrase"
          value={pin} onChange={e=>{setPin(e.target.value);setError(false);}}
          onKeyDown={e=>e.key==="Enter"&&submit()}
          style={{width:"100%",padding:"14px",borderRadius:12,border:`2px solid ${error?"#EF4444":"#E5E7EB"}`,fontSize:16,textAlign:"center",outline:"none",boxSizing:"border-box",marginBottom:error?8:16,transition:"border 0.2s"}}
          autoFocus/>
        {error&&<div style={{color:"#EF4444",fontSize:13,marginBottom:12}}>Incorrect code. Try again.</div>}
        <button onClick={submit} style={{width:"100%",padding:"14px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",color:"white",fontSize:16,fontWeight:600,cursor:"pointer",boxShadow:"0 4px 12px rgba(79,70,229,0.4)"}}>Unlock</button>
      </div>
    </div>
  );
}

function ChangePinModal({onClose}:{onClose:()=>void}) {
  const [f,setF]=useState({current:"",next:"",confirm:""});
  const [msg,setMsg]=useState<{text:string,ok:boolean}|null>(null);
  const handle=()=>{
    const correct=localStorage.getItem(PIN_VAL_KEY)||DEFAULT_PIN;
    if(f.current!==correct){setMsg({text:"Current PIN is incorrect",ok:false});return;}
    if(f.next.length<4){setMsg({text:"New PIN must be at least 4 characters",ok:false});return;}
    if(f.next!==f.confirm){setMsg({text:"New PINs don't match",ok:false});return;}
    localStorage.setItem(PIN_VAL_KEY,f.next);
    setMsg({text:"PIN changed successfully! ✓",ok:true});
    setTimeout(onClose,1500);
  };
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:"1rem",backdropFilter:"blur(4px)"}}>
      <div style={{background:"white",borderRadius:20,padding:"1.5rem",width:"100%",maxWidth:340,boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
        <div style={{fontSize:18,fontWeight:700,marginBottom:"1.2rem",display:"flex",alignItems:"center",gap:8}}>🔐 Change PIN</div>
        {(["current","next","confirm"] as const).map((key,i)=>(
          <div key={key} style={{marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:500,color:"#374151",marginBottom:5}}>{["Current PIN","New PIN","Confirm new PIN"][i]}</div>
            <input type="password" placeholder={["Enter current PIN","Min 4 characters","Re-enter new PIN"][i]}
              value={f[key]} onChange={e=>setF(p=>({...p,[key]:e.target.value}))}
              style={{width:"100%",padding:"11px 14px",borderRadius:10,border:"1.5px solid #E5E7EB",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
          </div>
        ))}
        {msg&&<div style={{fontSize:13,color:msg.ok?"#10B981":"#EF4444",marginBottom:12,padding:"8px 12px",borderRadius:8,background:msg.ok?"#ECFDF5":"#FEF2F2"}}>{msg.text}</div>}
        <div style={{display:"flex",gap:8,marginTop:4}}>
          <button onClick={onClose} style={{flex:1,padding:"11px",borderRadius:10,border:"1.5px solid #E5E7EB",background:"none",cursor:"pointer",fontWeight:500}}>Cancel</button>
          <button onClick={handle} style={{flex:2,padding:"11px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",color:"white",cursor:"pointer",fontWeight:600}}>Change PIN</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [unlocked,setUnlocked]=useState(()=>{const ts=localStorage.getItem(PIN_TS_KEY);return ts?Date.now()-parseInt(ts)<30*864e5:false;});
  const [items,setItems]=useState<any[]>([]);
  const [history,setHistory]=useState<any[]>([]);
  const [view,setView]=useState("list");
  const [status,setStatus]=useState("loading");
  const [lastSync,setLastSync]=useState<Date|null>(null);
  const [form,setForm]=useState({store:"lidl",customStore:"",name:"",qty:1,unit:"item(s)"});
  const [suggs,setSuggs]=useState<any[]>([]);
  const [showSugg,setShowSugg]=useState(false);
  const [postShop,setPostShop]=useState<any>(null);
  const [postForm,setPostForm]=useState<any>({});
  const [extra,setExtra]=useState({store:"lidl",customStore:"",name:"",qty:1,unit:"item(s)",price:""});
  const [showPin,setShowPin]=useState(false);
  const lastITs=useRef<string|null>(null), lastHTs=useRef<string|null>(null);
  const saving=useRef(false), itemsRef=useRef<any[]>([]);
  itemsRef.current=items;

  const pull=useCallback(async(force=false)=>{
    try{
      const [iTs,hTs]=await Promise.all([dbGetTs(ITEMS_KEY),dbGetTs(HISTORY_KEY)]);
      const [iR,hR]=await Promise.all([force||iTs!==lastITs.current?dbGet(ITEMS_KEY):Promise.resolve(null),force||hTs!==lastHTs.current?dbGet(HISTORY_KEY):Promise.resolve(null)]);
      if(iR){setItems(iR.data||[]);lastITs.current=iTs;}
      if(hR){setHistory(hR.data||[]);lastHTs.current=hTs;}
      setLastSync(new Date());setStatus("ok");
    }catch{setStatus("error");}
  },[]);

  useEffect(()=>{pull(true);const t=setInterval(()=>{if(!saving.current)pull(false);},POLL_MS);return()=>clearInterval(t);},[pull]);

  useEffect(()=>{
    if(!history.length)return;
    const freq:any={};
    history.forEach((wk:any)=>wk.items.forEach((it:any)=>{const k=`${it.storeId}||${it.name}||${it.unit}`;freq[k]=(freq[k]||0)+1;}));
    const cur=new Set(itemsRef.current.map((i:any)=>`${i.storeId}||${i.name}||${i.unit}`));
    const s=Object.entries(freq).filter(([k])=>!cur.has(k)).sort((a:any,b:any)=>b[1]-a[1]).slice(0,12).map(([k])=>{const [storeId,name,unit]=k.split("||");return{storeId,name,unit};});
    setSuggs(s);if(s.length&&!itemsRef.current.length)setShowSugg(true);
  },[history]);

  const mutate=async(fn:(p:any[])=>any[])=>{
    saving.current=true;setStatus("saving");
    const next=fn(itemsRef.current);setItems(next);
    await dbSet(ITEMS_KEY,next);lastITs.current=await dbGetTs(ITEMS_KEY);
    setLastSync(new Date());saving.current=false;setStatus("ok");
  };

  const addItem=async()=>{
    if(!form.name.trim())return;
    const st=STORES.find(x=>x.id===form.store);
    const storeName=form.store==="misc"?(form.customStore||"Misc"):st!.name;
    await mutate(prev=>[...prev,{id:genId(),storeId:form.store,store:storeName,name:form.name.trim(),qty:form.qty,unit:form.unit,done:false,date:todayStr()}]);
    setForm(f=>({...f,name:"",qty:1,unit:"item(s)"}));
  };
  const toggleDone=(id:string)=>mutate(p=>p.map(i=>i.id===id?{...i,done:!i.done}:i));
  const removeItem=(id:string)=>mutate(p=>p.filter(i=>i.id!==id));
  const clearDone=()=>mutate(p=>p.filter(i=>!i.done));
  const acceptSugg=async(s:any)=>{
    const st=STORES.find(x=>x.id===s.storeId)||STORES[0];
    await mutate(prev=>[...prev,{id:genId(),storeId:s.storeId,store:st.name,name:s.name,qty:1,unit:s.unit,done:false,date:todayStr()}]);
    setSuggs(p=>p.filter(x=>!(x.storeId===s.storeId&&x.name===s.name)));
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
    setPostShop((ps:any)=>({...ps,extras:[...(ps.extras||[]),{id:genId(),storeId:extra.store,store:storeName,name:extra.name.trim(),qty:extra.qty,unit:extra.unit,price:extra.price,done:true,extra:true}]}));
    setExtra({store:"lidl",customStore:"",name:"",qty:1,unit:"item(s)",price:""});
  };
  const saveWeek=async()=>{
    saving.current=true;setStatus("saving");
    const wk=weekKey(),extras=postShop.extras||[];
    const rec={week:wk,date:todayStr(),items:[...items,...extras],spending:postForm,totalSpent:Object.values(postForm).reduce((a:any,b:any)=>a+(parseFloat(b.spent)||0),0)};
    const newHist=history.find((h:any)=>h.week===wk)?history.map((h:any)=>h.week===wk?rec:h):[rec,...history];
    setHistory(newHist);setItems([]);
    await Promise.all([dbSet(ITEMS_KEY,[]),dbSet(HISTORY_KEY,newHist)]);
    const [iTs,hTs]=await Promise.all([dbGetTs(ITEMS_KEY),dbGetTs(HISTORY_KEY)]);
    lastITs.current=iTs;lastHTs.current=hTs;
    saving.current=false;setStatus("ok");setLastSync(new Date());setPostShop(null);setView("list");
  };

  const grouped=STORES.map(s=>({...s,items:items.filter(i=>i.storeId===s.id)})).filter(g=>g.items.length>0);
  const doneCount=items.filter(i=>i.done).length;
  const totalItems=items.length;

  if(!unlocked)return <PinScreen onUnlock={()=>setUnlocked(true)}/>;

  return (
    <div style={{minHeight:"100vh",background:"#F8FAFF",fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
      <style>{`
        *{box-sizing:border-box;}
        input,select,button{font-family:inherit;}
        input:focus,select:focus{outline:none;border-color:#4F46E5!important;box-shadow:0 0 0 3px rgba(79,70,229,0.1);}
        .item-row{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:14px;margin-bottom:8px;background:white;border:1.5px solid #F1F5F9;transition:all 0.15s;box-shadow:0 1px 4px rgba(0,0,0,0.04);}
        .item-row:hover{border-color:#E0E7FF;box-shadow:0 2px 8px rgba(79,70,229,0.08);}
        .icon-btn{background:none;border:none;cursor:pointer;padding:6px;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:background 0.15s;}
        .icon-btn:hover{background:#FEE2E2;}
        .check-circle{width:24px;height:24px;border-radius:50%;border:2px solid #D1D5DB;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.2s;}
        .check-circle.done{background:linear-gradient(135deg,#4F46E5,#7C3AED);border-color:transparent;}
        .tab-btn{background:none;border:none;padding:10px 20px;cursor:pointer;font-size:14px;font-weight:500;color:#9CA3AF;border-bottom:2.5px solid transparent;transition:all 0.2s;}
        .tab-btn.active{color:#4F46E5;border-bottom-color:#4F46E5;}
        .store-pill{display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;}
        .sugg-chip{display:inline-flex;align-items:center;gap:6px;background:white;border:1.5px solid #E5E7EB;border-radius:999px;padding:6px 14px;font-size:13px;margin:4px;cursor:pointer;transition:all 0.15s;box-shadow:0 1px 3px rgba(0,0,0,0.05);}
        .sugg-chip:hover{border-color:#4F46E5;color:#4F46E5;box-shadow:0 2px 8px rgba(79,70,229,0.12);}
        .hist-card{background:white;border:1.5px solid #F1F5F9;border-radius:16px;padding:1.2rem 1.4rem;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.04);}
        .primary-btn{background:linear-gradient(135deg,#4F46E5,#7C3AED);color:white;border:none;border-radius:12px;padding:12px 20px;font-weight:600;cursor:pointer;font-size:14px;box-shadow:0 4px 12px rgba(79,70,229,0.3);transition:all 0.2s;}
        .primary-btn:hover{box-shadow:0 6px 16px rgba(79,70,229,0.4);transform:translateY(-1px);}
        .input-base{padding:11px 14px;border-radius:10px;border:1.5px solid #E5E7EB;font-size:14px;background:white;transition:all 0.2s;}
        @media print{.no-print{display:none!important;}.print-only{display:block!important;}}
      `}</style>

      {showPin&&<ChangePinModal onClose={()=>setShowPin(false)}/>}

      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%)",padding:"1.2rem 1rem 0",position:"sticky",top:0,zIndex:10}} className="no-print">
        <div style={{maxWidth:640,margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:36,height:36,borderRadius:10,background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🛒</div>
              <div>
                <div style={{fontSize:18,fontWeight:700,color:"white"}}>Family Groceries</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.7)",display:"flex",alignItems:"center",gap:4}}>
                  <span style={{width:6,height:6,borderRadius:"50%",background:status==="saving"?"#FCD34D":status==="error"?"#FCA5A5":"#6EE7B7",display:"inline-block"}}></span>
                  {status==="saving"?"Saving…":status==="error"?"Sync error":lastSync?`Synced ${lastSync.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`:"Connecting…"}
                  <button onClick={()=>pull(true)} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,0.7)",fontSize:13,padding:"0 2px"}}>↻</button>
                </div>
              </div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <button onClick={()=>setShowPin(true)} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:10,padding:"8px",cursor:"pointer",fontSize:16,color:"white"}}>🔐</button>
              {view==="list"&&items.length>0&&<>
                <button onClick={()=>setView("print")} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:10,padding:"8px 14px",cursor:"pointer",fontSize:13,color:"white",fontWeight:500}}>🖨️</button>
                <button onClick={startPostShop} style={{background:"white",border:"none",borderRadius:10,padding:"8px 14px",cursor:"pointer",fontSize:13,color:"#4F46E5",fontWeight:600}}>Done shopping</button>
              </>}
            </div>
          </div>

          {/* Progress bar */}
          {totalItems>0&&view==="list"&&(
            <div style={{marginBottom:"0.8rem"}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"rgba(255,255,255,0.8)",marginBottom:5}}>
                <span>{doneCount} of {totalItems} done</span>
                <span>{Math.round(doneCount/totalItems*100)}%</span>
              </div>
              <div style={{height:5,background:"rgba(255,255,255,0.2)",borderRadius:999}}>
                <div style={{height:"100%",background:"white",borderRadius:999,width:`${doneCount/totalItems*100}%`,transition:"width 0.4s ease"}}></div>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div style={{display:"flex",gap:4}}>
            {["list","history"].map(t=>(
              <button key={t} className={`tab-btn ${(view===t||(["postshop","print"].includes(view)&&t==="list"))?"active":""}`}
                style={{color:(view===t||(["postshop","print"].includes(view)&&t==="list"))?"white":"rgba(255,255,255,0.6)",borderBottomColor:(view===t||(["postshop","print"].includes(view)&&t==="list"))?"white":"transparent"}}
                onClick={()=>setView(t)}>
                {t==="list"?`List${items.length?` · ${items.length}`:""}` : "History"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{maxWidth:640,margin:"0 auto",padding:"1rem"}}>

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
                <div style={{fontSize:13,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",borderBottom:`2px solid ${grp.color}`,paddingBottom:6,marginBottom:10,color:grp.color}}>{grp.emoji} {grp.name}</div>
                {grp.items.map((item:any)=>(
                  <div key={item.id} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:"0.5px solid #f3f4f6"}}>
                    <span style={{width:18,height:18,border:"1.5px solid #aaa",display:"inline-block",borderRadius:4,flexShrink:0}}></span>
                    <span style={{flex:1,fontSize:15}}>{item.name}</span>
                    <span style={{fontSize:13,color:"#6B7280"}}>{item.qty} {item.unit}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* List view */}
        {view==="list"&&(
          <div>
            {/* Suggestions */}
            {showSugg&&suggs.length>0&&(
              <div style={{background:"linear-gradient(135deg,#EDE9FE,#DBEAFE)",borderRadius:16,padding:"1rem",marginBottom:"1rem",border:"1.5px solid #DDD6FE"}} className="no-print">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{fontSize:14,fontWeight:600,color:"#4F46E5"}}>💡 Suggested for this week</div>
                  <button className="icon-btn" onClick={()=>setShowSugg(false)} style={{color:"#6B7280",fontSize:16}}>✕</button>
                </div>
                <div style={{display:"flex",flexWrap:"wrap"}}>
                  {suggs.map((s:any,i:number)=>{
                    const st=STORES.find(x=>x.id===s.storeId);
                    return (
                      <span key={i} className="sugg-chip" onClick={()=>acceptSugg(s)}>
                        <span style={{fontSize:14}}>{storeEmoji(s.storeId)}</span>
                        <span style={{fontWeight:500}}>{s.name}</span>
                        <span style={{fontSize:11,color:"#9CA3AF"}}>{st?.name}</span>
                        <span onClick={(e:any)=>{e.stopPropagation();setSuggs((p:any)=>p.filter((x:any)=>!(x.storeId===s.storeId&&x.name===s.name)));}} style={{color:"#D1D5DB",marginLeft:2,fontSize:12}}>✕</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Add item form */}
            <div className="no-print" style={{background:"white",borderRadius:16,padding:"1rem",marginBottom:"1rem",border:"1.5px solid #F1F5F9",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
              <div style={{fontSize:13,fontWeight:600,color:"#374151",marginBottom:10}}>Add item</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <select value={form.store} onChange={e=>setForm(f=>({...f,store:e.target.value}))} className="input-base" style={{minWidth:100}}>
                  {STORES.map(s=><option key={s.id} value={s.id}>{s.emoji} {s.name}</option>)}
                </select>
                {form.store==="misc"&&<input placeholder="Store name" value={form.customStore} onChange={e=>setForm(f=>({...f,customStore:e.target.value}))} className="input-base" style={{width:110}}/>}
                <input placeholder="Item name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} onKeyDown={(e:any)=>e.key==="Enter"&&addItem()} className="input-base" style={{flex:1,minWidth:130}}/>
                <input type="number" min="0.1" step="0.5" value={form.qty} onChange={e=>setForm(f=>({...f,qty:Number(e.target.value)}))} className="input-base" style={{width:64}}/>
                <select value={form.unit} onChange={e=>setForm(f=>({...f,unit:e.target.value}))} className="input-base" style={{minWidth:90}}>
                  {UNITS.map(u=><option key={u}>{u}</option>)}
                </select>
                <button onClick={addItem} className="primary-btn" style={{padding:"11px 20px"}}>+ Add</button>
              </div>
            </div>

            {grouped.length===0&&(
              <div style={{textAlign:"center",padding:"4rem 1rem",color:"#9CA3AF"}}>
                <div style={{fontSize:56,marginBottom:12}}>🛒</div>
                <div style={{fontSize:17,fontWeight:600,color:"#374151",marginBottom:4}}>Your list is empty</div>
                <div style={{fontSize:14}}>Add items above to get started</div>
                {suggs.length>0&&!showSugg&&<button onClick={()=>setShowSugg(true)} style={{marginTop:16,fontSize:13,padding:"10px 20px",borderRadius:10,border:"1.5px solid #4F46E5",background:"none",color:"#4F46E5",cursor:"pointer",fontWeight:500}}>Show {suggs.length} suggestions</button>}
              </div>
            )}

            {grouped.map(grp=>(
              <div key={grp.id} style={{marginBottom:"0.5rem"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 4px",marginBottom:4}}>
                  <span style={{fontSize:18}}>{grp.emoji}</span>
                  <span style={{fontSize:13,fontWeight:700,color:grp.color,textTransform:"uppercase",letterSpacing:"0.05em"}}>{grp.name}</span>
                  {grp.type==="indian"&&<span style={{fontSize:11,background:grp.light,color:grp.color,padding:"2px 8px",borderRadius:999,fontWeight:600}}>Indian</span>}
                  <span style={{marginLeft:"auto",fontSize:12,color:"#9CA3AF",fontWeight:500}}>{grp.items.filter((i:any)=>i.done).length}/{grp.items.length}</span>
                </div>
                {grp.items.map((item:any)=>(
                  <div key={item.id} className="item-row" style={{opacity:item.done?0.5:1}}>
                    <div className={`check-circle ${item.done?"done":""}`} onClick={()=>toggleDone(item.id)}>
                      {item.done&&<span style={{color:"white",fontSize:14,fontWeight:700}}>✓</span>}
                    </div>
                    <div style={{flex:1}}>
                      <span style={{textDecoration:item.done?"line-through":"none",fontSize:15,fontWeight:500,color:"#111827"}}>{item.name}</span>
                      <span style={{marginLeft:8,fontSize:12,color:"#9CA3AF"}}>{item.qty} {item.unit}</span>
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

        {/* Post-shop view */}
        {view==="postshop"&&postShop&&(
          <div>
            <div style={{background:"linear-gradient(135deg,#ECFDF5,#D1FAE5)",borderRadius:16,padding:"1rem 1.2rem",marginBottom:"1rem",border:"1.5px solid #A7F3D0"}}>
              <div style={{fontSize:16,fontWeight:700,color:"#065F46"}}>🎉 Shopping done!</div>
              <div style={{fontSize:13,color:"#047857",marginTop:2}}>Log your spending and any extra items picked up.</div>
            </div>

            {postShop.stores.map((stId:string)=>{
              const st=STORES.find(x=>x.id===stId);
              return (
                <div key={stId} className="hist-card" style={{marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                    <span style={{fontSize:20}}>{storeEmoji(stId)}</span>
                    <span style={{fontWeight:600,color:storeColor(stId)}}>{st?.name||stId}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:14,color:"#6B7280",fontWeight:500}}>Amount spent</span>
                    <div style={{display:"flex",alignItems:"center",background:"#F9FAFB",border:"1.5px solid #E5E7EB",borderRadius:10,overflow:"hidden"}}>
                      <span style={{padding:"10px 12px",fontWeight:600,color:"#374151"}}>£</span>
                      <input type="number" min="0" step="0.01" placeholder="0.00" value={postForm[stId]?.spent||""} onChange={e=>setPostForm((pf:any)=>({...pf,[stId]:{...pf[stId],spent:e.target.value}}))} style={{border:"none",background:"none",padding:"10px 12px 10px 0",width:100,fontSize:15,fontWeight:500}}/>
                    </div>
                  </div>
                </div>
              );
            })}

            <div style={{fontSize:15,fontWeight:700,margin:"1.2rem 0 0.8rem",color:"#374151"}}>➕ Extra items bought</div>
            <div style={{background:"white",borderRadius:16,padding:"1rem",border:"1.5px solid #F1F5F9",marginBottom:8}}>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <select value={extra.store} onChange={e=>setExtra(x=>({...x,store:e.target.value}))} className="input-base" style={{minWidth:100}}>
                  {STORES.map(s=><option key={s.id} value={s.id}>{s.emoji} {s.name}</option>)}
                </select>
                {extra.store==="misc"&&<input placeholder="Store name" value={extra.customStore} onChange={e=>setExtra(x=>({...x,customStore:e.target.value}))} className="input-base" style={{width:100}}/>}
                <input placeholder="Item name" value={extra.name} onChange={e=>setExtra(x=>({...x,name:e.target.value}))} className="input-base" style={{flex:1,minWidth:100}}/>
                <input type="number" min="1" value={extra.qty} onChange={e=>setExtra(x=>({...x,qty:Number(e.target.value)}))} className="input-base" style={{width:56}}/>
                <select value={extra.unit} onChange={e=>setExtra(x=>({...x,unit:e.target.value}))} className="input-base" style={{minWidth:90}}>
                  {UNITS.map(u=><option key={u}>{u}</option>)}
                </select>
                <input placeholder="£ price" type="number" value={extra.price} onChange={e=>setExtra(x=>({...x,price:e.target.value}))} className="input-base" style={{width:80}}/>
                <button onClick={addExtra} className="primary-btn">Add</button>
              </div>
            </div>
            {(postShop.extras||[]).map((ex:any)=>(
              <div key={ex.id} className="item-row">
                <span style={{fontSize:18}}>{storeEmoji(ex.storeId)}</span>
                <span style={{flex:1,fontSize:15,fontWeight:500}}>{ex.name} <span style={{fontSize:12,color:"#9CA3AF",fontWeight:400}}>{ex.qty} {ex.unit}</span></span>
                {ex.price&&<span style={{fontSize:13,fontWeight:600,color:"#374151"}}>£{parseFloat(ex.price).toFixed(2)}</span>}
              </div>
            ))}

            <div style={{display:"flex",gap:10,marginTop:"1.5rem"}}>
              <button onClick={()=>setView("list")} style={{flex:1,padding:"13px",borderRadius:12,border:"1.5px solid #E5E7EB",background:"white",cursor:"pointer",fontWeight:600}}>Back</button>
              <button onClick={saveWeek} className="primary-btn" style={{flex:2,padding:"13px"}}>Save & clear list</button>
            </div>
          </div>
        )}

        {/* History view */}
        {view==="history"&&(
          <div>
            {!history.length&&(
              <div style={{textAlign:"center",padding:"4rem 1rem",color:"#9CA3AF"}}>
                <div style={{fontSize:56,marginBottom:12}}>📋</div>
                <div style={{fontSize:17,fontWeight:600,color:"#374151",marginBottom:4}}>No history yet</div>
                <div style={{fontSize:14}}>Completed shopping trips will appear here</div>
              </div>
            )}
            {history.map((h:any,i:number)=>(
              <div key={i} className="hist-card">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                  <div>
                    <div style={{fontWeight:700,color:"#111827",fontSize:15}}>{h.week}</div>
                    <div style={{fontSize:12,color:"#9CA3AF",marginTop:2}}>{h.date}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontWeight:700,color:"#4F46E5",fontSize:18}}>£{h.totalSpent?.toFixed(2)||"0.00"}</div>
                    <div style={{fontSize:12,color:"#9CA3AF"}}>{h.items.length} items</div>
                  </div>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
                  {STORES.filter(s=>h.spending?.[s.id]?.spent).map(s=>(
                    <span key={s.id} className="store-pill" style={{background:storeBg(s.id),color:storeColor(s.id)}}>
                      {storeEmoji(s.id)} {s.name}: £{parseFloat(h.spending[s.id].spent).toFixed(2)}
                    </span>
                  ))}
                </div>
                <details style={{fontSize:13}}>
                  <summary style={{cursor:"pointer",color:"#6B7280",fontWeight:500,listStyle:"none"}}>▸ View {h.items.length} items</summary>
                  <div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:6}}>
                    {h.items.map((it:any,j:number)=>(
                      <span key={j} style={{fontSize:12,padding:"4px 12px",borderRadius:999,background:"#F3F4F6",color:"#374151",fontWeight:500}}>
                        {it.extra?"✨ ":""}{it.name} · {it.qty} {it.unit}
                      </span>
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