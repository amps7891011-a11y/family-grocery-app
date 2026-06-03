import { useState, useEffect, useCallback, useRef } from "react";

const SUPABASE_URL = "https://mbvmnwulfllfgxivlerw.supabase.co";
const SUPABASE_KEY = "sb_publishable_M5CMfYarPj6rsWCtsZMbDw_pWMZY25W";
const POLL_MS = 5000;

const STORES = [
  { id:"lidl",   name:"Lidl",   color:"#0050AA", light:"#E6F0FF", type:"general" },
  { id:"tesco",  name:"Tesco",  color:"#005BA7", light:"#EAF1FF", type:"general" },
  { id:"asda",   name:"Asda",   color:"#007D3A", light:"#E8F5EE", type:"general" },
  { id:"sai",    name:"Sai",    color:"#C2410C", light:"#FFF0E6", type:"indian"  },
  { id:"sujash", name:"Sujash", color:"#7C3AED", light:"#F3EEFF", type:"indian"  },
  { id:"misc",   name:"Misc",   color:"#6B7280", light:"#F3F4F6", type:"misc"    },
];
const UNITS = ["item(s)","litre(s)","kg","g","dozen","box(es)","pack(s)","bag(s)","bottle(s)","can(s)","loaf/loaves","bunch(es)"];
const genId    = () => Math.random().toString(36).slice(2,9);
const todayStr = () => new Date().toISOString().slice(0,10);
const weekKey  = () => {
  const d=new Date(), j=new Date(d.getFullYear(),0,1);
  return `${d.getFullYear()}-W${String(Math.ceil(((d-j)/864e5+j.getDay()+1)/7)).padStart(2,"0")}`;
};
const storeColor = (id: string) => STORES.find(x=>x.id===id)?.color||"#6B7280";
const storeBg    = (id: string) => STORES.find(x=>x.id===id)?.light||"#F3F4F6";

const headers = { "Content-Type":"application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };

async function dbGet(key: string) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/grocery_store?key=eq.${key}&select=value,updated_at`, { headers });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows.length) return null;
    return { data: JSON.parse(rows[0].value), ts: rows[0].updated_at };
  } catch { return null; }
}

async function dbSet(key: string, value: any) {
  try {
    const body = JSON.stringify({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/grocery_store`, {
      method: "POST",
      headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
      body
    });
    return r.ok;
  } catch { return false; }
}

async function dbGetTs(key: string) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/grocery_store?key=eq.${key}&select=updated_at`, { headers });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows.length ? rows[0].updated_at : null;
  } catch { return null; }
}

const ITEMS_KEY   = "family_items";
const HISTORY_KEY = "family_history";

const CORRECT_PIN = "1234";
const PIN_KEY = "grocery_app_pin_verified";

function PinScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  const handleSubmit = () => {
    if (pin === CORRECT_PIN) {
      localStorage.setItem(PIN_KEY, Date.now().toString());
      onUnlock();
    } else {
      setError(true);
      setPin("");
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#f9fafb"}}>
      <div style={{background:"white",borderRadius:16,padding:"2rem",width:320,boxShadow:"0 4px 24px rgba(0,0,0,0.08)",textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:12}}>🛒</div>
        <div style={{fontSize:20,fontWeight:600,marginBottom:4}}>Family Groceries</div>
        <div style={{fontSize:13,color:"#6B7280",marginBottom:"1.5rem"}}>Enter your access code to continue</div>
        <input
          type="password"
          placeholder="Enter PIN / passphrase"
          value={pin}
          onChange={e=>{setPin(e.target.value);setError(false);}}
          onKeyDown={e=>e.key==="Enter"&&handleSubmit()}
          style={{width:"100%",padding:"10px 14px",borderRadius:8,border:`1.5px solid ${error?"#EF4444":"#d1d5db"}`,fontSize:16,marginBottom:12,textAlign:"center",outline:"none"}}
          autoFocus
        />
        {error && <div style={{color:"#EF4444",fontSize:13,marginBottom:8}}>Incorrect code. Try again.</div>}
        <button onClick={handleSubmit} style={{width:"100%",padding:"10px",borderRadius:8,border:"none",background:"#4F46E5",color:"white",fontSize:15,cursor:"pointer",fontWeight:500}}>
          Unlock
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(() => {
    const ts = localStorage.getItem(PIN_KEY);
    if (!ts) return false;
    const days30 = 30 * 24 * 60 * 60 * 1000;
    return Date.now() - parseInt(ts) < days30;
  });
  const [items,    setItems]    = useState<any[]>([]);
  const [history,  setHistory]  = useState<any[]>([]);
  const [view,     setView]     = useState("list");
  const [status,   setStatus]   = useState("loading");
  const [lastSync, setLastSync] = useState<Date|null>(null);
  const [form,     setForm]     = useState({store:"lidl",customStore:"",name:"",qty:1,unit:"item(s)"});
  const [suggs,    setSuggs]    = useState<any[]>([]);
  const [showSugg, setShowSugg] = useState(false);
  const [postShop, setPostShop] = useState<any>(null);
  const [postForm, setPostForm] = useState<any>({});
  const [extra,    setExtra]    = useState({store:"lidl",customStore:"",name:"",qty:1,unit:"item(s)",price:""});

  const lastItemsTs   = useRef<string|null>(null);
  const lastHistoryTs = useRef<string|null>(null);
  const isSaving      = useRef(false);
  const itemsRef      = useRef<any[]>([]);
  itemsRef.current    = items;

  const pull = useCallback(async (force=false) => {
    try {
      const [iTs, hTs] = await Promise.all([dbGetTs(ITEMS_KEY), dbGetTs(HISTORY_KEY)]);
      const itemsChanged   = force || iTs !== lastItemsTs.current;
      const historyChanged = force || hTs !== lastHistoryTs.current;
      const fetches = await Promise.all([
        itemsChanged   ? dbGet(ITEMS_KEY)   : Promise.resolve(null),
        historyChanged ? dbGet(HISTORY_KEY) : Promise.resolve(null),
      ]);
      if (fetches[0]) { setItems(fetches[0].data||[]); lastItemsTs.current = iTs; }
      if (fetches[1]) { setHistory(fetches[1].data||[]); lastHistoryTs.current = hTs; }
      setLastSync(new Date());
      setStatus("ok");
    } catch { setStatus("error"); }
  }, []);

  useEffect(() => {
    pull(true);
    const t = setInterval(() => { if (!isSaving.current) pull(false); }, POLL_MS);
    return () => clearInterval(t);
  }, [pull]);

  useEffect(() => {
    if (!history.length) return;
    const freq: any = {};
    history.forEach((wk:any) => wk.items.forEach((it:any) => {
      const k = `${it.storeId}||${it.name}||${it.unit}`;
      freq[k] = (freq[k]||0)+1;
    }));
    const cur = new Set(itemsRef.current.map((i:any)=>`${i.storeId}||${i.name}||${i.unit}`));
    const s = Object.entries(freq)
      .filter(([k])=>!cur.has(k)).sort((a:any,b:any)=>b[1]-a[1]).slice(0,12)
      .map(([k])=>{ const [storeId,name,unit]=k.split("||"); return {storeId,name,unit}; });
    setSuggs(s);
    if (s.length && !itemsRef.current.length) setShowSugg(true);
  }, [history]);

  const mutateItems = async (fn: (prev: any[]) => any[]) => {
    isSaving.current = true;
    setStatus("saving");
    const next = fn(itemsRef.current);
    setItems(next);
    await dbSet(ITEMS_KEY, next);
    const ts = await dbGetTs(ITEMS_KEY);
    lastItemsTs.current = ts;
    setLastSync(new Date());
    isSaving.current = false;
    setStatus("ok");
  };

  const addItem = async () => {
    if (!form.name.trim()) return;
    const st = STORES.find(x=>x.id===form.store);
    const storeName = form.store==="misc"?(form.customStore||"Misc"):st!.name;
    await mutateItems(prev=>[...prev,{id:genId(),storeId:form.store,store:storeName,name:form.name.trim(),qty:form.qty,unit:form.unit,done:false,date:todayStr()}]);
    setForm(f=>({...f,name:"",qty:1,unit:"item(s)"}));
  };

  const toggleDone = (id: string) => mutateItems(prev=>prev.map(i=>i.id===id?{...i,done:!i.done}:i));
  const removeItem = (id: string) => mutateItems(prev=>prev.filter(i=>i.id!==id));
  const clearDone  = () => mutateItems(prev=>prev.filter(i=>!i.done));

  const acceptSugg = async (s: any) => {
    const st=STORES.find(x=>x.id===s.storeId)||STORES[0];
    await mutateItems(prev=>[...prev,{id:genId(),storeId:s.storeId,store:st.name,name:s.name,qty:1,unit:s.unit,done:false,date:todayStr()}]);
    setSuggs(prev=>prev.filter(x=>!(x.storeId===s.storeId&&x.name===s.name)));
  };

  const startPostShop = () => {
    const stores=[...new Set(items.map(i=>i.storeId))];
    const pf:any={}; stores.forEach(s=>{pf[s]={spent:""};});
    setPostForm(pf); setPostShop({stores,extras:[]}); setView("postshop");
  };

  const addExtra = () => {
    if (!extra.name.trim()) return;
    const st=STORES.find(x=>x.id===extra.store);
    const storeName=extra.store==="misc"?(extra.customStore||"Misc"):st!.name;
    setPostShop((ps:any)=>({...ps,extras:[...(ps.extras||[]),{id:genId(),storeId:extra.store,store:storeName,name:extra.name.trim(),qty:extra.qty,unit:extra.unit,price:extra.price,done:true,extra:true}]}));
    setExtra({store:"lidl",customStore:"",name:"",qty:1,unit:"item(s)",price:""});
  };

  const saveWeek = async () => {
    isSaving.current = true;
    setStatus("saving");
    const wk=weekKey();
    const extras=postShop.extras||[];
    const rec={week:wk,date:todayStr(),items:[...items,...extras],spending:postForm,totalSpent:Object.values(postForm).reduce((a:any,b:any)=>a+(parseFloat(b.spent)||0),0)};
    const newHist=history.find((h:any)=>h.week===wk)?history.map((h:any)=>h.week===wk?rec:h):[rec,...history];
    setHistory(newHist);
    setItems([]);
    await Promise.all([dbSet(ITEMS_KEY,[]), dbSet(HISTORY_KEY,newHist)]);
    const [iTs,hTs]=await Promise.all([dbGetTs(ITEMS_KEY),dbGetTs(HISTORY_KEY)]);
    lastItemsTs.current=iTs; lastHistoryTs.current=hTs;
    isSaving.current=false; setStatus("ok");
    setLastSync(new Date()); setPostShop(null); setView("list");
  };

  const grouped = STORES.map(s=>({...s,items:items.filter(i=>i.storeId===s.id)})).filter(g=>g.items.length>0);
  const doneCount = items.filter(i=>i.done).length;
  const syncDot   = status==="saving"?"#F59E0B":status==="error"?"#EF4444":"#10B981";
  const syncLabel = status==="loading"?"Connecting…":status==="saving"?"Saving…":status==="error"?"Sync error":lastSync?`Synced ${lastSync.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}`:"";

  if (!unlocked) return <PinScreen onUnlock={() => setUnlocked(true)} />;

  if (status==="loading") return (
    <div style={{textAlign:"center",padding:"4rem 0",color:"#6B7280"}}>
      <div style={{fontSize:40}}>🛒</div>
      <div style={{marginTop:12,fontSize:15}}>Connecting to your shared list…</div>
    </div>
  );

  return (
    <div style={{fontFamily:"sans-serif",maxWidth:680,margin:"0 auto",padding:"1rem"}}>
      <style>{`
        .tab-btn{background:none;border:none;padding:8px 16px;cursor:pointer;font-size:14px;border-bottom:2px solid transparent;color:#6B7280;}
        .tab-btn.active{border-bottom:2px solid #4F46E5;color:#4F46E5;font-weight:500;}
        .item-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;margin-bottom:6px;background:#fff;border:0.5px solid #e5e7eb;}
        .icon-btn{background:none;border:none;cursor:pointer;padding:4px;border-radius:6px;color:#6B7280;font-size:18px;display:flex;align-items:center;}
        .icon-btn:hover{background:#f3f4f6;}
        .add-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:1rem;}
        .sec-hdr{font-size:13px;font-weight:500;text-transform:uppercase;letter-spacing:0.05em;margin:1rem 0 0.5rem;display:flex;align-items:center;gap:8px;}
        .check-circle{width:22px;height:22px;border-radius:50%;border:2px solid #d1d5db;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.15s;}
        .check-circle.done{background:#4F46E5;border-color:#4F46E5;}
        .sugg-chip{display:inline-flex;align-items:center;gap:6px;background:#f3f4f6;border:0.5px solid #e5e7eb;border-radius:999px;padding:4px 12px;font-size:13px;margin:4px;cursor:pointer;}
        .hist-card{background:#fff;border:0.5px solid #e5e7eb;border-radius:12px;padding:1rem 1.25rem;margin-bottom:12px;}
        @media print{.no-print{display:none!important;}}
      `}</style>

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem"}}>
        <div>
          <div style={{fontSize:20,fontWeight:500}}>🛒 Family Groceries</div>
          <div style={{fontSize:12,color:"#6B7280",display:"flex",alignItems:"center",gap:5}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:syncDot,display:"inline-block"}}></span>
            {syncLabel}
            <button onClick={()=>pull(true)} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"#4F46E5",padding:"0 4px"}} title="Refresh">↻</button>
          </div>
        </div>
        <div style={{display:"flex",gap:8}} className="no-print">
          {view==="list"&&items.length>0&&<>
            <button onClick={()=>setView("print")} style={{fontSize:13,padding:"6px 14px",borderRadius:8,border:"0.5px solid #d1d5db",background:"none",cursor:"pointer"}}>🖨 Print</button>
            <button onClick={startPostShop} style={{fontSize:13,padding:"6px 14px",borderRadius:8,border:"none",background:"#4F46E5",color:"white",cursor:"pointer"}}>Back from store</button>
          </>}
        </div>
      </div>

      <div className="no-print" style={{display:"flex",borderBottom:"0.5px solid #e5e7eb",marginBottom:"1rem"}}>
        {["list","history"].map(t=>(
          <button key={t} className={`tab-btn ${(view===t||(["postshop","print"].includes(view)&&t==="list"))?"active":""}`} onClick={()=>setView(t)}>
            {t==="list"?`Shopping list${items.length?` (${items.length})`:""}` : "History"}
          </button>
        ))}
      </div>

      {view==="print"&&(
        <div>
          <div className="no-print" style={{display:"flex",gap:10,marginBottom:"1rem"}}>
            <button onClick={()=>setView("list")} style={{padding:"6px 14px",borderRadius:8,border:"0.5px solid #d1d5db",background:"none",cursor:"pointer"}}>← Back</button>
            <button onClick={()=>window.print()} style={{padding:"6px 18px",borderRadius:8,border:"none",background:"#4F46E5",color:"white",cursor:"pointer",fontWeight:500}}>🖨 Print now</button>
          </div>
          <h2 style={{fontSize:18,marginBottom:4}}>Grocery List — {weekKey()}</h2>
          <p style={{fontSize:12,color:"#6B7280",marginBottom:"1.5rem"}}>{new Date().toLocaleDateString("en-GB",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p>
          {grouped.map(grp=>(
            <div key={grp.id} style={{marginBottom:20}}>
              <div style={{fontSize:13,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",borderBottom:`2px solid ${grp.color}`,paddingBottom:4,marginBottom:8,color:grp.color}}>{grp.name}</div>
              {grp.items.map((item:any)=>(
                <div key={item.id} style={{display:"flex",alignItems:"center",gap:12,padding:"6px 0",borderBottom:"0.5px solid #eee"}}>
                  <span style={{width:16,height:16,border:"1.5px solid #aaa",display:"inline-block",borderRadius:3,flexShrink:0}}></span>
                  <span style={{flex:1,fontSize:15}}>{item.name}</span>
                  <span style={{fontSize:13,color:"#555"}}>{item.qty} {item.unit}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {view==="list"&&(
        <div>
          {showSugg&&suggs.length>0&&(
            <div className="no-print" style={{background:"#f9fafb",borderRadius:12,padding:"12px 16px",marginBottom:"1rem"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:14,fontWeight:500}}>💡 Suggested from previous lists</div>
                <button className="icon-btn" onClick={()=>setShowSugg(false)}>✕</button>
              </div>
              {suggs.map((s:any,i:number)=>{
                const st=STORES.find(x=>x.id===s.storeId);
                return (
                  <span key={i} className="sugg-chip" onClick={()=>acceptSugg(s)}>
                    <span style={{width:8,height:8,borderRadius:"50%",background:storeColor(s.storeId),display:"inline-block"}}></span>
                    {s.name} <span style={{fontSize:11,color:"#6B7280"}}>{st?.name}</span>
                    <span style={{fontSize:11,color:"#4F46E5"}}>+ add</span>
                    <span onClick={(e:any)=>{e.stopPropagation();setSuggs((p:any)=>p.filter((x:any)=>!(x.storeId===s.storeId&&x.name===s.name)));}} style={{color:"#6B7280",marginLeft:2}}>✕</span>
                  </span>
                );
              })}
            </div>
          )}

          <div className="no-print add-row">
            <select value={form.store} onChange={e=>setForm(f=>({...f,store:e.target.value}))} style={{borderRadius:8}}>
              {STORES.map(s=><option key={s.id} value={s.id}>{s.name}{s.type==="indian"?" 🌶":s.type==="misc"?" +":""}</option>)}
            </select>
            {form.store==="misc"&&<input placeholder="Store name" value={form.customStore} onChange={e=>setForm(f=>({...f,customStore:e.target.value}))} style={{width:110,borderRadius:8}}/>}
            <input placeholder="Item name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} onKeyDown={(e:any)=>e.key==="Enter"&&addItem()} style={{flex:1,minWidth:120,borderRadius:8}}/>
            <input type="number" min="0.1" step="0.5" value={form.qty} onChange={e=>setForm(f=>({...f,qty:Number(e.target.value)}))} style={{width:60,borderRadius:8}}/>
            <select value={form.unit} onChange={e=>setForm(f=>({...f,unit:e.target.value}))} style={{borderRadius:8}}>
              {UNITS.map(u=><option key={u}>{u}</option>)}
            </select>
            <button onClick={addItem} style={{background:"#4F46E5",color:"white",border:"none",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontWeight:500}}>Add</button>
          </div>

          {grouped.length===0&&(
            <div style={{textAlign:"center",padding:"3rem 0",color:"#6B7280"}}>
              <div style={{fontSize:40}}>🛒</div>
              <div style={{marginTop:8}}>Your shared list is empty. Add items above!</div>
              {suggs.length>0&&!showSugg&&<button onClick={()=>setShowSugg(true)} style={{marginTop:12,fontSize:13,padding:"6px 14px",borderRadius:8,border:"0.5px solid #4F46E5",background:"none",color:"#4F46E5",cursor:"pointer"}}>Show {suggs.length} suggestions</button>}
            </div>
          )}

          {grouped.map(grp=>(
            <div key={grp.id}>
              <div className="sec-hdr" style={{color:grp.color}}>
                <span style={{width:10,height:10,borderRadius:"50%",background:grp.color,display:"inline-block"}}></span>
                {grp.name}{grp.type==="indian"&&<span style={{fontSize:11}}>🌶</span>}
                <span style={{marginLeft:"auto",fontWeight:400,fontSize:12,textTransform:"none",color:"#6B7280"}}>{grp.items.filter((i:any)=>i.done).length}/{grp.items.length}</span>
              </div>
              {grp.items.map((item:any)=>(
                <div key={item.id} className="item-row" style={{opacity:item.done?0.5:1}}>
                  <div className={`check-circle ${item.done?"done":""}`} onClick={()=>toggleDone(item.id)}>
                    {item.done&&<span style={{color:"white",fontSize:13}}>✓</span>}
                  </div>
                  <div style={{flex:1}}>
                    <span style={{textDecoration:item.done?"line-through":"none",fontSize:15}}>{item.name}</span>
                    <span style={{marginLeft:8,fontSize:13,color:"#6B7280"}}>{item.qty} {item.unit}</span>
                  </div>
                  <button className="icon-btn no-print" onClick={()=>removeItem(item.id)} style={{color:"#EF4444"}}>✕</button>
                </div>
              ))}
            </div>
          ))}

          {doneCount>0&&<button className="no-print" onClick={clearDone} style={{marginTop:12,fontSize:13,padding:"6px 14px",borderRadius:8,border:"0.5px solid #EF4444",background:"none",color:"#EF4444",cursor:"pointer"}}>Remove {doneCount} checked item{doneCount>1?"s":""}</button>}
        </div>
      )}

      {view==="postshop"&&postShop&&(
        <div>
          <div style={{fontSize:16,fontWeight:500,marginBottom:4}}>Post-shopping summary</div>
          <div style={{fontSize:13,color:"#6B7280",marginBottom:"1rem"}}>Enter what you spent and any extra items picked up.</div>
          {postShop.stores.map((stId:string)=>{
            const st=STORES.find(x=>x.id===stId);
            return (
              <div key={stId} className="hist-card" style={{marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <span style={{width:10,height:10,borderRadius:"50%",background:storeColor(stId),display:"inline-block"}}></span>
                  <span style={{fontWeight:500}}>{st?.name||stId}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:14,color:"#6B7280"}}>Amount spent: £</span>
                  <input type="number" min="0" step="0.01" placeholder="0.00" value={postForm[stId]?.spent||""} onChange={e=>setPostForm((pf:any)=>({...pf,[stId]:{...pf[stId],spent:e.target.value}}))} style={{width:100,borderRadius:8}}/>
                </div>
              </div>
            );
          })}
          <div style={{fontSize:15,fontWeight:500,margin:"1rem 0 0.5rem"}}>Extra items bought</div>
          <div className="add-row">
            <select value={extra.store} onChange={e=>setExtra(x=>({...x,store:e.target.value}))} style={{borderRadius:8}}>
              {STORES.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {extra.store==="misc"&&<input placeholder="Store name" value={extra.customStore} onChange={e=>setExtra(x=>({...x,customStore:e.target.value}))} style={{width:100,borderRadius:8}}/>}
            <input placeholder="Item name" value={extra.name} onChange={e=>setExtra(x=>({...x,name:e.target.value}))} style={{flex:1,minWidth:100,borderRadius:8}}/>
            <input type="number" min="1" value={extra.qty} onChange={e=>setExtra(x=>({...x,qty:Number(e.target.value)}))} style={{width:52,borderRadius:8}}/>
            <select value={extra.unit} onChange={e=>setExtra(x=>({...x,unit:e.target.value}))} style={{borderRadius:8}}>
              {UNITS.map(u=><option key={u}>{u}</option>)}
            </select>
            <input placeholder="£ price" type="number" value={extra.price} onChange={e=>setExtra(x=>({...x,price:e.target.value}))} style={{width:70,borderRadius:8}}/>
            <button onClick={addExtra} style={{background:"#4F46E5",color:"white",border:"none",borderRadius:8,padding:"8px 14px",cursor:"pointer"}}>Add</button>
          </div>
          {(postShop.extras||[]).map((ex:any)=>(
            <div key={ex.id} className="item-row">
              <span style={{fontSize:12,padding:"2px 10px",borderRadius:999,background:storeBg(ex.storeId),color:storeColor(ex.storeId)}}>{ex.store}</span>
              <span style={{flex:1,fontSize:15}}>{ex.name} <span style={{fontSize:13,color:"#6B7280"}}>{ex.qty} {ex.unit}</span></span>
              {ex.price&&<span style={{fontSize:13,color:"#6B7280"}}>£{parseFloat(ex.price).toFixed(2)}</span>}
            </div>
          ))}
          <div style={{display:"flex",gap:10,marginTop:"1.5rem"}}>
            <button onClick={()=>setView("list")} style={{flex:1,padding:"10px",borderRadius:8,border:"0.5px solid #d1d5db",background:"none",cursor:"pointer"}}>Back</button>
            <button onClick={saveWeek} style={{flex:2,padding:"10px",borderRadius:8,border:"none",background:"#4F46E5",color:"white",cursor:"pointer",fontWeight:500}}>Save & clear list</button>
          </div>
        </div>
      )}

      {view==="history"&&(
        <div>
          {!history.length&&<div style={{textAlign:"center",padding:"3rem 0",color:"#6B7280"}}><div style={{fontSize:40}}>📋</div><div style={{marginTop:8}}>No history yet.</div></div>}
          {history.map((h:any,i:number)=>(
            <div key={i} className="hist-card">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div><div style={{fontWeight:500}}>{h.week}</div><div style={{fontSize:12,color:"#6B7280"}}>{h.date}</div></div>
                <div style={{textAlign:"right"}}><div style={{fontWeight:500,color:"#4F46E5"}}>£{h.totalSpent?.toFixed(2)||"0.00"}</div><div style={{fontSize:12,color:"#6B7280"}}>{h.items.length} items</div></div>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                {STORES.filter(s=>h.spending?.[s.id]?.spent).map(s=>(
                  <span key={s.id} style={{fontSize:12,padding:"2px 10px",borderRadius:999,background:storeBg(s.id),color:storeColor(s.id)}}>{s.name}: £{parseFloat(h.spending[s.id].spent).toFixed(2)}</span>
                ))}
              </div>
              <details style={{fontSize:13}}>
                <summary style={{cursor:"pointer",color:"#6B7280"}}>View {h.items.length} items</summary>
                <div style={{marginTop:8,display:"flex",flexWrap:"wrap",gap:4}}>
                  {h.items.map((it:any,j:number)=>(
                    <span key={j} style={{fontSize:12,padding:"2px 10px",borderRadius:999,background:"#f3f4f6",color:"#6B7280"}}>{it.extra?"✨ ":""}{it.name} · {it.qty} {it.unit}</span>
                  ))}
                </div>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}