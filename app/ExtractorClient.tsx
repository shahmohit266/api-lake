"use client";
import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { signOut } from "next-auth/react";

interface ExtractorProps {
  userEmail: string;
}

export default function ExtractorClient({ userEmail }: ExtractorProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [savedPresets, setSavedPresets] = useState<any[]>([]);
  const [banner, setBanner] = useState({ show: false, mode: "", text: "", targetId: null as string | null });
  
  const [endpoint, setEndpoint] = useState("https://datalakeapi.pathfactory.com/public/v3/pageviews/");
  const [method, setMethod] = useState("GET");
  const [reqBody, setReqBody] = useState("");
  const [params, setParams] = useState([{ key: "v1format", value: "false" }]);
  const [headers, setHeaders] = useState([{ key: "Authorization", value: "" }]);
  
  const [offsetKey, setOffsetKey] = useState("offset");
  const [limitKey, setLimitKey] = useState("limit");
  const [limitVal, setLimitVal] = useState("1000");
  const [startOffset, setStartOffset] = useState("0");
  const [stepType, setStepType] = useState("limit");
  const [maxRequests, setMaxRequests] = useState("50");
  const [delayMs, setDelayMs] = useState("300");
  const [dataPath, setDataPath] = useState("");
  
  const [status, setStatus] = useState("Ready to configure extraction.");
  const [isRunning, setIsRunning] = useState(false);
  const stopRef = useRef(false);

  useEffect(() => {
    fetchPresets();
  }, []);

  const fetchPresets = async () => {
    const { data } = await supabase.from('saved_queries').select('*').order('created_at', { ascending: false });
    if (data) setSavedPresets(data);
  };

  const handleClear = () => {
    setActiveId(null);
    setPresetName("");
    setEndpoint("https://datalakeapi.pathfactory.com/public/v3/pageviews/");
    setMethod("GET");
    setParams([{ key: "", value: "" }]);
    setHeaders([{ key: "", value: "" }]);
    setStatus("Started a new blank configuration.");
  };

  const triggerBanner = (mode: string, overrideId?: string, overrideName?: string) => {
    const targetName = overrideName || presetName;
    const targetId = overrideId || activeId;
    
    if (mode !== "delete" && !targetName) return setStatus("Error: Please enter a preset name.");
    if (mode === "delete" && !targetId) return setStatus("Error: No preset selected.");
    
    const messages = {
      save: `Update existing preset "${targetName}"?`,
      saveAs: `Create new preset copy "${targetName}"?`,
      delete: `Permanently delete "${targetName}"?`
    };
    setBanner({ show: true, mode, text: messages[mode as keyof typeof messages], targetId });
  };

  const confirmAction = async () => {
    setBanner({ show: false, mode: "", text: "", targetId: null });
    setStatus("Processing database request...");

    const payload = {
      user_email: userEmail,
      name: presetName,
      endpoint,
      method,
      headers: headers.reduce((acc, { key, value }) => (key ? { ...acc, [key]: value } : acc), {}),
      params: params.reduce((acc, { key, value }) => (key ? { ...acc, [key]: value } : acc), {}),
      pagination: { offsetKey, limitKey, limitVal, startOffset, stepType, dataPath, maxRequests, delayMs }
    };

    try {
      if (banner.mode === "save" && activeId) {
        const { error } = await supabase.from('saved_queries').update(payload).eq('id', activeId);
        if (error) throw error;
      } else if (banner.mode === "save" || banner.mode === "saveAs") {
        const { data, error } = await supabase.from('saved_queries').insert([payload]).select();
        if (error) throw error;
        if (data && data[0]) setActiveId(data[0].id);
      } else if (banner.mode === "delete") {
        const { error } = await supabase.from('saved_queries').delete().eq('id', banner.targetId);
        if (error) throw error;
        if (banner.targetId === activeId) handleClear();
      }
      setStatus("Success! Database operation complete.");
      fetchPresets();
    } catch (err: any) {
      setStatus(`Database Error: ${err.message}`);
    }
  };

  const loadPreset = (p: any) => {
    setActiveId(p.id);
    setEndpoint(p.endpoint || "");
    setMethod(p.method || "GET");
    setPresetName(p.name || "");
    
    const pHeaders = Object.keys(p.headers || {}).map(k => ({ key: k, value: p.headers[k] }));
    setHeaders(pHeaders.length ? pHeaders : [{ key: "", value: "" }]);
    
    const pParams = Object.keys(p.params || {}).map(k => ({ key: k, value: p.params[k] }));
    setParams(pParams.length ? pParams : [{ key: "", value: "" }]);
    
    const pag = p.pagination || {};
    setOffsetKey(pag.offsetKey || "offset");
    setLimitKey(pag.limitKey || "limit");
    setLimitVal(pag.limitVal || "1000");
    setStartOffset(pag.startOffset || "0");
    setStepType(pag.stepType || "limit");
    setDataPath(pag.dataPath || "");
    setMaxRequests(pag.maxRequests || "50");
    setDelayMs(pag.delayMs || "300");
    
    setStatus(`Loaded preset: ${p.name}`);
  };

  const addField = (setter: any, state: any) => setter([...state, { key: "", value: "" }]);
  const updateField = (setter: any, state: any, i: number, field: string, val: string) => {
    const updated = [...state]; updated[i][field] = val; setter(updated);
  };
  const removeField = (setter: any, state: any, i: number) => {
    if (state.length === 1) return;
    setter(state.filter((_: any, index: number) => index !== i));
  };

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const handleExtract = async () => {
    setStatus("Extracting data... please wait.");
    setIsRunning(true);
    stopRef.current = false;
    
    let currentOffset = parseInt(startOffset, 10) || 0;
    const parsedLimit = parseInt(limitVal, 10) || 0;
    const max = parseInt(maxRequests, 10) || 50;
    const delay = parseInt(delayMs, 10) || 0;
    
    let allRecords: any[] = [];
    let requestCount = 0;

    const cleanParams = params.reduce((acc, { key, value }) => (key ? { ...acc, [key]: value } : acc), {});
    const cleanHeaders = headers.reduce((acc, { key, value }) => (key ? { ...acc, [key]: value } : acc), {});

    try {
      while (!stopRef.current && requestCount < max) {
        requestCount++;
        const url = new URL(endpoint);
        
        if (limitKey && parsedLimit > 0) url.searchParams.set(limitKey, parsedLimit.toString());
        if (offsetKey) url.searchParams.set(offsetKey, currentOffset.toString());
        Object.keys(cleanParams || {}).forEach(key => url.searchParams.set(key, (cleanParams as any)[key]));

        const options: any = { method, headers: cleanHeaders };
        if (['POST', 'PUT', 'PATCH'].includes(method) && reqBody) {
          options.body = reqBody;
          if (!options.headers['Content-Type']) options.headers['Content-Type'] = 'application/json';
        }

        setStatus(`[Request #${requestCount}] Fetching offset=${currentOffset}... (Total records: ${allRecords.length})`);

        const res = await fetch("/api/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.toString(), options })
        });
        
        const result = await res.json();
        if (!result.success) throw new Error(result.error);
        
        const records = dataPath 
          ? dataPath.split('.').reduce((acc: any, part: string) => acc && acc[part], result.data) 
          : result.data;
        
        if (!Array.isArray(records) || records.length === 0) break;
        
        allRecords = allRecords.concat(records);
        if (parsedLimit > 0 && records.length < parsedLimit) break;
        
        currentOffset += stepType === 'limit' ? parsedLimit : 1;
        if (delay > 0 && !stopRef.current) await sleep(delay);
      }

      if (allRecords.length > 0) {
        const csvHeaders = Object.keys(allRecords[0]).join(",");
        const rows = allRecords.map((row: any) => Object.values(row).map(val => `"${val}"`).join(",")).join("\n");
        const blob = new Blob([`${csvHeaders}\n${rows}`], { type: "text/csv" });
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = downloadUrl; a.download = "api_export.csv"; a.click();
        setStatus(`Successfully downloaded ${allRecords.length} records.`);
      } else {
        setStatus(`Finished. No data found.`);
      }
    } catch (err: any) {
      setStatus(`Error: ${err.message}. Downloaded ${allRecords.length} partial records.`);
    }
    setIsRunning(false);
  };

  const handleStop = () => {
    stopRef.current = true;
    setStatus("Stopping loop after current batch finishes...");
  };

  const Label = ({ text }: { text: string }) => (
    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{text}</label>
  );

  const inputClass = "w-full px-3 py-2 bg-slate-950 text-slate-100 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-sky-400 transition-colors";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-sky-500 selection:text-black">
      
      {/* Top Navbar */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md flex justify-between items-center px-6 sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sky-400 rounded-lg text-xs font-semibold transition-colors"
          >
            {isSidebarOpen ? "◀ Hide Presets" : "▶ Show Presets"}
          </button>
          <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            API Data Extraction Engine
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400 bg-slate-800/60 px-3 py-1 rounded-full border border-slate-700/50">{userEmail}</span>
          <button 
            onClick={() => signOut()} 
            className="text-xs font-semibold text-rose-400 hover:text-rose-300 px-3 py-1.5 rounded-lg border border-rose-900/50 bg-rose-950/20 hover:bg-rose-950/40 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Workspace Grid */}
      <div className="flex flex-1 p-6 gap-6 max-w-[1600px] w-full mx-auto box-border">
        
        {/* Collapsible Sidebar */}
        {isSidebarOpen && (
          <aside className="w-72 bg-slate-900 border border-slate-800 rounded-xl p-4 h-fit flex-shrink-0 shadow-xl">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800">
              <h3 className="text-xs font-bold text-sky-400 uppercase tracking-wider">Saved Configurations</h3>
              <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">{savedPresets.length}</span>
            </div>
            {savedPresets.length === 0 && (
              <p className="text-xs text-slate-500 italic py-2">No presets saved yet. Create one on the right!</p>
            )}
            <div className="flex flex-col gap-1.5 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
              {savedPresets.map(p => (
                <div key={p.id} className="flex gap-1.5 group">
                  <button 
                    onClick={() => loadPreset(p)} 
                    className={`flex-1 text-left px-3 py-2 rounded-lg text-xs font-medium transition-all truncate border ${
                      activeId === p.id 
                        ? "bg-sky-500/10 border-sky-500/50 text-sky-300 shadow-sm" 
                        : "bg-slate-950/60 border-slate-800 text-slate-300 hover:bg-slate-800/80"
                    }`}
                    title={p.name}
                  >
                    {p.name}
                  </button>
                  <button 
                    onClick={() => triggerBanner("delete", p.id, p.name)} 
                    className="px-2.5 bg-slate-950/60 border border-slate-800 text-slate-500 hover:text-rose-400 hover:border-rose-900/50 rounded-lg transition-colors text-xs" 
                    title="Delete preset"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </aside>
        )}

        {/* Content Panel */}
        <main className="flex-1 flex flex-col gap-6 min-w-0">
          
          {/* Preset Bar */}
          <section className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 w-full">
              <Label text="Preset Name" />
              <input 
                value={presetName} 
                onChange={e => setPresetName(e.target.value)} 
                placeholder="e.g., PathFactory Pageviews Sync" 
                className={inputClass} 
              />
            </div>
            <div className="flex flex-wrap gap-2 w-full md:w-auto">
              <button onClick={handleClear} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold transition-colors">
                + New Blank
              </button>
              <button onClick={() => triggerBanner("save")} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-black border border-emerald-500 rounded-lg text-xs font-bold transition-colors shadow-sm">
                Save
              </button>
              {activeId && (
                <>
                  <button onClick={() => triggerBanner("saveAs")} className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-black border border-sky-400 rounded-lg text-xs font-bold transition-colors shadow-sm">
                    Save As Copy
                  </button>
                  <button onClick={() => triggerBanner("delete")} className="px-4 py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-900/50 rounded-lg text-xs font-semibold transition-colors">
                    Delete
                  </button>
                </>
              )}
            </div>
          </section>

          {/* Endpoint Card */}
          <section className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
            <h2 className="text-xs font-bold text-sky-400 uppercase tracking-wider mb-4 pb-2 border-b border-slate-800">1. Target Endpoint & Authentication</h2>
            
            <div className="mb-4">
              <Label text="Request URL & Method" />
              <div className="flex gap-2">
                <select 
                  value={method} 
                  onChange={e => setMethod(e.target.value)} 
                  className="w-28 px-3 py-2 bg-slate-950 text-sky-400 font-bold border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-sky-400"
                >
                  <option>GET</option>
                  <option>POST</option>
                  <option>PUT</option>
                  <option>PATCH</option>
                  <option>DELETE</option>
                </select>
                <input 
                  value={endpoint} 
                  onChange={e => setEndpoint(e.target.value)} 
                  placeholder="https://api.example.com/v1/resource" 
                  className={inputClass} 
                />
              </div>
            </div>

            {['POST', 'PUT', 'PATCH'].includes(method) && (
              <div className="mb-4">
                <Label text="Request Body (JSON Payload)" />
                <textarea 
                  value={reqBody} 
                  onChange={e => setReqBody(e.target.value)} 
                  placeholder='{"query": "active"}' 
                  rows={3} 
                  className={`${inputClass} font-mono`} 
                />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <Label text="Query Parameters" />
                  <button onClick={() => addField(setParams, params)} className="text-[11px] text-sky-400 hover:text-sky-300 font-semibold">+ Add Param</button>
                </div>
                {params.map((p, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input placeholder="Key" value={p.key} onChange={e => updateField(setParams, params, i, "key", e.target.value)} className={inputClass} />
                    <input placeholder="Value" value={p.value} onChange={e => updateField(setParams, params, i, "value", e.target.value)} className={inputClass} />
                    <button onClick={() => removeField(setParams, params, i)} className="px-2 text-slate-500 hover:text-rose-400">✕</button>
                  </div>
                ))}
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <Label text="Headers" />
                  <button onClick={() => addField(setHeaders, headers)} className="text-[11px] text-sky-400 hover:text-sky-300 font-semibold">+ Add Header</button>
                </div>
                {headers.map((h, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input placeholder="Key" value={h.key} onChange={e => updateField(setHeaders, headers, i, "key", e.target.value)} className={inputClass} />
                    <input placeholder="Value" value={h.value} onChange={e => updateField(setHeaders, headers, i, "value", e.target.value)} className={inputClass} />
                    <button onClick={() => removeField(setHeaders, headers, i)} className="px-2 text-slate-500 hover:text-rose-400">✕</button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Pagination Card */}
          <section className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
            <h2 className="text-xs font-bold text-sky-400 uppercase tracking-wider mb-4 pb-2 border-b border-slate-800">2. Pagination Loop Engine</h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div><Label text="Offset Param Name" /><input value={offsetKey} onChange={e => setOffsetKey(e.target.value)} className={inputClass} placeholder="offset" /></div>
              <div><Label text="Limit Param Name" /><input value={limitKey} onChange={e => setLimitKey(e.target.value)} className={inputClass} placeholder="limit" /></div>
              <div><Label text="Limit Value / Batch Size" /><input value={limitVal} onChange={e => setLimitVal(e.target.value)} type="number" className={inputClass} /></div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div><Label text="Start Offset" /><input value={startOffset} onChange={e => setStartOffset(e.target.value)} type="number" className={inputClass} /></div>
              <div>
                <Label text="Increment Step Type" />
                <select value={stepType} onChange={e => setStepType(e.target.value)} className={inputClass}>
                  <option value="limit">Add Limit (+1000)</option>
                  <option value="single">Add +1 (+1, +2)</option>
                </select>
              </div>
              <div><Label text="Rate Limit Delay (ms)" /><input value={delayMs} onChange={e => setDelayMs(e.target.value)} type="number" className={inputClass} /></div>
              <div><Label text="Nested JSON Path" /><input value={dataPath} onChange={e => setDataPath(e.target.value)} placeholder="e.g. data.items" className={inputClass} /></div>
            </div>
          </section>

          {/* Execution & Status Bar */}
          <section className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
            <div className="flex gap-3 mb-4">
              {!isRunning ? (
                <button 
                  onClick={handleExtract} 
                  className="flex-1 py-3 bg-sky-400 hover:bg-sky-300 text-slate-950 font-bold rounded-lg text-sm transition-all shadow-md tracking-wide"
                >
                  Start Fetch & Download CSV
                </button>
              ) : (
                <button 
                  onClick={handleStop} 
                  className="flex-1 py-3 bg-rose-950/40 hover:bg-rose-950/60 border border-rose-800 text-rose-400 font-bold rounded-lg text-sm transition-all shadow-md"
                >
                  Terminate & Download Current Data
                </button>
              )}
            </div>

            <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-lg font-mono text-xs text-sky-300 tracking-tight shadow-inner">
              <span className="text-slate-500 mr-2">&gt;</span>{status}
            </div>
          </section>

        </main>
      </div>

      {/* Confirmation Modal */}
      {banner.show && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex justify-center items-center z-[9999] p-4">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl max-w-sm w-full shadow-2xl">
            <h3 className="text-sm font-bold text-sky-400 uppercase tracking-wider mb-2">Confirm Action</h3>
            <p className="text-sm text-slate-300 mb-6">{banner.text}</p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setBanner({ show: false, mode: "", text: "", targetId: null })} 
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={confirmAction} 
                className="px-4 py-2 bg-sky-400 hover:bg-sky-300 text-slate-950 rounded-lg text-xs font-bold transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}